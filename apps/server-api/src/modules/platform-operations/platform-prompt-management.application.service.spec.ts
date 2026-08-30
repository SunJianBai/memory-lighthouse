import { createHash } from 'node:crypto';

import { describe, expect, it, jest } from '@jest/globals';
import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { DataEncryptionPort } from '../memory/ports/data-encryption.port';
import {
  PromptPublicationConflictException,
  PromptPublicationUnsupportedException,
  PromptRevisionUnchangedException,
} from './platform-operations.errors';
import { PlatformPromptManagementApplicationService } from './platform-prompt-management.application.service';
import type { PlatformPrincipal } from './platform-operations.types';

type Row = Record<string, any>;

const NOW = new Date('2026-08-24T08:00:00.000Z');
const CURRENT_ID = '01K1P000000000000000000001';
const NEXT_ID = '01K1P000000000000000000002';
const SOURCE_IP_HASH = Uint8Array.from(
  Array.from({ length: 32 }, (_, index) => index + 1),
);

const principal: PlatformPrincipal = {
  kind: 'ADMIN',
  userId: '01K1P000000000000000000010',
  sessionId: '01K1P000000000000000000011',
  tokenId: '01K1P000000000000000000012',
  status: 'ACTIVE',
  platformRoles: ['ADMIN'],
};

function hash(value: string): Uint8Array {
  return Uint8Array.from(createHash('sha256').update(value).digest());
}

class PromptPrismaHarness {
  readonly prompts: Row[];
  readonly auditLogs: Row[] = [];
  failAuditWrite = false;

  constructor(version = 4, content = '当前提示词') {
    this.prompts = [
      {
        id: CURRENT_ID,
        code: 'COMPANION_SYSTEM',
        version,
        provider: 'modelbest',
        model: 'openbmb/MiniCPM-o-4_5',
        contentHash: hash(content),
        contentCiphertext: Uint8Array.from(Buffer.from(content, 'utf8')),
        contentNonce: Uint8Array.from(Array(24).fill(1)),
        encryptionKeyId: 'test-key',
        publishedAt: NOW,
      },
    ];
  }

  readonly promptVersion = {
    findFirst: jest.fn(
      async () =>
        [...this.prompts].sort((left, right) => {
          const timeDifference =
            right.publishedAt.getTime() - left.publishedAt.getTime();
          return timeDifference !== 0
            ? timeDifference
            : String(right.id).localeCompare(String(left.id));
        })[0] ?? null,
    ),
    findUnique: jest.fn(
      async ({ where }: Row) =>
        this.prompts.find((prompt) => prompt.id === where.id) ?? null,
    ),
    create: jest.fn(async ({ data }: Row) => {
      const created = { ...data };
      this.prompts.push(created);
      return created;
    }),
  };

  readonly auditLog = {
    findFirst: jest.fn(async () => {
      const previous = this.auditLogs.at(-1);
      return previous
        ? {
            eventHash: previous.eventHash,
            occurredAt: previous.occurredAt,
          }
        : null;
    }),
    create: jest.fn(async ({ data }: Row) => {
      if (this.failAuditWrite) throw new Error('audit-write-failed');
      this.auditLogs.push(data);
      return data;
    }),
  };

  readonly $transaction = jest.fn(
    async (work: (transaction: this) => unknown) => {
      const promptLength = this.prompts.length;
      const auditLength = this.auditLogs.length;
      try {
        return await work(this);
      } catch (error) {
        this.prompts.length = promptLength;
        this.auditLogs.length = auditLength;
        throw error;
      }
    },
  );
}

