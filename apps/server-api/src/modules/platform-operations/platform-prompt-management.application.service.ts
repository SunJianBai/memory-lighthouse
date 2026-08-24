import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  Prisma,
  type PromptVersion,
} from '../../infrastructure/database/generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  companionPromptRevisionCode,
  promptEncryptionContext,
} from '../companion-session/companion-session.constants';
import {
  COMPANION_PROMPT_TEMPLATE_MAX_CHARS,
  CURRENT_COMPANION_PROMPT_COMPOSER_VERSION,
  DEFAULT_COMPANION_SYSTEM_PROMPT,
  normalizeCompanionPromptTemplate,
} from '../companion-session/companion-prompt';
import { ensureCurrentCompanionPrompt } from '../companion-session/companion-prompt.registry';
import { newUlid } from '../identity/domain/ulid';
import { DATA_ENCRYPTION_PORT } from '../memory/memory.constants';
import type { DataEncryptionPort } from '../memory/ports/data-encryption.port';
import { AUDIT_SERIALIZABLE_RETRY_LIMIT } from './platform-operations.constants';
import { preparePlatformAuditAppend } from './platform-audit-chain';
import {
  PromptPublicationConflictException,
  PromptPublicationUnsupportedException,
  PromptPublicationValidationException,
  PromptRevisionUnchangedException,
} from './platform-operations.errors';
import type {
  CompanionPromptView,
  PlatformRequestMetadata,
  PlatformPrincipal,
  PublishCompanionPromptCommand,
} from './platform-operations.types';

const PROMPT_AUDIT_POLICY_VERSION = 'prompt-publication-v1';

