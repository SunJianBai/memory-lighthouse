import { describe, expect, it, jest } from '@jest/globals';

import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { CareWorkflowContentCipher } from '../care-workflow/ports/content-cipher.port';
import type { DataEncryptionPort } from '../memory/ports/data-encryption.port';
import type { MediaLeasePort } from '../realtime-communication/ports/media-lease.port';
import { CompanionSessionApplicationService } from './companion-session.application.service';

jest.mock('../../infrastructure/database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const principal = {
  kind: 'DEVICE' as const,
  tokenId: '01J00000000000000000000001',
  credentialId: '01J00000000000000000000002',
  credentialFamilyId: '01J00000000000000000000003',
  deviceId: '01J00000000000000000000004',
  bindingId: '01J00000000000000000000005',
  householdId: '01J00000000000000000000006',
  recipientId: '01J00000000000000000000007',
  bindingVersion: 1,
  capabilities: ['COMPANION' as const],
};

const binding = {
  id: principal.bindingId,
  bindingVersion: 1,
  householdId: principal.householdId,
  recipientId: principal.recipientId,
  status: 'ACTIVE',
  device: { id: principal.deviceId, status: 'ACTIVE' },
  recipient: {
    id: principal.recipientId,
    status: 'ACTIVE',
    preferredName: '王奶奶',
    timezone: 'Asia/Shanghai',
  },
};

function codeOf(error: unknown): string | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('getResponse' in error) ||
    typeof error.getResponse !== 'function'
  ) {
    return undefined;
  }
  return (error.getResponse() as { code?: string }).code;
}

