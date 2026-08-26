import { createHash } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  Prisma,
  type CompanionSession,
  type ConversationUtterance,
  type ConversationUtteranceContent,
  type ModelSession,
  type PromptVersion,
} from '../../infrastructure/database/generated/prisma/client';
import {
  ACTIONABLE_OCCURRENCE_LIMIT,
  ACTIONABLE_OCCURRENCE_LOOKAHEAD_MS,
  CARE_WORKFLOW_CONTENT_CIPHER,
  OCCURRENCE_STATUS,
  ROUTINE_STATUS,
} from '../care-workflow/care-workflow.constants';
import type { CareWorkflowContentCipher } from '../care-workflow/ports/content-cipher.port';
import { CONSENT_SCOPES } from '../consent/consent.constants';
import type { DevicePrincipal } from '../device-activation/device-activation.types';
import { newUlid } from '../identity/domain/ulid';
import { DATA_ENCRYPTION_PORT } from '../memory/memory.constants';
import type { DataEncryptionPort } from '../memory/ports/data-encryption.port';
import type {
  MediaLeaseOwner,
  MediaLeasePort,
} from '../realtime-communication/ports/media-lease.port';
import {
  MEDIA_LEASE_PORT,
  REMOTE_MEDIA_LEASE_TTL_SECONDS,
} from '../realtime-communication/realtime.constants';
import { RemoteMediaSecurityCoordinator } from '../realtime-communication/remote-media-security.coordinator';
import {
  COMPANION_SESSION_STATUS,
  MODEL_EVENT_TYPES,
  MODEL_SESSION_STATUS,
  promptEncryptionContext,
  utteranceEncryptionContext,
} from './companion-session.constants';
import {
  CareSnapshotChangedException,
  CompanionBindingUnavailableException,
  CompanionConsentRequiredException,
  CompanionSessionBusyException,
  CompanionSessionNotFoundException,
  CompanionSessionTerminalException,
  InvalidIdempotencyKeyException,
  InvalidUtteranceSourceException,
  ModelEventInvalidException,
  ModelPromptUnavailableException,
  ModelSessionBusyException,
  ModelSessionNotFoundException,
  UtteranceSequenceConflictException,
} from './companion-session.errors';
import {
  assertCompanionPromptComposerVersion,
  composeEffectiveCompanionPrompt,
  DEFAULT_COMPANION_SYSTEM_PROMPT,
} from './companion-prompt';
import { ensureCurrentCompanionPrompt } from './companion-prompt.registry';
import {
  CompanionLiveContextService,
  type CompanionLiveContext,
} from './companion-live-context.service';
import type {
  AppendModelEventCommand,
  AppendUtteranceCommand,
  CareSnapshot,
  CompanionSessionStartView,
  CompanionSessionView,
  ConsentSnapshot,
  DeviceContextView,
  DeviceHeartbeatView,
  ModelConnectionView,
  ModelSessionView,
  StartCompanionSessionCommand,
  StartModelSessionCommand,
  UtteranceView,
} from './companion-session.types';

const SERIALIZABLE_RETRY_LIMIT = 3;
const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CARE_SNAPSHOT_MEMORY_LIMIT = 20;
const CARE_PREFERENCE_MEMORY_LIMIT = 5;
interface BindingContext {
  id: string;
  bindingVersion: number;
  householdId: string;
  recipientId: string;
  status: string;
  device: {
    id: string;
    status: string;
  };
  recipient: {
    id: string;
    status: string;
    preferredName: string;
    timezone: string;
  };
}

interface UtteranceWithContent extends ConversationUtterance {
  content: ConversationUtteranceContent | null;
}

interface CareOccurrenceRecord {
  id: string;
  routineId: string;
  scheduledAtUtc: Date;
  status: string;
  confirmationDeadlineAt: Date | null;
  escalationAt: Date | null;
  version: number;
  routine: {
    title: string;
    type: string;
    instructionsCiphertext: Uint8Array;
    confirmationQuestionCiphertext: Uint8Array;
    contentNonce: Uint8Array;
    encryptionKeyId: string;
  };
}

@Injectable()
export class CompanionSessionApplicationService {
  private readonly logger = new Logger(CompanionSessionApplicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @Inject(DATA_ENCRYPTION_PORT)
    private readonly encryption: DataEncryptionPort,
    @Inject(MEDIA_LEASE_PORT)
    private readonly leases: MediaLeasePort,
    @Inject(CARE_WORKFLOW_CONTENT_CIPHER)
    private readonly careCipher: CareWorkflowContentCipher,
    private readonly mediaSecurity: RemoteMediaSecurityCoordinator,
    private readonly liveContext: CompanionLiveContextService,
  ) {}

  async getDeviceContext(
    principal: DevicePrincipal,
  ): Promise<DeviceContextView> {
    const binding = await this.requireBindingContext(principal);
    const consent = await this.captureConsent(
      binding.householdId,
      binding.recipientId,
    );
    const careSnapshot = await this.buildCareSnapshot(binding, consent);

    return {
      deviceId: principal.deviceId,
      bindingId: binding.id,
      householdId: binding.householdId,
      recipientId: binding.recipientId,
      recipient: {
        id: binding.recipient.id,
        preferredName: binding.recipient.preferredName,
        timezone: binding.recipient.timezone,
      },
      consent,
      careSnapshot,
      model: this.modelConfiguration(),
    };
  }