@Injectable()
export class PlatformPromptManagementApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(DATA_ENCRYPTION_PORT)
    private readonly encryption: DataEncryptionPort,
    private readonly config: ConfigService,
  ) {}

  async getCurrentCompanionPrompt(): Promise<CompanionPromptView> {
    const prompt = await this.ensureCurrentPrompt(this.prisma);
    return this.promptView(prompt, this.openPrompt(prompt));
  }

  async publishCompanionPrompt(
    command: PublishCompanionPromptCommand,
  ): Promise<CompanionPromptView> {
    const content = this.normalizedContent(command.content);
    const reason = this.normalizedReason(command.reason);

    return this.retrySerializable(async (transaction) => {
      const current = await this.ensureCurrentPrompt(transaction);
      if (current.id !== command.expectedCurrentPromptId) {
        throw new PromptPublicationConflictException();
      }
      if (current.version !== CURRENT_COMPANION_PROMPT_COMPOSER_VERSION) {
        throw new PromptPublicationUnsupportedException(current.version);
      }
      if (this.openPrompt(current) === content) {
        throw new PromptRevisionUnchangedException();
      }

      const requestedAt = command.now ?? new Date();
      const publishedAt = this.strictlyAfter(requestedAt, current.publishedAt);
      const id = command.promptId ?? newUlid(publishedAt.getTime());
      const sealed = this.encryption.sealFields(
        { content },
        promptEncryptionContext(id, CURRENT_COMPANION_PROMPT_COMPOSER_VERSION),
      );
      const created = await transaction.promptVersion.create({
        data: {
          id,
          code: companionPromptRevisionCode(id),
          version: CURRENT_COMPANION_PROMPT_COMPOSER_VERSION,
          provider: current.provider,
          model: current.model,
          contentHash: Uint8Array.from(sealed.contentHashes.content!),
          contentCiphertext: Uint8Array.from(sealed.ciphertexts.content!),
          contentNonce: Uint8Array.from(sealed.nonceSeed),
          encryptionKeyId: sealed.keyId,
          publishedAt,
        },
      });
      await this.appendPublicationAudit(transaction, {
        principal: command.principal,
        request: command.request,
        reason,
        current,
        created,
        occurredAt: publishedAt,
      });
      return this.promptView(created, content);
    });
  }

  private async ensureCurrentPrompt(
    database: Pick<PrismaService, 'promptVersion'> | Prisma.TransactionClient,
  ): Promise<PromptVersion> {
    const now = new Date();
    const id = newUlid(now.getTime());
    const content =
      this.config.get<string>('MINICPM_SYSTEM_PROMPT')?.trim() ||
      DEFAULT_COMPANION_SYSTEM_PROMPT;
    return ensureCurrentCompanionPrompt(database, this.encryption, {
      id,
      content,
      provider: this.config.get<string>('MINICPM_PROVIDER') ?? 'modelbest',
      model:
        this.config.get<string>('MINICPM_MODEL') ?? 'openbmb/MiniCPM-o-4_5',
      publishedAt: now,
    });
  }

  private openPrompt(prompt: PromptVersion): string {
    const opened = this.encryption.openFields(
      {
        ciphertexts: { content: Buffer.from(prompt.contentCiphertext) },
        contentHashes: { content: Buffer.from(prompt.contentHash) },
        nonceSeed: Buffer.from(prompt.contentNonce),
        keyId: prompt.encryptionKeyId,
      },
      promptEncryptionContext(prompt.id, prompt.version),
    );
    if (!opened.content) {
      throw new Error('Prompt content is unavailable');
    }
    return opened.content;
  }

  private normalizedContent(value: string): string {
    try {
      return normalizeCompanionPromptTemplate(value);
    } catch {
      throw new PromptPublicationValidationException(
        `Prompt content must contain 1-${COMPANION_PROMPT_TEMPLATE_MAX_CHARS} characters`,
      );
    }
  }

  private normalizedReason(value: string): string {
    const reason = value.trim();
    if (reason.length === 0 || Array.from(reason).length > 100) {
      throw new PromptPublicationValidationException(
        'Publication reason must contain 1-100 characters',
      );
    }
    return reason;
  }

  private promptView(
    prompt: PromptVersion,
    content: string,
  ): CompanionPromptView {
    return {
      id: prompt.id,
      code: prompt.code,
      composerVersion: prompt.version,
      provider: prompt.provider,
      model: prompt.model,
      content,
      contentHash: Buffer.from(prompt.contentHash).toString('hex'),
      publishedAt: prompt.publishedAt.toISOString(),
    };
  }

  private async appendPublicationAudit(
    transaction: Prisma.TransactionClient,
    input: {
      principal: PlatformPrincipal;
      request: PlatformRequestMetadata;
      reason: string;
      current: PromptVersion;
      created: PromptVersion;
      occurredAt: Date;
    },
  ): Promise<void> {
    if (input.request.sourceIpHash.byteLength !== 32) {
      throw new Error('Platform audit source IP hash must be 32 bytes');
    }
    const appendPoint = await preparePlatformAuditAppend(
      transaction,
      input.occurredAt,
    );
    const { id, occurredAt } = appendPoint;
    const roles = [...input.principal.platformRoles].sort();
    const requestId = this.auditRequestId(input.request.requestId);
    const sourceIpHash = Uint8Array.from(input.request.sourceIpHash);
    const hashPayload = {
      id,
      occurredAt: occurredAt.toISOString(),
      environment: this.auditEnvironment(),
      actorType: 'USER',
      actorUserId: input.principal.userId,
      actorSessionId: input.principal.sessionId,
      actorRoles: roles,
      action: 'PROMPT_REVISION_PUBLISHED',
      resourceType: 'PROMPT_VERSION',
      resourceId: input.created.id,
      requestId,
      sourceIpHash: Buffer.from(sourceIpHash).toString('base64url'),
      purpose: input.reason,
      decision: 'ALLOW',
      policyVersion: PROMPT_AUDIT_POLICY_VERSION,
      beforeHash: Buffer.from(input.current.contentHash).toString('base64url'),
      afterHash: Buffer.from(input.created.contentHash).toString('base64url'),
    };
    const previousHash = appendPoint.previousEventHash
      ? Buffer.from(appendPoint.previousEventHash)
      : Buffer.alloc(32);
    const eventHash = createHash('sha256')
      .update(previousHash)
      .update(JSON.stringify(hashPayload), 'utf8')
      .digest();

    await transaction.auditLog.create({
      data: {
        id,
        occurredAt,
        environment: this.auditEnvironment(),
        actorType: 'USER',
        actorUserId: input.principal.userId,
        actorBindingId: null,
        actorSessionId: input.principal.sessionId,
        actorRoleSnapshot: roles,
        sourceIpHash,
        userAgent: input.request.userAgent?.slice(0, 512) ?? null,
        action: 'PROMPT_REVISION_PUBLISHED',
        resourceType: 'PROMPT_VERSION',
        resourceId: input.created.id,
        householdId: null,
        recipientId: null,
        targetDeviceId: null,
        requestId,
        traceId: null,
        purpose: input.reason,
        reasonCode: null,
        ticketId: null,
        approvalActorId: null,
        decision: 'ALLOW',
        failureCode: null,
        policyVersion: PROMPT_AUDIT_POLICY_VERSION,
        changedFieldNames: ['content'],
        beforeHash: Uint8Array.from(input.current.contentHash),
        afterHash: Uint8Array.from(input.created.contentHash),
        previousEventHash: appendPoint.previousEventHash
          ? Uint8Array.from(appendPoint.previousEventHash)
          : null,
        eventHash: Uint8Array.from(eventHash),
        retentionUntil: null,
      },
    });
  }

  private auditEnvironment(): string {
    return this.config.get<string>('NODE_ENV') === 'production'
      ? 'production'
      : 'development';
  }

  private auditRequestId(requestId: string): string {
    if (requestId.length <= 64) return requestId;
    const digest = createHash('sha256').update(requestId).digest('hex');
    return `${requestId.slice(0, 31)}:${digest.slice(0, 32)}`;
  }

  private strictlyAfter(candidate: Date, floor: Date): Date {
    return candidate.getTime() > floor.getTime()
      ? candidate
      : new Date(floor.getTime() + 1);
  }

  private async retrySerializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (
      let attempt = 0;
      attempt < AUDIT_SERIALIZABLE_RETRY_LIMIT;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        lastError = error;
        const retryable =
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2034';
        if (!retryable || attempt + 1 >= AUDIT_SERIALIZABLE_RETRY_LIMIT) {
          throw error;
        }
      }
    }
    throw lastError;
  }
}