function serviceWith(options: {
  consent: string[];
  modelSession?: Record<string, unknown>;
}) {
  const prisma = {
    companionBinding: { findFirst: jest.fn(async () => binding) },
    recipientConsentState: {
      findMany: jest.fn(async () =>
        options.consent.map((scope) => ({ scope, decision: 'GRANTED' })),
      ),
    },
    modelSession: {
      findFirst: jest.fn(async () => options.modelSession ?? null),
    },
  };
  const config = { get: jest.fn(() => undefined) };
  const encryption = {
    sealFields: jest.fn(),
    openFields: jest.fn(),
  };
  const leases = {
    acquire: jest.fn(() => Promise.resolve(true)),
    renew: jest.fn(() => Promise.resolve(true)),
    transfer: jest.fn(() => Promise.resolve(true)),
    release: jest.fn(() => Promise.resolve()),
    current: jest.fn(() => Promise.resolve(null)),
  };
  const careCipher = {
    encrypt: jest.fn(),
    decrypt: jest.fn(),
  };
  const mediaSecurity = {
    hasPendingCleanup: jest.fn(async () => false),
    hasRemoteMediaBarrier: jest.fn(async () => false),
  };
  return new CompanionSessionApplicationService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    encryption as unknown as DataEncryptionPort,
    leases as unknown as MediaLeasePort,
    careCipher as unknown as CareWorkflowContentCipher,
    mediaSecurity as never,
  );
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function lifecycleHarness() {
  let consentScopes = new Set(['MICROPHONE_CAPTURE', 'MODEL_PROCESSING']);
  let consentReadCount = 0;
  let pendingConsentGate:
    | {
        readNumber: number;
        reached: ReturnType<typeof deferred>;
        release: ReturnType<typeof deferred>;
      }
    | undefined;
  let transactionCount = 0;
  let pendingTransactionGate:
    | {
        transactionNumber: number;
        reached: ReturnType<typeof deferred>;
        release: ReturnType<typeof deferred>;
      }
    | undefined;
  let storedSession: Record<string, unknown> | null = null;
  let storedModelSession: Record<string, unknown> | null = null;
  const promptA = {
    id: '01J00000000000000000000008',
    code: 'companion-system',
    version: 2,
    provider: 'modelbest',
    model: 'openbmb/MiniCPM-o-4_5',
    contentHash: Uint8Array.from([1]),
    contentCiphertext: Uint8Array.from([2]),
    contentNonce: Uint8Array.from([3]),
    encryptionKeyId: 'test-key',
    publishedAt: new Date(),
    revokedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  let currentPrompt = promptA;
  const promptVersions = new Map<string, typeof promptA>([
    [promptA.id, promptA],
  ]);

  const recipientConsentState = {
    findMany: jest.fn(async () => {
      consentReadCount += 1;
      const gate = pendingConsentGate;
      if (gate?.readNumber === consentReadCount) {
        gate.reached.resolve();
        await gate.release.promise;
        pendingConsentGate = undefined;
      }
      return [...consentScopes].map((scope) => ({
        scope,
        decision: 'GRANTED',
      }));
    }),
  };
  const companionSession = {
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
      storedSession?.id === where.id ? { ...storedSession } : null,
    ),
    findFirst: jest.fn(
      async ({
        where,
      }: {
        where: { id?: string; bindingId?: string; status?: string };
      }) => {
        if (!storedSession) return null;
        if (where.id && storedSession.id !== where.id) return null;
        if (where.bindingId && storedSession.bindingId !== where.bindingId) {
          return null;
        }
        if (where.status && storedSession.status !== where.status) return null;
        return { ...storedSession };
      },
    ),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      storedSession = {
        ...data,
        endedAt: null,
        endReason: null,
        createdAt: data.startedAt,
        updatedAt: data.startedAt,
        version: 0,
      };
      return { ...storedSession };
    }),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id?: string; status?: string };
        data: Record<string, unknown>;
      }) => {
        if (!storedSession) return { count: 0 };
        if (where.id && storedSession.id !== where.id) return { count: 0 };
        if (where.status && storedSession.status !== where.status) {
          return { count: 0 };
        }
        const increment =
          (data.version as { increment?: number } | undefined)?.increment ?? 0;
        const next = { ...data };
        delete next.version;
        storedSession = {
          ...storedSession,
          ...next,
          version: Number(storedSession.version) + increment,
        };
        return { count: 1 };
      },
    ),
  };
  const modelSession = {
    findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
      storedModelSession?.id === where.id ? { ...storedModelSession } : null,
    ),
    findFirst: jest.fn(
      async ({
        where,
      }: {
        where: {
          id?: string;
          companionSessionId?: string;
          status?: string;
        };
      }) => {
        if (!storedModelSession) return null;
        if (where.id && storedModelSession.id !== where.id) return null;
        if (
          where.companionSessionId &&
          storedModelSession.companionSessionId !== where.companionSessionId
        ) {
          return null;
        }
        if (where.status && storedModelSession.status !== where.status) {
          return null;
        }
        return { ...storedModelSession };
      },
    ),
    create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
      storedModelSession = {
        ...data,
        firstResponseAt: null,
        endedAt: null,
        endReason: null,
        errorCode: null,
        createdAt: data.startedAt,
        updatedAt: data.startedAt,
      };
      return { ...storedModelSession };
    }),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id?: string; companionSessionId?: string; status?: string };
        data: Record<string, unknown>;
      }) => {
        if (!storedModelSession) return { count: 0 };
        if (where.id && storedModelSession.id !== where.id) {
          return { count: 0 };
        }
        if (
          where.companionSessionId &&
          storedModelSession.companionSessionId !== where.companionSessionId
        ) {
          return { count: 0 };
        }
        if (where.status && storedModelSession.status !== where.status) {
          return { count: 0 };
        }
        storedModelSession = { ...storedModelSession, ...data };
        return { count: 1 };
      },
    ),
  };
  const prisma = {
    companionBinding: { findFirst: jest.fn(async () => binding) },
    companionSession,
    recipientConsentState,
    memory: { findMany: jest.fn(async () => []) },
    routineOccurrence: { findMany: jest.fn(async () => []) },
    device: { updateMany: jest.fn(async () => ({ count: 1 })) },
    modelSession,
    modelSessionEvent: { create: jest.fn(async ({ data }) => data) },
    promptVersion: {
      findFirst: jest.fn(async () => ({ ...currentPrompt })),
      findUnique: jest.fn(async ({ where }: { where: { id?: string } }) => {
        const persisted = where.id ? promptVersions.get(where.id) : null;
        return persisted ? { ...persisted } : null;
      }),
    },
    outboxEvent: { create: jest.fn(async ({ data }) => data) },
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(
      async (operation: (transaction: unknown) => Promise<unknown>) => {
        transactionCount += 1;
        const gate = pendingTransactionGate;
        if (gate?.transactionNumber === transactionCount) {
          gate.reached.resolve();
          await gate.release.promise;
          pendingTransactionGate = undefined;
        }
        return operation(prisma);
      },
    ),
  };
  const leases = {
    acquire: jest.fn(async () => true),
    renew: jest.fn(async () => true),
    transfer: jest.fn(async () => true),
    release: jest.fn(async () => undefined),
    current: jest.fn(async () => null),
  };
  const mediaSecurity = {
    hasPendingCleanup: jest.fn(async () => false),
    hasRemoteMediaBarrier: jest.fn(async () => false),
  };
  const service = new CompanionSessionApplicationService(
    prisma as unknown as PrismaService,
    { get: jest.fn(() => undefined) } as unknown as ConfigService,
    {
      sealFields: jest.fn(),
      openFields: jest.fn(
        (sealed: { ciphertexts: { content: Uint8Array } }) => ({
          content:
            sealed.ciphertexts.content[0] === 2 ? 'prompt-A' : 'prompt-B',
        }),
      ),
    } as unknown as DataEncryptionPort,
    leases as unknown as MediaLeasePort,
    {
      encrypt: jest.fn(),
      decrypt: jest.fn(),
    } as unknown as CareWorkflowContentCipher,
    mediaSecurity as never,
  );
  const start = () =>
    service.startCompanionSession({
      principal,
      mode: 'AUDIO',
      idempotencyKey: 'session-lifecycle-0001',
      traceId: 'request-lifecycle',
    });
  const startModel = (
    companionSessionId: string,
    idempotencyKey = 'model-lifecycle-0001',
  ) =>
    service.startModelSession({
      principal,
      companionSessionId,
      idempotencyKey,
    });

  return {
    service,
    start,
    startModel,
    leases,
    mediaSecurity,
    modelSession,
    modelLock: prisma.$queryRaw,
    outboxEvent: prisma.outboxEvent,
    companionSession,
    session: () => storedSession,
    storedModelSession: () => storedModelSession,
    publishPromptB() {
      const promptB = {
        ...promptA,
        id: '01J00000000000000000000009',
        version: 3,
        contentHash: Uint8Array.from([4]),
        contentCiphertext: Uint8Array.from([4]),
        contentNonce: Uint8Array.from([5]),
      };
      promptVersions.set(promptB.id, promptB);
      currentPrompt = promptB;
      return promptB;
    },
    setModelStatus(status: string) {
      if (!storedModelSession) {
        throw new Error('test model session is not initialized');
      }
      storedModelSession = {
        ...storedModelSession,
        status,
        endedAt: status === 'ACTIVE' ? null : new Date(),
      };
    },
    setConsent(scopes: string[]) {
      consentScopes = new Set(scopes);
    },
    setSessionStatus(status: string, endReason: string | null) {
      if (!storedSession) throw new Error('test session is not initialized');
      storedSession = {
        ...storedSession,
        status,
        endedAt: status === 'ACTIVE' ? null : new Date(),
        endReason,
        version: Number(storedSession.version) + 1,
      };
    },
    installConcurrentWinnerConflict() {
      companionSession.create.mockImplementationOnce(
        async ({ data }: { data: Record<string, unknown> }) => {
          storedSession = {
            ...data,
            endedAt: null,
            endReason: null,
            createdAt: data.startedAt,
            updatedAt: data.startedAt,
            version: 0,
          };
          throw new Error('P2002 concurrent idempotent winner');
        },
      );
    },
    pauseNextTransactionalConsent() {
      const reached = deferred();
      const release = deferred();
      pendingConsentGate = {
        readNumber: consentReadCount + 2,
        reached,
        release,
      };
      return { reached: reached.promise, release: release.resolve };
    },
    pauseTransaction(offset = 1) {
      const reached = deferred();
      const release = deferred();
      pendingTransactionGate = {
        transactionNumber: transactionCount + offset,
        reached,
        release,
      };
      return { reached: reached.promise, release: release.resolve };
    },
  };
}