  async recordHeartbeat(
    principal: DevicePrincipal,
    details: {
      activeCompanionSessionId?: string;
      appVersion?: string;
      osVersion?: string;
    },
  ): Promise<DeviceHeartbeatView> {
    const binding = await this.requireBindingContext(principal);
    const now = new Date();
    const updated = await this.prisma.device.updateMany({
      where: { id: principal.deviceId, status: 'ACTIVE' },
      data: {
        lastSeenAt: now,
        ...(details.appVersion ? { appVersion: details.appVersion } : {}),
        ...(details.osVersion ? { osVersion: details.osVersion } : {}),
      },
    });
    if (updated.count !== 1) {
      throw new CompanionBindingUnavailableException();
    }
    const active = await this.prisma.companionSession.findFirst({
      where: {
        bindingId: binding.id,
        status: COMPANION_SESSION_STATUS.active,
      },
      select: { id: true, mode: true },
    });

    if (details.activeCompanionSessionId) {
      const reported = await this.prisma.companionSession.findFirst({
        where: {
          id: details.activeCompanionSessionId,
          bindingId: binding.id,
        },
        select: { id: true, status: true, endReason: true },
      });
      if (
        !reported ||
        reported.status !== COMPANION_SESSION_STATUS.active ||
        reported.id !== active?.id
      ) {
        return this.stopHeartbeat(
          now,
          reported?.endReason ?? 'COMPANION_SESSION_NOT_ACTIVE',
        );
      }
    }

    if (!active) {
      return this.continueHeartbeat(now);
    }

    if (!details.activeCompanionSessionId) {
      await this.endCompanionSession(
        principal,
        active.id,
        'CLIENT_SESSION_MISSING',
      );
      return this.stopHeartbeat(now, 'CLIENT_SESSION_MISSING');
    }

    const consent = await this.captureConsent(
      binding.householdId,
      binding.recipientId,
    );
    const missingScope = this.missingRuntimeConsent(consent, active.mode);
    if (missingScope) {
      const reason = `CONSENT_REVOKED_${missingScope}`;
      await this.endCompanionSession(principal, active.id, reason);
      return this.stopHeartbeat(now, reason);
    }

    const activeOwner = this.aiLeaseOwner(active.id);
    const leaseConfirmed =
      (await this.leases.renew(
        binding.id,
        activeOwner,
        REMOTE_MEDIA_LEASE_TTL_SECONDS,
      )) ||
      (await this.leases.acquire(
        binding.id,
        activeOwner,
        REMOTE_MEDIA_LEASE_TTL_SECONDS,
      ));
    if (!leaseConfirmed) {
      await this.endCompanionSession(principal, active.id, 'MEDIA_LEASE_LOST');
      return this.stopHeartbeat(now, 'MEDIA_LEASE_LOST');
    }
    const confirmed = await this.prisma.companionSession.findFirst({
      where: {
        id: active.id,
        bindingId: binding.id,
        householdId: binding.householdId,
        recipientId: binding.recipientId,
      },
      select: { status: true, endReason: true },
    });
    if (confirmed?.status !== COMPANION_SESSION_STATUS.active) {
      // Acceptance/revocation can terminalize the session after the initial
      // ACTIVE read but before a same-owner reacquire. Compare-delete the AI
      // owner we just confirmed and instruct the local runtime to stop.
      await this.safeReleaseLease(binding.id, activeOwner);
      return this.stopHeartbeat(
        now,
        confirmed?.endReason ?? 'COMPANION_SESSION_NOT_ACTIVE',
      );
    }
    return this.continueHeartbeat(now, active.id);
  }

  async startCompanionSession(
    command: StartCompanionSessionCommand,
  ): Promise<CompanionSessionStartView> {
    const idempotencyKey = this.requireIdempotencyKey(command.idempotencyKey);
    const binding = await this.requireBindingContext(command.principal);
    const consent = await this.captureConsent(
      binding.householdId,
      binding.recipientId,
    );
    this.requireConsent(consent, 'MICROPHONE_CAPTURE');
    this.requireConsent(consent, 'MODEL_PROCESSING');
    if (command.mode === 'AUDIO_VIDEO') {
      this.requireConsent(consent, 'CAMERA_CAPTURE');
    }

    const careSnapshot = await this.buildCareSnapshot(binding, consent);
    const careSnapshotHash = this.snapshotHash(careSnapshot);
    const sessionId = deterministicUlid(
      'companion-session',
      command.principal.credentialFamilyId,
      idempotencyKey,
    );
    const existing = await this.prisma.companionSession.findUnique({
      where: { id: sessionId },
    });
    if (existing) {
      this.assertSessionReplay(existing, command, careSnapshotHash);
    }
    if (existing && existing.status !== COMPANION_SESSION_STATUS.active) {
      return {
        session: this.toCompanionSessionView(existing),
        consent: this.parseConsentSnapshot(existing.consentSnapshotJson),
        careSnapshot,
      };
    }
    if (
      !existing &&
      (await this.mediaSecurity.hasRemoteMediaBarrier(this.prisma, binding.id))
    ) {
      throw new CompanionSessionBusyException();
    }

    const leaseOwner = this.aiLeaseOwner(sessionId);
    if (
      !(await this.leases.acquire(
        binding.id,
        leaseOwner,
        REMOTE_MEDIA_LEASE_TTL_SECONDS,
      ))
    ) {
      throw new CompanionSessionBusyException();
    }
    const now = new Date();
    let outcome: { session: CompanionSession; consent: ConsentSnapshot };
    try {
      outcome = await this.serializable(async (transaction) => {
        // Fence the deterministic id before any authorization/snapshot check
        // can throw. Under MySQL SERIALIZABLE this PK/gap read waits for (or
        // conflicts with) an uncommitted same-id winner, preventing a loser
        // from treating the shared Redis owner as orphaned.
        const replay = await transaction.companionSession.findUnique({
          where: { id: sessionId },
        });
        const currentBinding = await transaction.companionBinding.findFirst({
          where: {
            id: binding.id,
            deviceId: command.principal.deviceId,
            householdId: command.principal.householdId,
            recipientId: command.principal.recipientId,
            bindingVersion: command.principal.bindingVersion,
            status: 'ACTIVE',
            revokedAt: null,
            device: { status: 'ACTIVE' },
            recipient: { status: 'ACTIVE', deletedAt: null },
          },
          select: { id: true },
        });
        if (!currentBinding) {
          throw new CompanionBindingUnavailableException();
        }

        const currentConsent = await this.captureConsent(
          binding.householdId,
          binding.recipientId,
          transaction,
        );
        this.requireConsent(currentConsent, 'MICROPHONE_CAPTURE');
        this.requireConsent(currentConsent, 'MODEL_PROCESSING');
        if (command.mode === 'AUDIO_VIDEO') {
          this.requireConsent(currentConsent, 'CAMERA_CAPTURE');
        }
        if (!this.sameConsentDecisions(consent, currentConsent)) {
          throw new CareSnapshotChangedException();
        }

        if (replay) {
          this.assertSessionReplay(replay, command, careSnapshotHash);
          return { session: replay, consent: currentConsent };
        }

        const busy = await transaction.companionSession.findFirst({
          where: {
            bindingId: binding.id,
            status: COMPANION_SESSION_STATUS.active,
          },
          select: { id: true },
        });
        if (busy) {
          throw new CompanionSessionBusyException();
        }
        if (
          await this.mediaSecurity.hasRemoteMediaBarrier(
            transaction,
            binding.id,
          )
        ) {
          throw new CompanionSessionBusyException();
        }

        const session = await transaction.companionSession.create({
          data: {
            id: sessionId,
            householdId: binding.householdId,
            recipientId: binding.recipientId,
            bindingId: binding.id,
            mode: command.mode,
            status: COMPANION_SESSION_STATUS.active,
            careSnapshotHash: Uint8Array.from(careSnapshotHash),
            consentSnapshotJson:
              currentConsent as unknown as Prisma.InputJsonValue,
            startedAt: now,
            traceId: command.traceId,
          },
        });
        await transaction.outboxEvent.create({
          data: {
            id: newRandomUlid(),
            aggregateType: 'CompanionSession',
            aggregateId: session.id,
            eventType: 'CompanionSessionStarted',
            payloadJson: {
              householdId: session.householdId,
              recipientId: session.recipientId,
              bindingId: session.bindingId,
              mode: session.mode,
            },
            occurredAt: now,
            availableAt: now,
          },
        });
        return { session, consent: currentConsent };
      });
    } catch (error) {
      await this.releaseProvisionalAiLeaseIfUnowned(
        binding.id,
        sessionId,
        leaseOwner,
      );
      throw error;
    }

    if (outcome.session.status !== COMPANION_SESSION_STATUS.active) {
      await this.safeReleaseLease(binding.id, leaseOwner);
    } else {
      outcome = {
        ...outcome,
        session: (
          await this.finalizeActiveStart(command.principal, outcome.session.id)
        ).companion,
      };
    }

    return {
      session: this.toCompanionSessionView(outcome.session),
      consent: outcome.consent,
      careSnapshot,
    };
  }