function makeService(version = 4, currentContent = '当前提示词') {
  const prisma = new PromptPrismaHarness(version, currentContent);
  const encryption = {
    openFields: jest.fn((sealed: Row) => ({
      content: Buffer.from(sealed.ciphertexts.content).toString('utf8'),
    })),
    sealFields: jest.fn((fields: Row) => ({
      ciphertexts: {
        content: Buffer.from(String(fields.content), 'utf8'),
      },
      contentHashes: { content: Buffer.from(hash(String(fields.content))) },
      nonceSeed: Buffer.from(Array(24).fill(2)),
      keyId: 'test-key',
    })),
  };
  const config = {
    get: jest.fn((key: string) => {
      const values: Record<string, string> = {
        NODE_ENV: 'production',
        MINICPM_PROVIDER: 'modelbest',
        MINICPM_MODEL: 'openbmb/MiniCPM-o-4_5',
      };
      return values[key];
    }),
  };
  const service = new PlatformPromptManagementApplicationService(
    prisma as unknown as PrismaService,
    encryption as unknown as DataEncryptionPort,
    config as unknown as ConfigService,
  );
  return { prisma, encryption, service };
}

function publishCommand(content = '新的简洁提示词') {
  return {
    principal,
    expectedCurrentPromptId: CURRENT_ID,
    content,
    reason: '减少陪伴模式的冗长回复',
    request: {
      requestId: 'request-prompt-1',
      sourceIpHash: SOURCE_IP_HASH,
      userAgent: 'prompt-test',
    },
    now: new Date('2026-08-24T08:01:00.000Z'),
    promptId: NEXT_ID,
  };
}