describe('CompanionSessionApplicationService consent boundary', () => {
  it('requires separate camera consent for an audio-video session', async () => {
    const service = serviceWith({
      consent: ['MICROPHONE_CAPTURE', 'MODEL_PROCESSING'],
    });
    try {
      await service.startCompanionSession({
        principal,
        mode: 'AUDIO_VIDEO',
        idempotencyKey: 'session-0001',
        traceId: 'request-1',
      });
      throw new Error('expected consent rejection');
    } catch (error) {
      expect(codeOf(error)).toBe('CONSENT_REQUIRED');
      expect(error).toMatchObject({ scope: 'CAMERA_CAPTURE' });
    }
  });

  it('rejects a user transcript unless independent ASR consent is current', async () => {
    const service = serviceWith({
      consent: ['MICROPHONE_CAPTURE', 'MODEL_PROCESSING'],
      modelSession: {
        id: '01J00000000000000000000008',
        status: 'ACTIVE',
        companionSession: {
          id: '01J00000000000000000000009',
          status: 'ACTIVE',
          householdId: principal.householdId,
          recipientId: principal.recipientId,
        },
      },
    });
    try {
      await service.appendUtterance({
        principal,
        modelSessionId: '01J00000000000000000000008',
        sequenceNo: 1,
        speaker: 'USER',
        source: 'ASR',
        providerEventId: 'asr-event-1',
        rawText: '今天阳光很好',
        isFinal: true,
      });
      throw new Error('expected consent rejection');
    } catch (error) {
      expect(codeOf(error)).toBe('CONSENT_REQUIRED');
      expect(error).toMatchObject({ scope: 'MODEL_INPUT_TRANSCRIPTION' });
    }
  });

  it('rejects attempts to label model output as independent ASR', async () => {
    const service = serviceWith({ consent: [] });
    await expect(
      service.appendUtterance({
        principal,
        modelSessionId: '01J00000000000000000000008',
        sequenceNo: 1,
        speaker: 'ASSISTANT',
        source: 'ASR',
        providerEventId: 'forged-source',
        rawText: '伪造内容',
        isFinal: true,
      }),
    ).rejects.toMatchObject({
      response: { code: 'UTTERANCE_SOURCE_INVALID' },
    });
  });
});