  async startModelSession(
    command: StartModelSessionCommand,
  ): Promise<ModelConnectionView> {
    const idempotencyKey = this.requireIdempotencyKey(command.idempotencyKey);
    await this.requireBindingContext(command.principal);
    const companion = await this.requireOwnedCompanionSession(
      command.principal,
      command.companionSessionId,
    );
    if (companion.status !== COMPANION_SESSION_STATUS.active) {
      throw new CompanionSessionTerminalException();
    }
    if (
      !(await this.leases.renew(
        companion.bindingId,
        this.aiLeaseOwner(companion.id),
        REMOTE_MEDIA_LEASE_TTL_SECONDS,
      ))
    ) {
      throw new CompanionSessionBusyException();
    }

    const consent = await this.captureConsent(
      companion.householdId,
      companion.recipientId,
    );
    const missingScope = this.missingRuntimeConsent(consent, companion.mode);
    if (missingScope) {
      await this.endCompanionSession(
        command.principal,
        companion.id,
        `CONSENT_REVOKED_${missingScope}`,
      );
      throw new CompanionConsentRequiredException(missingScope);
    }
    const binding = await this.requireBindingContext(command.principal);
    const careSnapshot = await this.buildCareSnapshot(binding, consent);
    if (
      !Buffer.from(companion.careSnapshotHash).equals(
        this.snapshotHash(careSnapshot),
      )
    ) {
      throw new CareSnapshotChangedException();
    }

    const modelSessionId = deterministicUlid(
      'model-session',
      command.companionSessionId,
      idempotencyKey,
    );
    const existing = await this.prisma.modelSession.findUnique({
      where: { id: modelSessionId },
    });
    if (existing) {
      if (existing.companionSessionId !== command.companionSessionId) {
        throw new ModelSessionBusyException();
      }
      if (existing.status !== MODEL_SESSION_STATUS.active) {
        throw new CompanionSessionTerminalException();
      }
      const persistedPrompt = await this.requireModelSessionPrompt(existing);
      const promptContent = this.openPrompt(persistedPrompt);
      const finalized = await this.finalizeActiveStart(
        command.principal,
        companion.id,
        existing.id,
      );
      const liveContext =
        persistedPrompt.version >= 4
          ? await this.liveContext.capture({
              timezone: binding.recipient.timezone,
              sessionStartedAt: existing.startedAt,
            })
          : undefined;
      return this.modelConnection(
        finalized.model,
        persistedPrompt,
        promptContent,
        careSnapshot,
        consent,
        companion.mode,
        liveContext,
      );
    }

    const prompt = await this.ensureCurrentPrompt();
    const now = new Date();
    const created = await this.serializable(async (transaction) => {
      const replay = await transaction.modelSession.findUnique({
        where: { id: modelSessionId },
      });
      if (replay) {
        if (replay.companionSessionId !== command.companionSessionId) {
          throw new ModelSessionBusyException();
        }
        if (replay.status !== MODEL_SESSION_STATUS.active) {
          throw new CompanionSessionTerminalException();
        }
        return replay;
      }
      const currentCompanion = await transaction.companionSession.findFirst({
        where: {
          id: command.companionSessionId,
          bindingId: command.principal.bindingId,
          status: COMPANION_SESSION_STATUS.active,
        },
        select: { id: true },
      });
      if (!currentCompanion) {
        throw new CompanionSessionTerminalException();
      }
      const busy = await transaction.modelSession.findFirst({
        where: {
          companionSessionId: command.companionSessionId,
          status: MODEL_SESSION_STATUS.active,
        },
        select: { id: true },
      });
      if (busy) {
        throw new ModelSessionBusyException();
      }
      assertCompanionPromptComposerVersion(prompt.version);
      const modelSession = await transaction.modelSession.create({
        data: {
          id: modelSessionId,
          companionSessionId: command.companionSessionId,
          provider: prompt.provider,
          model: prompt.model,
          promptVersionId: prompt.id,
          status: MODEL_SESSION_STATUS.active,
          startedAt: now,
        },
      });
      await transaction.modelSessionEvent.create({
        data: {
          id: newRandomUlid(),
          modelSessionId: modelSession.id,
          eventType: 'CONNECTING',
          occurredAt: now,
        },
      });
      return modelSession;
    });

    if (created.status !== MODEL_SESSION_STATUS.active) {
      throw new CompanionSessionTerminalException();
    }

    // A same-key winner may have committed between the outer read and this
    // serializable transaction while the current prompt changed. Idempotent
    // recovery must return the immutable prompt pinned by the persisted model
    // row, not whichever prompt happened to be current for this delivery.
    const persistedPrompt = await this.requireModelSessionPrompt(created);
    const promptContent = this.openPrompt(persistedPrompt);
    const finalized = await this.finalizeActiveStart(
      command.principal,
      companion.id,
      created.id,
    );
    const liveContext =
      persistedPrompt.version >= 4
        ? await this.liveContext.capture({
            timezone: binding.recipient.timezone,
            sessionStartedAt: created.startedAt,
          })
        : undefined;
    return this.modelConnection(
      finalized.model,
      persistedPrompt,
      promptContent,
      careSnapshot,
      consent,
      companion.mode,
      liveContext,
    );
  }