describe('PlatformPromptManagementApplicationService', () => {
  it('opens the current audited prompt without exposing encrypted storage details', async () => {
    const { prisma, service } = makeService();

    await expect(service.getCurrentCompanionPrompt()).resolves.toEqual({
      id: CURRENT_ID,
      code: 'COMPANION_SYSTEM',
      composerVersion: 4,
      provider: 'modelbest',
      model: 'openbmb/MiniCPM-o-4_5',
      content: '当前提示词',
      contentHash: Buffer.from(hash('当前提示词')).toString('hex'),
      publishedAt: NOW.toISOString(),
    });
    expect(prisma.promptVersion.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { code: 'COMPANION_SYSTEM' },
          { code: { startsWith: 'COMPANION_SYSTEM.REVISION.' } },
        ],
      },
      orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
    });
  });

  it('publishes an immutable v4-compatible revision and audit entry atomically', async () => {
    const { prisma, encryption, service } = makeService();

    await expect(
      service.publishCompanionPrompt(publishCommand()),
    ).resolves.toMatchObject({
      id: NEXT_ID,
      code: `COMPANION_SYSTEM.REVISION.${NEXT_ID}`,
      composerVersion: 4,
      content: '新的简洁提示词',
      publishedAt: '2026-08-24T08:01:00.000Z',
    });

    expect(encryption.sealFields).toHaveBeenCalledWith(
      { content: '新的简洁提示词' },
      `prompt:${NEXT_ID}:version:4`,
    );
    expect(prisma.prompts).toHaveLength(2);
    expect(prisma.prompts[1]).toMatchObject({
      id: NEXT_ID,
      code: `COMPANION_SYSTEM.REVISION.${NEXT_ID}`,
      version: 4,
      provider: 'modelbest',
      model: 'openbmb/MiniCPM-o-4_5',
    });
    expect(prisma.auditLogs).toHaveLength(1);
    expect(prisma.auditLogs[0]).toMatchObject({
      environment: 'production',
      actorUserId: principal.userId,
      actorSessionId: principal.sessionId,
      action: 'PROMPT_REVISION_PUBLISHED',
      resourceType: 'PROMPT_VERSION',
      resourceId: NEXT_ID,
      requestId: 'request-prompt-1',
      purpose: '减少陪伴模式的冗长回复',
      decision: 'ALLOW',
      policyVersion: 'prompt-publication-v1',
      changedFieldNames: ['content'],
      beforeHash: expect.any(Uint8Array),
      afterHash: expect.any(Uint8Array),
      eventHash: expect.any(Uint8Array),
    });
  });

  it('stores a 100-character Unicode publication reason without changing the audited text', async () => {
    const { prisma, service } = makeService();
    const reason = '🙂'.repeat(100);

    await service.publishCompanionPrompt({
      ...publishCommand(),
      reason,
    });

    expect(prisma.auditLogs[0]?.purpose).toBe(reason);
  });

  it('keeps the later revision current when two publications share a millisecond', async () => {
    const { service } = makeService();
    const lowerId = '01K1P000000000000000000000';

    await service.publishCompanionPrompt({
      ...publishCommand(),
      now: NOW,
      promptId: lowerId,
    });

    await expect(service.getCurrentCompanionPrompt()).resolves.toMatchObject({
      id: lowerId,
      content: '新的简洁提示词',
      publishedAt: new Date(NOW.getTime() + 1).toISOString(),
    });
  });

  it('keeps publication audit events strictly ordered when the clock moves backwards', async () => {
    const { prisma, service } = makeService();
    const previousOccurredAt = new Date(NOW.getTime() + 10_000);
    prisma.auditLogs.push({
      id: '01K1P000000000000000000099',
      occurredAt: previousOccurredAt,
      eventHash: hash('previous-event'),
    });

    await service.publishCompanionPrompt({
      ...publishCommand(),
      now: NOW,
    });

    expect(prisma.auditLogs[1]?.occurredAt).toEqual(
      new Date(previousOccurredAt.getTime() + 1),
    );
    expect(prisma.auditLogs[1]?.previousEventHash).toEqual(
      prisma.auditLogs[0]?.eventHash,
    );
  });

  it('refuses a stale editor without creating a prompt or audit row', async () => {
    const { prisma, service } = makeService();
    const command = publishCommand();
    command.expectedCurrentPromptId = '01K1P000000000000000000099';

    await expect(
      service.publishCompanionPrompt(command),
    ).rejects.toBeInstanceOf(PromptPublicationConflictException);
    expect(prisma.prompts).toHaveLength(1);
    expect(prisma.auditLogs).toHaveLength(0);
  });

  it('keeps an unknown future composer version blocked', async () => {
    const { prisma, service } = makeService(5);

    await expect(
      service.publishCompanionPrompt(publishCommand()),
    ).rejects.toBeInstanceOf(PromptPublicationUnsupportedException);
    expect(prisma.prompts).toHaveLength(1);
    expect(prisma.auditLogs).toHaveLength(0);
  });

  it('does not create a redundant immutable revision', async () => {
    const { prisma, service } = makeService();

    await expect(
      service.publishCompanionPrompt(publishCommand('当前提示词')),
    ).rejects.toBeInstanceOf(PromptRevisionUnchangedException);
    expect(prisma.prompts).toHaveLength(1);
    expect(prisma.auditLogs).toHaveLength(0);
  });

  it('rolls back the prompt revision when the required audit write fails', async () => {
    const { prisma, service } = makeService();
    prisma.failAuditWrite = true;

    await expect(
      service.publishCompanionPrompt(publishCommand()),
    ).rejects.toThrow('audit-write-failed');
    expect(prisma.prompts).toHaveLength(1);
    expect(prisma.auditLogs).toHaveLength(0);
  });

  it('enforces the 4k limit by Unicode characters instead of UTF-16 code units', async () => {
    const accepted = makeService();
    const fourThousandCharacters = '🙂'.repeat(4_000);

    await expect(
      accepted.service.publishCompanionPrompt(
        publishCommand(fourThousandCharacters),
      ),
    ).resolves.toMatchObject({ content: fourThousandCharacters });

    const rejected = makeService();
    await expect(
      rejected.service.publishCompanionPrompt(
        publishCommand('🙂'.repeat(4_001)),
      ),
    ).rejects.toThrow('Prompt content must contain 1-4000 characters');
    expect(rejected.prisma.prompts).toHaveLength(1);
  });
});