describe('CompanionSessionApplicationService media lifecycle', () => {
  it('blocks a new AI session when a durable remote-media barrier exists', async () => {
    const test = lifecycleHarness();
    test.mediaSecurity.hasRemoteMediaBarrier.mockResolvedValue(true);

    await expect(test.start()).rejects.toMatchObject({
      response: { code: 'COMPANION_SESSION_BUSY' },
    });

    expect(test.leases.acquire).not.toHaveBeenCalled();
    expect(test.companionSession.create).not.toHaveBeenCalled();
  });

  it('returns an ACTIVE idempotent replay while a remote call is only ringing', async () => {
    const test = lifecycleHarness();
    const first = await test.start();
    test.mediaSecurity.hasRemoteMediaBarrier.mockClear();
    test.mediaSecurity.hasRemoteMediaBarrier.mockResolvedValue(true);
    test.leases.acquire.mockClear();

    await expect(test.start()).resolves.toMatchObject({
      session: { id: first.session.id, status: 'ACTIVE' },
    });

    expect(test.mediaSecurity.hasRemoteMediaBarrier).not.toHaveBeenCalled();
    expect(test.leases.acquire).toHaveBeenCalledTimes(1);
    expect(test.companionSession.create).toHaveBeenCalledTimes(1);
  });

  it('withholds an ACTIVE companion replay when remote media wins before the final fence', async () => {
    const test = lifecycleHarness();
    await test.start();
    const gate = test.pauseTransaction(2);
    const replaying = test.start();
    const rejected = expect(replaying).rejects.toMatchObject({
      response: { code: 'COMPANION_SESSION_BUSY' },
    });
    await gate.reached;
    test.leases.renew.mockResolvedValueOnce(false);
    gate.release();

    await rejected;

    expect(test.session()).toMatchObject({ status: 'ACTIVE' });
    expect(test.leases.renew).toHaveBeenLastCalledWith(
      principal.bindingId,
      expect.objectContaining({
        ownerType: 'AI_COMPANION',
        ownerId: expect.any(String),
      }),
      90,
    );
  });

  it('does not acquire a lease when a terminal idempotent replay is returned', async () => {
    const test = lifecycleHarness();
    await test.start();
    test.setSessionStatus('ENDED', 'DEVICE_ENDED');
    test.leases.acquire.mockClear();
    test.leases.release.mockClear();

    await expect(test.start()).resolves.toMatchObject({
      session: { status: 'ENDED', endReason: 'DEVICE_ENDED' },
    });

    expect(test.leases.acquire).not.toHaveBeenCalled();
    expect(test.leases.release).not.toHaveBeenCalled();
  });

  it('ends and releases a server-active session omitted by a restarted client', async () => {
    const test = lifecycleHarness();
    const started = await test.start();
    test.leases.release.mockClear();

    await expect(
      test.service.recordHeartbeat(principal, {}),
    ).resolves.toMatchObject({
      mediaDirective: 'STOP',
      reason: 'CLIENT_SESSION_MISSING',
    });

    expect(test.session()).toMatchObject({
      id: started.session.id,
      status: 'ENDED',
      endReason: 'CLIENT_SESSION_MISSING',
    });
    expect(test.leases.release).toHaveBeenCalledWith(principal.bindingId, {
      ownerType: 'AI_COMPANION',
      ownerId: started.session.id,
      leaseId: started.session.id,
    });
  });

  it('does not release a concurrent idempotent winner lease after the loser conflicts', async () => {
    const test = lifecycleHarness();
    test.installConcurrentWinnerConflict();

    await expect(test.start()).rejects.toThrow(
      'P2002 concurrent idempotent winner',
    );

    expect(test.session()).toMatchObject({ status: 'ACTIVE' });
    expect(test.leases.acquire).toHaveBeenCalledTimes(1);
    expect(test.leases.release).not.toHaveBeenCalled();
  });

  it('returns STOP for a reported session whose consent was revoked, then CONTINUE once idle and regranted', async () => {
    const test = lifecycleHarness();
    const started = await test.start();
    test.setConsent([]);

    await expect(
      test.service.recordHeartbeat(principal, {
        activeCompanionSessionId: started.session.id,
      }),
    ).resolves.toMatchObject({
      mediaDirective: 'STOP',
      reason: 'CONSENT_REVOKED_MICROPHONE_CAPTURE',
    });
    expect(test.session()).toMatchObject({
      status: 'ENDED',
      endReason: 'CONSENT_REVOKED_MICROPHONE_CAPTURE',
    });

    test.setConsent(['MICROPHONE_CAPTURE', 'MODEL_PROCESSING']);
    const idleHeartbeat = await test.service.recordHeartbeat(principal, {});
    expect(idleHeartbeat).toMatchObject({ mediaDirective: 'CONTINUE' });
    expect(idleHeartbeat).not.toHaveProperty('activeCompanionSessionId');
  });

  it('reacquires the same AI owner when heartbeat renewal races an expired lease', async () => {
    const test = lifecycleHarness();
    const started = await test.start();
    test.leases.renew.mockResolvedValueOnce(false);
    test.leases.acquire.mockClear();
    test.leases.acquire.mockResolvedValueOnce(true);
    test.leases.release.mockClear();

    await expect(
      test.service.recordHeartbeat(principal, {
        activeCompanionSessionId: started.session.id,
      }),
    ).resolves.toMatchObject({
      mediaDirective: 'CONTINUE',
      activeCompanionSessionId: started.session.id,
    });

    expect(test.leases.acquire).toHaveBeenCalledWith(
      principal.bindingId,
      {
        ownerType: 'AI_COMPANION',
        ownerId: started.session.id,
        leaseId: started.session.id,
      },
      90,
    );
    expect(test.session()).toMatchObject({ status: 'ACTIVE' });
    expect(test.leases.release).not.toHaveBeenCalled();
  });

  it('compare-releases a reacquired AI owner when the session became terminal meanwhile', async () => {
    const test = lifecycleHarness();
    const started = await test.start();
    test.leases.renew.mockResolvedValueOnce(false);
    test.leases.acquire.mockClear();
    test.leases.acquire.mockImplementationOnce(async () => {
      test.setSessionStatus('ENDED', 'REMOTE_ASSISTANCE_ACCEPTED');
      return true;
    });
    test.leases.release.mockClear();

    await expect(
      test.service.recordHeartbeat(principal, {
        activeCompanionSessionId: started.session.id,
      }),
    ).resolves.toMatchObject({
      mediaDirective: 'STOP',
      reason: 'REMOTE_ASSISTANCE_ACCEPTED',
    });

    expect(test.leases.release).toHaveBeenCalledWith(principal.bindingId, {
      ownerType: 'AI_COMPANION',
      ownerId: started.session.id,
      leaseId: started.session.id,
    });
    expect(test.session()).toMatchObject({
      status: 'ENDED',
      endReason: 'REMOTE_ASSISTANCE_ACCEPTED',
    });
  });

  it('rechecks consent and preserves the bounded deterministic lease when no committed row is visible', async () => {
    const test = lifecycleHarness();
    const gate = test.pauseNextTransactionalConsent();
    const starting = test.start();
    await gate.reached;
    test.setConsent([]);
    gate.release();

    await expect(starting).rejects.toMatchObject({
      response: { code: 'CONSENT_REQUIRED' },
      scope: 'MICROPHONE_CAPTURE',
    });
    expect(test.companionSession.create).not.toHaveBeenCalled();
    expect(test.session()).toBeNull();
    expect(test.leases.release).not.toHaveBeenCalled();
  });

  it('rechecks consent before renewing an ACTIVE idempotent replay', async () => {
    const test = lifecycleHarness();
    await test.start();
    test.leases.acquire.mockClear();
    test.leases.release.mockClear();
    const gate = test.pauseNextTransactionalConsent();
    const replaying = test.start();
    await gate.reached;
    test.setConsent([]);
    test.setSessionStatus('ENDED', 'CONSENT_REVOKED_MICROPHONE_CAPTURE');
    gate.release();

    await expect(replaying).rejects.toMatchObject({
      response: { code: 'CONSENT_REQUIRED' },
      scope: 'MICROPHONE_CAPTURE',
    });
    expect(test.companionSession.create).toHaveBeenCalledTimes(1);
    expect(test.leases.acquire).toHaveBeenCalledTimes(1);
    expect(test.leases.release).toHaveBeenCalledTimes(1);
  });

  it('replays the persisted prompt after the current prompt advances and pins new models to the new prompt', async () => {
    const test = lifecycleHarness();
    const companion = await test.start();
    const first = await test.startModel(
      companion.session.id,
      'model-prompt-recovery',
    );
    expect(first.prompt).toMatchObject({
      id: '01J00000000000000000000008',
      content: 'prompt-A',
    });

    const promptB = test.publishPromptB();
    const committedReplay = await test.startModel(
      companion.session.id,
      'model-prompt-recovery',
    );
    expect(committedReplay).toMatchObject({
      session: { id: first.session.id },
      prompt: {
        id: '01J00000000000000000000008',
        content: 'prompt-A',
      },
    });

    // Simulate an outer stale read that misses the committed winner. The
    // serializable replay branch must still load prompt A from the model row.
    test.modelSession.findUnique.mockResolvedValueOnce(null);
    const transactionalReplay = await test.startModel(
      companion.session.id,
      'model-prompt-recovery',
    );
    expect(transactionalReplay).toMatchObject({
      session: { id: first.session.id },
      prompt: {
        id: '01J00000000000000000000008',
        content: 'prompt-A',
      },
    });

    test.setModelStatus('ENDED');
    const newModel = await test.startModel(
      companion.session.id,
      'model-after-prompt-advance',
    );
    expect(newModel.prompt).toMatchObject({
      id: promptB.id,
      content: 'prompt-B',
    });
    expect(test.storedModelSession()).toMatchObject({
      id: newModel.session.id,
      promptVersionId: promptB.id,
    });
    expect(test.modelSession.create).toHaveBeenCalledTimes(2);
  });

  it('withholds a replayed model connection when remote media wins before the final fence', async () => {
    const test = lifecycleHarness();
    const companion = await test.start();
    const first = await test.startModel(companion.session.id);
    const gate = test.pauseTransaction();
    const replaying = test.startModel(companion.session.id);
    const rejected = expect(replaying).rejects.toMatchObject({
      response: { code: 'COMPANION_SESSION_BUSY' },
    });
    await gate.reached;
    test.leases.renew.mockResolvedValueOnce(false);
    gate.release();

    await rejected;

    expect(test.storedModelSession()).toMatchObject({
      id: first.session.id,
      status: 'ACTIVE',
    });
    expect(test.modelSession.create).toHaveBeenCalledTimes(1);
  });

  it('withholds a newly created model connection when remote media wins before the final fence', async () => {
    const test = lifecycleHarness();
    const companion = await test.start();
    const gate = test.pauseTransaction(2);
    const starting = test.startModel(
      companion.session.id,
      'model-lifecycle-create-race',
    );
    const rejected = expect(starting).rejects.toMatchObject({
      response: { code: 'COMPANION_SESSION_BUSY' },
    });
    await gate.reached;
    test.leases.renew.mockResolvedValueOnce(false);
    gate.release();

    await rejected;

    expect(test.modelSession.create).toHaveBeenCalledTimes(1);
    expect(test.storedModelSession()).toMatchObject({ status: 'ACTIVE' });
  });

  it('emits one terminal event when two end commands race', async () => {
    const test = lifecycleHarness();
    const started = await test.start();
    test.outboxEvent.create.mockClear();
    test.modelLock.mockClear();
    test.modelSession.updateMany.mockClear();
    test.companionSession.findUnique.mockClear();
    test.companionSession.updateMany.mockClear();

    const results = await Promise.all([
      test.service.endCompanionSession(
        principal,
        started.session.id,
        'DEVICE_ENDED',
      ),
      test.service.endCompanionSession(
        principal,
        started.session.id,
        'HEARTBEAT_STOP',
      ),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ status: 'ENDED' }),
      expect.objectContaining({ status: 'ENDED' }),
    ]);
    expect(test.modelLock).toHaveBeenCalledTimes(2);
    expect(test.modelLock.mock.invocationCallOrder[0]).toBeLessThan(
      test.companionSession.findUnique.mock.invocationCallOrder[0]!,
    );
    expect(test.modelSession.updateMany).toHaveBeenCalledTimes(1);
    expect(test.outboxEvent.create).toHaveBeenCalledTimes(1);
    expect(test.outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: 'CompanionSessionEnded' }),
    });
  });

  it('locks models before the companion row and does not mutate models when another terminal command already won', async () => {
    const test = lifecycleHarness();
    const companion = await test.start();
    await test.startModel(companion.session.id);
    test.modelLock.mockClear();
    test.modelSession.updateMany.mockClear();
    test.companionSession.findUnique.mockClear();
    test.outboxEvent.create.mockClear();

    const gate = test.pauseTransaction();
    const ending = test.service.endCompanionSession(
      principal,
      companion.session.id,
      'DEVICE_ENDED',
    );
    await gate.reached;
    test.setSessionStatus('ENDED', 'REMOTE_ASSISTANCE_ACCEPTED');
    gate.release();

    await expect(ending).resolves.toMatchObject({
      status: 'ENDED',
      endReason: 'REMOTE_ASSISTANCE_ACCEPTED',
    });
    expect(test.modelLock).toHaveBeenCalledTimes(1);
    expect(test.modelLock.mock.invocationCallOrder[0]).toBeLessThan(
      test.companionSession.findUnique.mock.invocationCallOrder[0]!,
    );
    expect(test.modelSession.updateMany).not.toHaveBeenCalled();
    expect(test.outboxEvent.create).not.toHaveBeenCalled();
    expect(test.storedModelSession()).toMatchObject({ status: 'ACTIVE' });
  });
});