  async appendUtterance(
    command: AppendUtteranceCommand,
  ): Promise<UtteranceView> {
    this.assertUtteranceSource(command);
    const modelSession = await this.requireOwnedModelSession(
      command.principal,
      command.modelSessionId,
    );
    if (
      modelSession.status !== MODEL_SESSION_STATUS.active ||
      modelSession.companionSession.status !== COMPANION_SESSION_STATUS.active
    ) {
      throw new CompanionSessionTerminalException();
    }
    const consent = await this.captureConsent(
      modelSession.companionSession.householdId,
      modelSession.companionSession.recipientId,
    );
    const missingScope = this.missingRuntimeConsent(
      consent,
      modelSession.companionSession.mode,
    );
    if (missingScope) {
      await this.endCompanionSession(
        command.principal,
        modelSession.companionSession.id,
        `CONSENT_REVOKED_${missingScope}`,
      );
      throw new CompanionConsentRequiredException(missingScope);
    }
    if (command.speaker === 'USER') {
      this.requireConsent(consent, 'MODEL_INPUT_TRANSCRIPTION');
    }

    const existing = await this.prisma.conversationUtterance.findFirst({
      where: {
        modelSessionId: command.modelSessionId,
        providerEventId: command.providerEventId,
      },
      include: { content: true },
    });
    if (existing) {
      this.assertUtteranceReplay(existing, command);
      return this.toUtteranceView(existing);
    }
    const occupiedSequence = await this.prisma.conversationUtterance.findUnique(
      {
        where: {
          modelSessionId_sequenceNo: {
            modelSessionId: command.modelSessionId,
            sequenceNo: command.sequenceNo,
          },
        },
        select: { id: true },
      },
    );
    if (occupiedSequence) {
      throw new UtteranceSequenceConflictException();
    }

    const normalizedText = command.rawText?.trim();
    if (command.isFinal && !normalizedText) {
      throw new InvalidUtteranceSourceException();
    }
    const utteranceId = newRandomUlid();
    const sealed = normalizedText
      ? this.encryption.sealFields(
          { rawText: normalizedText },
          utteranceEncryptionContext(utteranceId),
        )
      : null;
    const retentionUntil = normalizedText
      ? this.transcriptRetentionUntil(new Date())
      : null;

    try {
      const created = await this.prisma.$transaction(
        async (transaction) => {
          await this.requireTransactionalRuntimeAuthorization(
            transaction,
            command.principal,
            command.modelSessionId,
            command.speaker === 'USER',
          );
          const utterance = await transaction.conversationUtterance.create({
            data: {
              id: utteranceId,
              modelSessionId: command.modelSessionId,
              sequenceNo: command.sequenceNo,
              speaker: command.speaker,
              bindingId: command.principal.bindingId,
              providerEventId: command.providerEventId,
              startOffsetMs: command.startOffsetMs,
              endOffsetMs: command.endOffsetMs,
              isFinal: command.isFinal,
              language: command.language,
              confidence: command.confidence,
              ...(sealed
                ? {
                    content: {
                      create: {
                        rawTextCiphertext: Uint8Array.from(
                          sealed.ciphertexts.rawText!,
                        ),
                        nonce: Uint8Array.from(sealed.nonceSeed),
                        encryptionKeyId: sealed.keyId,
                        contentHash: Uint8Array.from(
                          sealed.contentHashes.rawText!,
                        ),
                        charCount: Array.from(normalizedText!).length,
                        retentionUntil,
                      },
                    },
                  }
                : {}),
            },
            include: { content: true },
          });
          if (command.speaker === 'ASSISTANT' && command.isFinal) {
            await transaction.modelSession.updateMany({
              where: { id: command.modelSessionId, firstResponseAt: null },
              data: { firstResponseAt: new Date() },
            });
          }
          return utterance;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      return this.toUtteranceView(created);
    } catch (error) {
      if (isPrismaConflict(error)) {
        const replay = await this.prisma.conversationUtterance.findFirst({
          where: {
            modelSessionId: command.modelSessionId,
            providerEventId: command.providerEventId,
          },
          include: { content: true },
        });
        if (replay) {
          this.assertUtteranceReplay(replay, command);
          return this.toUtteranceView(replay);
        }
        throw new UtteranceSequenceConflictException();
      }
      throw error;
    }
  }

  async appendModelEvent(command: AppendModelEventCommand): Promise<{
    id: string;
    eventType: string;
    occurredAt: string;
  }> {
    if (!MODEL_EVENT_TYPES.includes(command.eventType)) {
      throw new ModelEventInvalidException();
    }
    const modelSession = await this.requireOwnedModelSession(
      command.principal,
      command.modelSessionId,
    );
    if (
      modelSession.status !== MODEL_SESSION_STATUS.active ||
      modelSession.companionSession.status !== COMPANION_SESSION_STATUS.active
    ) {
      throw new CompanionSessionTerminalException();
    }
    const consent = await this.captureConsent(
      modelSession.companionSession.householdId,
      modelSession.companionSession.recipientId,
    );
    const missingScope = this.missingRuntimeConsent(
      consent,
      modelSession.companionSession.mode,
    );
    if (missingScope) {
      await this.endCompanionSession(
        command.principal,
        modelSession.companionSession.id,
        `CONSENT_REVOKED_${missingScope}`,
      );
      throw new CompanionConsentRequiredException(missingScope);
    }
    const metrics = this.sanitizeMetrics(command.metrics);
    const now = new Date();
    const event = await this.prisma.$transaction(
      async (transaction) => {
        await this.requireTransactionalRuntimeAuthorization(
          transaction,
          command.principal,
          command.modelSessionId,
          false,
        );
        const created = await transaction.modelSessionEvent.create({
          data: {
            id: newRandomUlid(),
            modelSessionId: command.modelSessionId,
            eventType: command.eventType,
            metricsJson: metrics,
            errorCode: command.errorCode?.trim() || null,
            occurredAt: now,
          },
        });
        if (command.eventType === 'FIRST_RESPONSE') {
          await transaction.modelSession.updateMany({
            where: { id: command.modelSessionId, firstResponseAt: null },
            data: { firstResponseAt: now },
          });
        }
        if (command.eventType === 'DISCONNECTED') {
          await transaction.modelSession.updateMany({
            where: {
              id: command.modelSessionId,
              status: MODEL_SESSION_STATUS.active,
            },
            data: {
              status: MODEL_SESSION_STATUS.ended,
              endedAt: now,
              endReason: 'PROVIDER_DISCONNECTED',
            },
          });
        }
        return created;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
    return {
      id: event.id,
      eventType: event.eventType,
      occurredAt: event.occurredAt.toISOString(),
    };
  }

  async endCompanionSession(
    principal: DevicePrincipal,
    sessionId: string,
    reason: string,
  ): Promise<CompanionSessionView> {
    const existing = await this.requireOwnedCompanionSession(
      principal,
      sessionId,
    );
    if (existing.status !== COMPANION_SESSION_STATUS.active) {
      await this.safeReleaseLease(
        existing.bindingId,
        this.aiLeaseOwner(existing.id),
      );
      return this.toCompanionSessionView(existing);
    }
    const now = new Date();
    const ended = await this.serializable(async (transaction) => {
      // All media handoff paths acquire model-session locks before the
      // companion row. Preserve that global order, then use the companion CAS
      // to select the sole command allowed to end models and emit the outbox.
      await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT \`id\`
        FROM \`model_sessions\`
        WHERE \`companion_session_id\` = ${sessionId}
          AND \`status\` = ${MODEL_SESSION_STATUS.active}
        FOR UPDATE
      `);
      const current = await transaction.companionSession.findUnique({
        where: { id: sessionId },
      });
      if (!current || current.status !== COMPANION_SESSION_STATUS.active) {
        return current;
      }
      const changed = await transaction.companionSession.updateMany({
        where: { id: sessionId, status: COMPANION_SESSION_STATUS.active },
        data: {
          status: COMPANION_SESSION_STATUS.ended,
          endedAt: now,
          endReason: reason.trim().slice(0, 64),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        return transaction.companionSession.findUnique({
          where: { id: sessionId },
        });
      }
      await transaction.modelSession.updateMany({
        where: {
          companionSessionId: sessionId,
          status: MODEL_SESSION_STATUS.active,
        },
        data: {
          status: MODEL_SESSION_STATUS.ended,
          endedAt: now,
          endReason: 'COMPANION_SESSION_ENDED',
        },
      });
      await transaction.outboxEvent.create({
        data: {
          id: newRandomUlid(),
          aggregateType: 'CompanionSession',
          aggregateId: sessionId,
          eventType: 'CompanionSessionEnded',
          payloadJson: {
            householdId: existing.householdId,
            recipientId: existing.recipientId,
            bindingId: existing.bindingId,
            reason: reason.trim().slice(0, 64),
          },
          occurredAt: now,
          availableAt: now,
        },
      });
      return transaction.companionSession.findUnique({
        where: { id: sessionId },
      });
    });
    if (!ended) {
      throw new CompanionSessionNotFoundException();
    }
    await this.safeReleaseLease(ended.bindingId, this.aiLeaseOwner(ended.id));
    return this.toCompanionSessionView(ended);
  }

  private aiLeaseOwner(sessionId: string): MediaLeaseOwner {
    return {
      ownerType: 'AI_COMPANION',
      ownerId: sessionId,
      leaseId: sessionId,
    };
  }

  private continueHeartbeat(
    now: Date,
    activeCompanionSessionId?: string,
  ): DeviceHeartbeatView {
    return {
      online: true,
      serverTime: now.toISOString(),
      mediaDirective: 'CONTINUE',
      ...(activeCompanionSessionId ? { activeCompanionSessionId } : {}),
    };
  }

  private stopHeartbeat(now: Date, reason: string): DeviceHeartbeatView {
    return {
      online: true,
      serverTime: now.toISOString(),
      mediaDirective: 'STOP',
      reason,
    };
  }

  private async safeReleaseLease(
    bindingId: string,
    owner: MediaLeaseOwner,
  ): Promise<void> {
    try {
      await this.leases.release(bindingId, owner);
    } catch (error) {
      this.logger.warn(
        `AI media lease release deferred (${error instanceof Error ? error.name : 'unknown'})`,
      );
    }
  }

  private async releaseProvisionalAiLeaseIfUnowned(
    bindingId: string,
    sessionId: string,
    owner: MediaLeaseOwner,
  ): Promise<void> {
    try {
      const persisted = await this.prisma.companionSession.findFirst({
        where: {
          id: sessionId,
          bindingId,
        },
        select: { id: true, status: true },
      });
      if (persisted?.status === COMPANION_SESSION_STATUS.active) {
        return;
      }
      if (!persisted) {
        // The deterministic owner is shared by idempotent deliveries. A
        // same-id winner may still be uncommitted and therefore invisible to
        // this autocommit read. Preserve the bounded lease; a later start can
        // renew it and idle recovery is capped by Redis TTL.
        return;
      }
    } catch (error) {
      // On an uncertain database read, preserve the short lease. Releasing it
      // could steal ownership from a concurrent successful idempotent request;
      // TTL and authenticated heartbeat provide bounded recovery.
      this.logger.warn(
        `AI provisional lease ownership check deferred (${error instanceof Error ? error.name : 'unknown'})`,
      );
      return;
    }
    await this.safeReleaseLease(bindingId, owner);
  }

  private async requireBindingContext(
    principal: DevicePrincipal,
  ): Promise<BindingContext> {
    const binding = await this.prisma.companionBinding.findFirst({
      where: {
        id: principal.bindingId,
        deviceId: principal.deviceId,
        householdId: principal.householdId,
        recipientId: principal.recipientId,
        bindingVersion: principal.bindingVersion,
        status: 'ACTIVE',
        revokedAt: null,
        device: { status: 'ACTIVE' },
        recipient: { status: 'ACTIVE', deletedAt: null },
      },
      include: {
        device: { select: { id: true, status: true } },
        recipient: {
          select: {
            id: true,
            status: true,
            preferredName: true,
            timezone: true,
          },
        },
      },
    });
    if (!binding) {
      throw new CompanionBindingUnavailableException();
    }
    return binding;
  }

  private async captureConsent(
    householdId: string,
    recipientId: string,
    client: Pick<Prisma.TransactionClient, 'recipientConsentState'> = this
      .prisma,
  ): Promise<ConsentSnapshot> {
    const rows = await client.recipientConsentState.findMany({
      where: { householdId, recipientId },
      select: { scope: true, decision: true },
    });
    const persisted = new Map(rows.map((row) => [row.scope, row.decision]));
    return {
      capturedAt: new Date().toISOString(),
      decisions: Object.fromEntries(
        CONSENT_SCOPES.map((scope) => [
          scope,
          persisted.get(scope) === 'GRANTED',
        ]),
      ),
    };
  }

  private requireConsent(snapshot: ConsentSnapshot, scope: string): void {
    if (snapshot.decisions[scope] !== true) {
      throw new CompanionConsentRequiredException(scope);
    }
  }

  private sameConsentDecisions(
    left: ConsentSnapshot,
    right: ConsentSnapshot,
  ): boolean {
    return CONSENT_SCOPES.every(
      (scope) => left.decisions[scope] === right.decisions[scope],
    );
  }

  private missingRuntimeConsent(
    snapshot: ConsentSnapshot,
    mode: string,
  ): string | undefined {
    return [
      'MICROPHONE_CAPTURE',
      'MODEL_PROCESSING',
      ...(mode === 'AUDIO_VIDEO' ? ['CAMERA_CAPTURE'] : []),
    ].find((scope) => snapshot.decisions[scope] !== true);
  }

  private async buildCareSnapshot(
    binding: BindingContext,
    consent: ConsentSnapshot,
  ): Promise<CareSnapshot> {
    const now = new Date();
    const lookaheadEnd = new Date(
      now.getTime() + ACTIONABLE_OCCURRENCE_LOOKAHEAD_MS,
    );
    const memoryReads = consent.decisions.MEMORY_STORAGE
      ? this.prisma.$transaction(
          async (transaction) =>
            Promise.all([
              transaction.memory.findMany({
                where: {
                  householdId: binding.householdId,
                  recipientId: binding.recipientId,
                  kind: 'PREFERENCE',
                  status: 'ACTIVE',
                  verificationStatus: {
                    in: ['FAMILY_REPORTED', 'FAMILY_VERIFIED'],
                  },
                  deletedAt: null,
                },
                include: {
                  revisions: { orderBy: { revisionNo: 'desc' }, take: 1 },
                },
                orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
                take: CARE_PREFERENCE_MEMORY_LIMIT,
              }),
              transaction.memory.findMany({
                where: {
                  householdId: binding.householdId,
                  recipientId: binding.recipientId,
                  kind: { not: 'PREFERENCE' },
                  status: 'ACTIVE',
                  verificationStatus: {
                    in: ['FAMILY_REPORTED', 'FAMILY_VERIFIED'],
                  },
                  deletedAt: null,
                },
                include: {
                  revisions: { orderBy: { revisionNo: 'desc' }, take: 1 },
                },
                orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
                take: CARE_SNAPSHOT_MEMORY_LIMIT,
              }),
            ]),
          { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
        )
      : Promise.resolve([[], []] as const);
    const [[preferenceMemories, generalMemories], occurrenceRows] =
      await Promise.all([
        memoryReads,
        this.prisma.routineOccurrence.findMany({
          where: {
            householdId: binding.householdId,
            recipientId: binding.recipientId,
            routine: { status: ROUTINE_STATUS.active, deletedAt: null },
            schedule: { active: true },
            OR: [
              {
                status: {
                  in: [
                    OCCURRENCE_STATUS.awaitingConfirmation,
                    OCCURRENCE_STATUS.needsFamilyReview,
                  ],
                },
              },
              {
                status: OCCURRENCE_STATUS.due,
                scheduledAtUtc: { lte: lookaheadEnd },
              },
            ],
          },
          select: {
            id: true,
            routineId: true,
            scheduledAtUtc: true,
            status: true,
            confirmationDeadlineAt: true,
            escalationAt: true,
            version: true,
            routine: {
              select: {
                title: true,
                type: true,
                instructionsCiphertext: true,
                confirmationQuestionCiphertext: true,
                contentNonce: true,
                encryptionKeyId: true,
              },
            },
          },
          orderBy: [{ scheduledAtUtc: 'asc' }, { id: 'asc' }],
          take: ACTIONABLE_OCCURRENCE_LIMIT,
        }),
      ]);

    const remainingGeneralMemoryLimit = Math.max(
      0,
      CARE_SNAPSHOT_MEMORY_LIMIT - preferenceMemories.length,
    );
    const memories = [
      ...preferenceMemories,
      ...generalMemories.slice(0, remainingGeneralMemoryLimit),
    ];

    const occurrences = (occurrenceRows as CareOccurrenceRecord[]).flatMap(
      (occurrence) => {
        if (!this.isActionableOccurrence(occurrence, lookaheadEnd)) {
          return [];
        }
        const content = this.openCareRoutineContent(occurrence.routine);
        return [
          {
            id: occurrence.id,
            routineId: occurrence.routineId,
            routineTitle: occurrence.routine.title,
            routineType: occurrence.routine.type,
            instructions: content.instructions,
            confirmationQuestion: content.confirmationQuestion,
            scheduledAtUtc: occurrence.scheduledAtUtc.toISOString(),
            status: occurrence.status,
            confirmationDeadlineAt:
              occurrence.confirmationDeadlineAt?.toISOString() ?? null,
            escalationAt: occurrence.escalationAt?.toISOString() ?? null,
            version: occurrence.version,
          },
        ];
      },
    );

    return {
      schemaVersion: 1,
      recipient: {
        id: binding.recipient.id,
        preferredName: binding.recipient.preferredName,
        timezone: binding.recipient.timezone,
      },
      memories: memories.flatMap((memory) => {
        const revision = memory.revisions[0];
        if (!revision || revision.revisionNo !== memory.currentRevisionNo) {
          return [];
        }
        const opened = this.encryption.openFields(
          {
            ciphertexts: {
              content: Buffer.from(revision.contentCiphertext),
            },
            contentHashes: { content: Buffer.from(revision.contentHash) },
            nonceSeed: Buffer.from(revision.contentNonce),
            keyId: revision.encryptionKeyId,
          },
          `memory:${memory.id}:revision:${revision.revisionNo}`,
        );
        return [
          {
            id: memory.id,
            kind: memory.kind,
            title: memory.title,
            content: opened.content ?? '',
            sensitivity: memory.sensitivity,
            verificationStatus: memory.verificationStatus,
            revisionNo: revision.revisionNo,
          },
        ];
      }),
      occurrences,
    };
  }

  private isActionableOccurrence(
    occurrence: CareOccurrenceRecord,
    lookaheadEnd: Date,
  ): boolean {
    return (
      occurrence.status === OCCURRENCE_STATUS.awaitingConfirmation ||
      occurrence.status === OCCURRENCE_STATUS.needsFamilyReview ||
      (occurrence.status === OCCURRENCE_STATUS.due &&
        occurrence.scheduledAtUtc <= lookaheadEnd)
    );
  }

  private openCareRoutineContent(record: CareOccurrenceRecord['routine']): {
    instructions: string;
    confirmationQuestion: string;
  } {
    const plaintext = this.careCipher.decrypt({
      ciphertext: Buffer.concat([
        Buffer.from(record.instructionsCiphertext),
        Buffer.from(record.confirmationQuestionCiphertext),
      ]),
      nonce: Buffer.from(record.contentNonce),
      encryptionKeyId: record.encryptionKeyId,
    });
    const parsed: unknown = JSON.parse(plaintext);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string'
    ) {
      throw new Error('Protected care routine content pair is invalid');
    }
    return {
      instructions: parsed[0],
      confirmationQuestion: parsed[1],
    };
  }

  private async ensureCurrentPrompt(): Promise<PromptVersion> {
    const id = newRandomUlid();
    const content =
      this.config.get<string>('MINICPM_SYSTEM_PROMPT')?.trim() ||
      DEFAULT_COMPANION_SYSTEM_PROMPT;
    const model = this.modelConfiguration();
    return ensureCurrentCompanionPrompt(this.prisma, this.encryption, {
      id,
      content,
      provider: model.provider,
      model: model.model,
      publishedAt: new Date(),
    });
  }

  private async requireModelSessionPrompt(
    session: ModelSession,
  ): Promise<PromptVersion> {
    const prompt = await this.prisma.promptVersion.findUnique({
      where: { id: session.promptVersionId },
    });
    if (
      !prompt ||
      prompt.provider !== session.provider ||
      prompt.model !== session.model
    ) {
      throw new ModelPromptUnavailableException();
    }
    return prompt;
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
      throw new ModelPromptUnavailableException();
    }
    return opened.content;
  }

  private async requireOwnedCompanionSession(
    principal: DevicePrincipal,
    sessionId: string,
  ): Promise<CompanionSession> {
    const session = await this.prisma.companionSession.findFirst({
      where: {
        id: sessionId,
        bindingId: principal.bindingId,
        householdId: principal.householdId,
        recipientId: principal.recipientId,
      },
    });
    if (!session) {
      throw new CompanionSessionNotFoundException();
    }
    return session;
  }

  private async requireOwnedModelSession(
    principal: DevicePrincipal,
    modelSessionId: string,
  ) {
    const session = await this.prisma.modelSession.findFirst({
      where: {
        id: modelSessionId,
        companionSession: {
          bindingId: principal.bindingId,
          householdId: principal.householdId,
          recipientId: principal.recipientId,
        },
      },
      include: { companionSession: true },
    });
    if (!session) {
      throw new ModelSessionNotFoundException();
    }
    return session;
  }

  private async finalizeActiveStart(
    principal: DevicePrincipal,
    companionSessionId: string,
  ): Promise<{ companion: CompanionSession; model: null }>;
  private async finalizeActiveStart(
    principal: DevicePrincipal,
    companionSessionId: string,
    modelSessionId: string,
  ): Promise<{ companion: CompanionSession; model: ModelSession }>;
  private async finalizeActiveStart(
    principal: DevicePrincipal,
    companionSessionId: string,
    modelSessionId?: string,
  ): Promise<{
    companion: CompanionSession;
    model: ModelSession | null;
  }> {
    return this.serializable(async (transaction) => {
      // Remote acceptance ends model rows before the companion row. Lock in
      // that same order to avoid a lock-order inversion, then renew Redis while
      // the durable ACTIVE rows remain fenced. If the remote lease transfer
      // already won, renewal fails and no stale ACTIVE response is returned.
      let model: ModelSession | null = null;
      if (modelSessionId) {
        model = await transaction.modelSession.findUnique({
          where: { id: modelSessionId },
        });
        if (
          !model ||
          model.companionSessionId !== companionSessionId ||
          model.status !== MODEL_SESSION_STATUS.active
        ) {
          throw new CompanionSessionTerminalException();
        }
      }

      const companion = await transaction.companionSession.findUnique({
        where: { id: companionSessionId },
      });
      if (
        !companion ||
        companion.bindingId !== principal.bindingId ||
        companion.householdId !== principal.householdId ||
        companion.recipientId !== principal.recipientId ||
        companion.status !== COMPANION_SESSION_STATUS.active
      ) {
        throw new CompanionSessionTerminalException();
      }

      if (
        !(await this.leases.renew(
          companion.bindingId,
          this.aiLeaseOwner(companion.id),
          REMOTE_MEDIA_LEASE_TTL_SECONDS,
        ))
      ) {
        throw new CompanionSessionBusyException();
      }

      return { companion, model };
    });
  }

  private async requireTransactionalRuntimeAuthorization(
    transaction: Prisma.TransactionClient,
    principal: DevicePrincipal,
    modelSessionId: string,
    requireTranscription: boolean,
  ): Promise<void> {
    const current = await transaction.modelSession.findFirst({
      where: {
        id: modelSessionId,
        status: MODEL_SESSION_STATUS.active,
        companionSession: {
          bindingId: principal.bindingId,
          householdId: principal.householdId,
          recipientId: principal.recipientId,
          status: COMPANION_SESSION_STATUS.active,
        },
      },
      include: { companionSession: true },
    });
    if (!current) {
      throw new CompanionSessionTerminalException();
    }
    const consent = await this.captureConsent(
      current.companionSession.householdId,
      current.companionSession.recipientId,
      transaction,
    );
    const missingScope = this.missingRuntimeConsent(
      consent,
      current.companionSession.mode,
    );
    if (missingScope) {
      throw new CompanionConsentRequiredException(missingScope);
    }
    if (requireTranscription) {
      this.requireConsent(consent, 'MODEL_INPUT_TRANSCRIPTION');
    }
  }

  private modelConfiguration(): {
    provider: string;
    model: string;
    realtimeUrl: string;
  } {
    return {
      provider: this.config.get<string>('MINICPM_PROVIDER') ?? 'modelbest',
      model:
        this.config.get<string>('MINICPM_MODEL') ?? 'openbmb/MiniCPM-o-4_5',
      realtimeUrl:
        this.config.get<string>('MINICPM_REALTIME_URL') ??
        'wss://minicpmo45.modelbest.cn/v1/realtime',
    };
  }

  private modelConnection(
    session: ModelSession,
    prompt: PromptVersion,
    content: string,
    careSnapshot: CareSnapshot,
    consent: ConsentSnapshot,
    mode: string,
    liveContext: CompanionLiveContext | undefined,
  ): ModelConnectionView {
    const configuration = this.modelConfiguration();
    return {
      session: this.toModelSessionView(session),
      connection: {
        realtimeUrl: configuration.realtimeUrl,
        model: session.model,
      },
      prompt: {
        id: prompt.id,
        code: prompt.code,
        version: prompt.version,
        content: composeEffectiveCompanionPrompt(
          prompt.version,
          content,
          careSnapshot,
          {
            mode,
            consent,
            liveContext,
          },
        ),
      },
      careSnapshot,
      consent,
    };
  }

  private toCompanionSessionView(
    session: CompanionSession,
  ): CompanionSessionView {
    return {
      id: session.id,
      householdId: session.householdId,
      recipientId: session.recipientId,
      bindingId: session.bindingId,
      mode: session.mode === 'AUDIO_VIDEO' ? 'AUDIO_VIDEO' : 'AUDIO',
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      endedAt: session.endedAt?.toISOString() ?? null,
      endReason: session.endReason,
      traceId: session.traceId,
      version: session.version,
    };
  }

  private toModelSessionView(session: ModelSession): ModelSessionView {
    return {
      id: session.id,
      companionSessionId: session.companionSessionId,
      provider: session.provider,
      model: session.model,
      status: session.status,
      startedAt: session.startedAt.toISOString(),
      firstResponseAt: session.firstResponseAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
      endReason: session.endReason,
      errorCode: session.errorCode,
    };
  }

  private toUtteranceView(utterance: UtteranceWithContent): UtteranceView {
    const speaker = utterance.speaker === 'USER' ? 'USER' : 'ASSISTANT';
    return {
      id: utterance.id,
      modelSessionId: utterance.modelSessionId,
      sequenceNo: utterance.sequenceNo,
      speaker,
      source: speaker === 'USER' ? 'ASR' : 'MODEL',
      providerEventId: utterance.providerEventId ?? '',
      startOffsetMs: utterance.startOffsetMs,
      endOffsetMs: utterance.endOffsetMs,
      isFinal: utterance.isFinal,
      language: utterance.language,
      confidence: utterance.confidence,
      charCount: utterance.content?.charCount ?? null,
      createdAt: utterance.createdAt.toISOString(),
    };
  }

  private requireIdempotencyKey(value: string): string {
    const normalized = value.trim();
    if (
      normalized.length < 8 ||
      normalized.length > 128 ||
      !/^[A-Za-z0-9._:-]+$/.test(normalized)
    ) {
      throw new InvalidIdempotencyKeyException();
    }
    return normalized;
  }

  private snapshotHash(snapshot: CareSnapshot): Buffer {
    return createHash('sha256')
      .update(canonicalJson(snapshot), 'utf8')
      .digest();
  }

  private parseConsentSnapshot(value: Prisma.JsonValue): ConsentSnapshot {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new CareSnapshotChangedException();
    }
    const capturedAt = value.capturedAt;
    const decisions = value.decisions;
    if (
      typeof capturedAt !== 'string' ||
      !decisions ||
      typeof decisions !== 'object' ||
      Array.isArray(decisions)
    ) {
      throw new CareSnapshotChangedException();
    }
    return {
      capturedAt,
      decisions: Object.fromEntries(
        Object.entries(decisions).map(([key, decision]) => [
          key,
          decision === true,
        ]),
      ),
    };
  }

  private assertSessionReplay(
    session: CompanionSession,
    command: StartCompanionSessionCommand,
    careSnapshotHash: Buffer,
  ): void {
    if (
      session.bindingId !== command.principal.bindingId ||
      session.householdId !== command.principal.householdId ||
      session.recipientId !== command.principal.recipientId ||
      session.mode !== command.mode ||
      !Buffer.from(session.careSnapshotHash).equals(careSnapshotHash)
    ) {
      throw new CareSnapshotChangedException();
    }
  }

  private assertUtteranceSource(command: AppendUtteranceCommand): void {
    if (
      (command.speaker === 'USER' && command.source !== 'ASR') ||
      (command.speaker === 'ASSISTANT' && command.source !== 'MODEL') ||
      command.providerEventId.trim().length === 0 ||
      (command.endOffsetMs !== undefined &&
        command.startOffsetMs !== undefined &&
        command.endOffsetMs < command.startOffsetMs)
    ) {
      throw new InvalidUtteranceSourceException();
    }
  }

  private assertUtteranceReplay(
    utterance: UtteranceWithContent,
    command: AppendUtteranceCommand,
  ): void {
    const expectedCharCount = command.rawText?.trim()
      ? Array.from(command.rawText.trim()).length
      : null;
    if (
      utterance.sequenceNo !== command.sequenceNo ||
      utterance.speaker !== command.speaker ||
      utterance.bindingId !== command.principal.bindingId ||
      utterance.isFinal !== command.isFinal ||
      utterance.startOffsetMs !== (command.startOffsetMs ?? null) ||
      utterance.endOffsetMs !== (command.endOffsetMs ?? null) ||
      utterance.content?.charCount !== expectedCharCount
    ) {
      throw new UtteranceSequenceConflictException();
    }
  }

  private sanitizeMetrics(
    metrics: Record<string, number> | undefined,
  ): Record<string, number> | undefined {
    if (!metrics) {
      return undefined;
    }
    const entries = Object.entries(metrics);
    if (
      entries.length > 20 ||
      entries.some(
        ([key, value]) =>
          !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) ||
          typeof value !== 'number' ||
          !Number.isFinite(value) ||
          Math.abs(value) > 1_000_000_000_000,
      )
    ) {
      throw new ModelEventInvalidException();
    }
    return Object.fromEntries(entries);
  }

  private transcriptRetentionUntil(now: Date): Date | null {
    const days = this.config.get<number>('TRANSCRIPT_RETENTION_DAYS') ?? 30;
    if (!Number.isInteger(days) || days < 1 || days > 365) {
      return null;
    }
    return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
  }

  private async serializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (attempt === SERIALIZABLE_RETRY_LIMIT || !isRetryable(error)) {
          throw error;
        }
      }
    }
    throw new CompanionSessionBusyException();
  }
}

function deterministicUlid(namespace: string, ...parts: string[]): string {
  const digest = createHash('sha256')
    .update(`memory-lighthouse:${namespace}:v1\0`)
    .update(parts.join('\0'))
    .digest()
    .subarray(0, 16);
  let value = 0n;
  for (const byte of digest) {
    value = (value << 8n) | BigInt(byte);
  }
  let result = '';
  for (let index = 0; index < 26; index += 1) {
    result = CROCKFORD_BASE32[Number(value & 31n)] + result;
    value >>= 5n;
  }
  return result;
}

function newRandomUlid(): string {
  return newUlid();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(',')}}`;
}

function isPrismaConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error.code === 'P2002' || error.code === 'P2034')
  );
}

function isRetryable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2034'
  );
}
