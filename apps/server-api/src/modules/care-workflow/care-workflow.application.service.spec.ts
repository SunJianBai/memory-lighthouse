import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import type { DevicePrincipal } from '../device-activation/device-activation.types';
import type { UserPrincipal } from '../identity/identity.types';
import { CareWorkflowApplicationService } from './care-workflow.application.service';
import { OCCURRENCE_STATUS } from './care-workflow.constants';
import {
  DeviceOccurrenceAccessDeniedException,
  FamilyTaskClaimConflictException,
  IdempotencyConflictException,
  InvalidOccurrenceTransitionException,
  OccurrenceNotFoundException,
} from './care-workflow.errors';
import type { CareWorkflowClock } from './ports/care-workflow-clock.port';
import type { CareWorkflowContentCipher } from './ports/content-cipher.port';

const NOW = new Date('2026-08-01T08:00:00.000Z');
const principal: UserPrincipal = {
  kind: 'USER',
  userId: 'user-1',
  sessionId: 'session-1',
  tokenId: 'token-1',
  status: 'ACTIVE',
};
const devicePrincipal: DevicePrincipal = {
  kind: 'DEVICE',
  tokenId: 'device-token-1',
  credentialId: 'device-credential-1',
  credentialFamilyId: 'device-family-1',
  deviceId: 'device-1',
  bindingId: 'binding-1',
  householdId: 'household-1',
  recipientId: 'recipient-1',
  bindingVersion: 3,
  capabilities: ['COMPANION'],
};

const cipher: CareWorkflowContentCipher = {
  encrypt: (plaintext) => ({
    ciphertext: Buffer.from(plaintext),
    nonce: Buffer.alloc(24, 1),
    encryptionKeyId: 'test-key',
  }),
  decrypt: (content) => Buffer.from(content.ciphertext).toString('utf8'),
};

function protectedPair(first: string, second: string) {
  const bytes = Buffer.from(JSON.stringify([first, second]));
  const split = Math.ceil(bytes.length / 2);
  return {
    instructionsCiphertext: Uint8Array.from(bytes.subarray(0, split)),
    confirmationQuestionCiphertext: Uint8Array.from(bytes.subarray(split)),
    contentNonce: Uint8Array.from(Buffer.alloc(24, 1)),
    encryptionKeyId: 'test-key',
  };
}

function occurrence(status: string, version = 0) {
  return {
    id: 'occurrence-1',
    householdId: 'household-1',
    recipientId: 'recipient-1',
    routineId: 'routine-1',
    scheduleId: 'schedule-1',
    scheduledAtUtc: new Date('2026-08-01T07:30:00.000Z'),
    scheduledLocalDate: new Date('2026-08-01T00:00:00.000Z'),
    status,
    confirmationDeadlineAt: new Date('2026-08-01T07:40:00.000Z'),
    escalationAt: new Date('2026-08-01T08:00:00.000Z'),
    completedAt: null,
    version,
    routine: {
      title: '早餐后服用家属录入的药物',
      type: 'MEDICATION',
      ...protectedPair('家属录入：早餐后按标签服用', '已经完成了吗？'),
    },
  };
}

function harness(options?: {
  occurrenceStatus?: string;
  openTask?: boolean;
  taskUpdateCount?: number;
}) {
  const current = occurrence(
    options?.occurrenceStatus ?? OCCURRENCE_STATUS.awaitingConfirmation,
  );
  const openTask = options?.openTask
    ? {
        id: 'task-1',
        householdId: 'household-1',
        recipientId: 'recipient-1',
        sourceEventId: 'escalation-event-1',
        assigneeMemberId: null,
        status: 'OPEN',
        priority: 'NORMAL',
        dueAt: NOW,
        resolvedAt: null,
        resolutionCode: null,
        resolutionNoteCiphertext: null,
        resolutionNoteNonce: null,
        encryptionKeyId: null,
        createdAt: NOW,
        updatedAt: NOW,
        version: 0,
      }
    : null;
  let finalStatus = current.status;
  const taskActions: Record<string, unknown>[] = [];
  const commandReceipts: Record<string, unknown>[] = [];
  const transaction = {
    companionBinding: {
      findFirst: jest.fn().mockResolvedValue({ id: devicePrincipal.bindingId }),
    },
    routineOccurrence: {
      findFirst: jest.fn().mockResolvedValue(current),
      updateMany: jest.fn().mockImplementation(({ data }) => {
        finalStatus = data.status as string;
        return Promise.resolve({ count: 1 });
      }),
      findUniqueOrThrow: jest.fn().mockImplementation(() =>
        Promise.resolve({
          ...current,
          status: finalStatus,
          version: 1,
          completedAt: finalStatus === OCCURRENCE_STATUS.confirmed ? NOW : null,
        }),
      ),
    },
    routineConfirmation: {
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
    },
    conversationUtterance: {
      findFirst: jest.fn().mockResolvedValue({ id: 'utterance-1' }),
    },
    careCommandReceipt: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(
            commandReceipts.find(
              (receipt) => receipt.idempotencyKey === where.idempotencyKey,
            ) ?? null,
          ),
        ),
      create: jest.fn().mockImplementation(({ data }) => {
        commandReceipts.push(data);
        return Promise.resolve(data);
      }),
    },
    careEvent: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          ...data,
          createdAt: NOW,
          payloadJson: data.payloadJson,
        }),
      ),
    },
    familyTask: {
      findFirst: jest.fn().mockResolvedValue(openTask),
      create: jest.fn().mockImplementation(({ data }) =>
        Promise.resolve({
          ...data,
          assigneeMemberId: null,
          resolvedAt: null,
          resolutionCode: null,
          resolutionNoteCiphertext: null,
          resolutionNoteNonce: null,
          encryptionKeyId: null,
          createdAt: NOW,
          updatedAt: NOW,
          version: 0,
        }),
      ),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest
        .fn()
        .mockResolvedValue({ count: options?.taskUpdateCount ?? 1 }),
      findUniqueOrThrow: jest.fn().mockResolvedValue(openTask),
    },
    familyTaskAction: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(
            taskActions.find(
              (action) => action.idempotencyKey === where.idempotencyKey,
            ) ?? null,
          ),
        ),
      create: jest.fn().mockImplementation(({ data }) => {
        taskActions.push(data);
        return Promise.resolve(data);
      }),
    },
    outboxEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    companionBinding: {
      findFirst: jest.fn().mockResolvedValue({ id: devicePrincipal.bindingId }),
    },
    routineOccurrence: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest
      .fn()
      .mockImplementation(async (work) => work(transaction)),
  };
  const policy = {
    requireRecipientAction: jest.fn().mockResolvedValue({
      id: 'member-1',
      userId: principal.userId,
      householdId: 'household-1',
      roleCodes: ['CAREGIVER'],
    }),
  };
  const service = new CareWorkflowApplicationService(
    prisma as unknown as PrismaService,
    policy as unknown as HouseholdAccessPolicy,
    cipher,
    { now: () => NOW } as CareWorkflowClock,
  );
  return {
    service,
    prisma,
    policy,
    transaction,
    current,
    openTask,
    commandReceipts,
  };
}

describe('CareWorkflowApplicationService occurrence closure', () => {
  it('records a recipient confirmation, immutable event and outbox atomically', async () => {
    const test = harness();
    const view = await test.service.confirmOccurrence(
      principal,
      'household-1',
      'occurrence-1',
      {
        version: 0,
        idempotencyKey: 'confirm-1',
        source: 'RECIPIENT_BUTTON',
      },
    );

    expect(view.status).toBe(OCCURRENCE_STATUS.confirmed);
    expect(view.instructions).toBe('家属录入：早餐后按标签服用');
    expect(view.contentProvenance).toBe('FAMILY_ENTERED_VERBATIM');
    expect(test.transaction.routineConfirmation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          confirmationType: 'RECIPIENT_CONFIRMED',
          source: 'RECIPIENT_BUTTON',
        }),
      }),
    );
    expect(test.transaction.careEvent.create).toHaveBeenCalledTimes(1);
    expect(test.transaction.outboxEvent.create).toHaveBeenCalledTimes(1);
    expect(test.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({ isolationLevel: 'Serializable' }),
    );
    expect(test.transaction.careCommandReceipt.create).toHaveBeenCalledTimes(1);
    expect(test.transaction.careCommandReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        commandFingerprint: expect.any(Uint8Array),
        resultCiphertext: expect.any(Uint8Array),
        resultNonce: expect.any(Uint8Array),
        encryptionKeyId: 'test-key',
      }),
    });
    expect(
      test.transaction.careCommandReceipt.create.mock.calls[0][0].data,
    ).not.toHaveProperty('resultJson');
  });

  it.each([
    ['version', { version: 1 }],
    ['source', { source: 'RECIPIENT_VOICE' as const }],
    ['note', { note: 'different note' }],
    ['utteranceId', { utteranceId: 'utterance-2' }],
  ])(
    'rejects reusing an occurrence command key after %s changes',
    async (_field, change) => {
      const test = harness();
      const command = {
        version: 0,
        idempotencyKey: 'confirm-fingerprint-1',
        source: 'RECIPIENT_BUTTON' as const,
        note: 'original note',
        utteranceId: 'utterance-1',
      };
      await test.service.confirmOccurrenceByDevice(
        devicePrincipal,
        'occurrence-1',
        command,
      );

      await expect(
        test.service.confirmOccurrenceByDevice(
          devicePrincipal,
          'occurrence-1',
          { ...command, ...change },
        ),
      ).rejects.toBeInstanceOf(IdempotencyConflictException);
      expect(test.transaction.routineConfirmation.create).toHaveBeenCalledTimes(
        1,
      );
    },
  );

  it('replays the original occurrence response when the resource later changes', async () => {
    const test = harness();
    const command = {
      version: 0,
      idempotencyKey: 'confirm-original-response',
      source: 'RECIPIENT_BUTTON' as const,
    };
    const original = await test.service.confirmOccurrence(
      principal,
      'household-1',
      'occurrence-1',
      command,
    );
    test.transaction.routineOccurrence.findUniqueOrThrow.mockResolvedValue({
      ...test.current,
      status: OCCURRENCE_STATUS.expired,
      version: 9,
    });

    const replay = await test.service.confirmOccurrence(
      principal,
      'household-1',
      'occurrence-1',
      command,
    );

    expect(replay).toEqual(original);
    expect(test.transaction.routineConfirmation.create).toHaveBeenCalledTimes(
      1,
    );
  });

  it('lets a family member verify an escalated occurrence and closes its task', async () => {
    const test = harness({
      occurrenceStatus: OCCURRENCE_STATUS.needsFamilyReview,
      openTask: true,
    });
    const view = await test.service.familyVerifyOccurrence(
      principal,
      'household-1',
      'occurrence-1',
      {
        version: 0,
        idempotencyKey: 'family-verify-1',
        verified: true,
        note: '已电话核实',
      },
    );

    expect(view.status).toBe(OCCURRENCE_STATUS.confirmed);
    expect(test.transaction.familyTask.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'task-1' },
        data: expect.objectContaining({
          status: 'RESOLVED',
          resolutionCode: 'FAMILY_VERIFIED_COMPLETE',
        }),
      }),
    );
    expect(test.transaction.familyTaskAction.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'FAMILY_VERIFY' }),
      }),
    );
    expect(test.transaction.outboxEvent.create).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['version', { version: 1 }],
    ['verified', { verified: false }],
    ['note', { note: 'different family note' }],
  ])(
    'rejects reusing a family-verification key after %s changes',
    async (_field, change) => {
      const test = harness({
        occurrenceStatus: OCCURRENCE_STATUS.needsFamilyReview,
        openTask: true,
      });
      const command = {
        version: 0,
        idempotencyKey: 'family-verify-fingerprint',
        verified: true,
        note: 'original family note',
      };
      await test.service.familyVerifyOccurrence(
        principal,
        'household-1',
        'occurrence-1',
        command,
      );

      await expect(
        test.service.familyVerifyOccurrence(
          principal,
          'household-1',
          'occurrence-1',
          { ...command, ...change },
        ),
      ).rejects.toBeInstanceOf(IdempotencyConflictException);
      expect(test.transaction.routineConfirmation.create).toHaveBeenCalledTimes(
        1,
      );
    },
  );

  it('rejects an occurrence id that belongs to another household', async () => {
    const test = harness();
    test.transaction.routineOccurrence.findFirst.mockImplementation(
      ({ where }) =>
        Promise.resolve(
          where.householdId === 'household-1' ? test.current : null,
        ),
    );

    await expect(
      test.service.confirmOccurrence(
        principal,
        'foreign-household',
        'occurrence-1',
        {
          version: 0,
          idempotencyKey: 'cross-household',
          source: 'RECIPIENT_BUTTON',
        },
      ),
    ).rejects.toBeInstanceOf(OccurrenceNotFoundException);
    expect(test.policy.requireRecipientAction).not.toHaveBeenCalled();
  });

  it('lets the active companion binding confirm for its own recipient without a member identity', async () => {
    const test = harness();

    const view = await test.service.confirmOccurrenceByDevice(
      devicePrincipal,
      'occurrence-1',
      {
        version: 0,
        idempotencyKey: 'device-confirm-1',
        source: 'RECIPIENT_VOICE',
        note: '长者明确说已完成',
      },
    );

    expect(view.status).toBe(OCCURRENCE_STATUS.confirmed);
    expect(test.policy.requireRecipientAction).not.toHaveBeenCalled();
    expect(test.transaction.companionBinding.findFirst).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: devicePrincipal.bindingId,
        bindingVersion: devicePrincipal.bindingVersion,
        deviceId: devicePrincipal.deviceId,
        householdId: devicePrincipal.householdId,
        recipientId: devicePrincipal.recipientId,
        status: 'ACTIVE',
        revokedAt: null,
      }),
      select: { id: true },
    });
    expect(test.transaction.routineConfirmation.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          confirmationType: 'RECIPIENT_CONFIRMED',
          source: 'RECIPIENT_VOICE',
          memberId: null,
          bindingId: devicePrincipal.bindingId,
        }),
      }),
    );
    expect(test.transaction.familyTask.findFirst).not.toHaveBeenCalled();
  });

  it('turns an explicit device family request into one event and one family task', async () => {
    const test = harness();

    const result = await test.service.requestFamilyContactByDevice(
      devicePrincipal,
      {
        idempotencyKey: 'family-contact-1',
        source: 'RECIPIENT_BUTTON',
        occurrenceId: 'occurrence-1',
      },
    );

    expect(result).toMatchObject({
      accepted: true,
      occurrenceId: 'occurrence-1',
      taskStatus: 'OPEN',
    });
    expect(test.transaction.routineOccurrence.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: OCCURRENCE_STATUS.needsFamilyReview,
        }),
      }),
    );
    expect(test.transaction.careEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'RECIPIENT_REQUESTED_FAMILY_CONTACT',
          sourceType: 'COMPANION_DEVICE',
          sourceId: devicePrincipal.bindingId,
          routineOccurrenceId: 'occurrence-1',
        }),
      }),
    );
    expect(test.transaction.familyTask.create).toHaveBeenCalledTimes(1);
    expect(test.transaction.outboxEvent.create).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['source', { source: 'RECIPIENT_VOICE' as const }],
    ['occurrence', { occurrenceId: undefined }],
  ])(
    'rejects reusing a family-contact command key after %s changes',
    async (_field, change) => {
      const test = harness();
      const command = {
        idempotencyKey: 'family-contact-fingerprint',
        source: 'RECIPIENT_BUTTON' as const,
        occurrenceId: 'occurrence-1',
      };
      await test.service.requestFamilyContactByDevice(devicePrincipal, command);

      await expect(
        test.service.requestFamilyContactByDevice(devicePrincipal, {
          ...command,
          ...change,
        }),
      ).rejects.toBeInstanceOf(IdempotencyConflictException);
      expect(test.transaction.familyTask.create).toHaveBeenCalledTimes(1);
    },
  );

  it('hides another recipient occurrence from a companion device', async () => {
    const test = harness();
    test.transaction.routineOccurrence.findFirst.mockImplementation(
      ({ where }) =>
        Promise.resolve(
          where.householdId === test.current.householdId &&
            where.recipientId === test.current.recipientId
            ? test.current
            : null,
        ),
    );

    await expect(
      test.service.confirmOccurrenceByDevice(
        { ...devicePrincipal, recipientId: 'recipient-2' },
        'occurrence-1',
        {
          version: 0,
          idempotencyKey: 'wrong-recipient',
          source: 'RECIPIENT_BUTTON',
        },
      ),
    ).rejects.toBeInstanceOf(OccurrenceNotFoundException);
    expect(test.transaction.companionBinding.findFirst).not.toHaveBeenCalled();
    expect(test.transaction.routineConfirmation.create).not.toHaveBeenCalled();
  });

  it('rejects a token without the companion capability before changing state', async () => {
    const test = harness();

    await expect(
      test.service.confirmOccurrenceByDevice(
        { ...devicePrincipal, capabilities: ['REMOTE_ASSISTANCE'] },
        'occurrence-1',
        {
          version: 0,
          idempotencyKey: 'wrong-capability',
          source: 'RECIPIENT_BUTTON',
        },
      ),
    ).rejects.toBeInstanceOf(DeviceOccurrenceAccessDeniedException);
    expect(test.prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rechecks the active binding inside the confirmation transaction', async () => {
    const test = harness();
    test.transaction.companionBinding.findFirst.mockResolvedValue(null);

    await expect(
      test.service.confirmOccurrenceByDevice(devicePrincipal, 'occurrence-1', {
        version: 0,
        idempotencyKey: 'revoked-binding',
        source: 'RECIPIENT_BUTTON',
      }),
    ).rejects.toBeInstanceOf(DeviceOccurrenceAccessDeniedException);
    expect(test.transaction.routineConfirmation.create).not.toHaveBeenCalled();
  });

  it('does not let the device bypass family review after escalation', async () => {
    const test = harness({
      occurrenceStatus: OCCURRENCE_STATUS.needsFamilyReview,
      openTask: true,
    });

    await expect(
      test.service.confirmOccurrenceByDevice(devicePrincipal, 'occurrence-1', {
        version: 0,
        idempotencyKey: 'late-device-confirm',
        source: 'RECIPIENT_VOICE',
      }),
    ).rejects.toBeInstanceOf(InvalidOccurrenceTransitionException);
    expect(
      test.transaction.routineOccurrence.updateMany,
    ).not.toHaveBeenCalled();
    expect(test.transaction.routineConfirmation.create).not.toHaveBeenCalled();
  });
});

describe('CareWorkflowApplicationService device occurrence refresh', () => {
  it('returns the current actionable projection with refreshed status and version', async () => {
    const test = harness();
    const refreshed = {
      ...test.current,
      status: OCCURRENCE_STATUS.awaitingConfirmation,
      version: 4,
    };
    const confirmed = {
      ...occurrence(OCCURRENCE_STATUS.confirmed),
      id: 'confirmed-occurrence',
    };
    test.prisma.routineOccurrence.findMany.mockResolvedValue([
      refreshed,
      confirmed,
    ]);

    const result =
      await test.service.listCurrentOccurrencesForDevice(devicePrincipal);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: refreshed.id,
      status: OCCURRENCE_STATUS.awaitingConfirmation,
      version: 4,
      routineTitle: '早餐后服用家属录入的药物',
      instructions: '家属录入：早餐后按标签服用',
      contentProvenance: 'FAMILY_ENTERED_VERBATIM',
    });
    expect(test.prisma.routineOccurrence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          householdId: devicePrincipal.householdId,
          recipientId: devicePrincipal.recipientId,
          routine: { status: 'ACTIVE', deletedAt: null },
          schedule: { active: true },
        }),
        take: 32,
      }),
    );
  });

  it('rejects refresh after the companion binding is no longer active', async () => {
    const test = harness();
    test.prisma.companionBinding.findFirst.mockResolvedValue(null);

    await expect(
      test.service.listCurrentOccurrencesForDevice(devicePrincipal),
    ).rejects.toBeInstanceOf(DeviceOccurrenceAccessDeniedException);
    expect(test.prisma.routineOccurrence.findMany).not.toHaveBeenCalled();
  });
});

describe('CareWorkflowApplicationService task concurrency', () => {
  it('reports a deterministic claim conflict when optimistic ownership loses', async () => {
    const test = harness({ openTask: true, taskUpdateCount: 0 });
    await expect(
      test.service.claimFamilyTask(principal, 'household-1', 'task-1', {
        version: 0,
        idempotencyKey: 'claim-task-conflict',
      }),
    ).rejects.toBeInstanceOf(FamilyTaskClaimConflictException);
    expect(test.transaction.familyTaskAction.create).not.toHaveBeenCalled();
    expect(test.transaction.outboxEvent.create).not.toHaveBeenCalled();
  });

  it('replays the same family task action idempotently without a second write', async () => {
    const test = harness({ openTask: true });
    const command = { version: 0, idempotencyKey: 'claim-task-idempotent' };

    await test.service.claimFamilyTask(
      principal,
      'household-1',
      'task-1',
      command,
    );
    await test.service.claimFamilyTask(
      principal,
      'household-1',
      'task-1',
      command,
    );

    expect(test.transaction.familyTaskAction.create).toHaveBeenCalledTimes(1);
    expect(test.transaction.outboxEvent.create).toHaveBeenCalledTimes(1);
  });

  it('binds a claim command key to its optimistic version', async () => {
    const test = harness({ openTask: true });
    const command = { version: 0, idempotencyKey: 'claim-version-fingerprint' };
    await test.service.claimFamilyTask(
      principal,
      'household-1',
      'task-1',
      command,
    );

    await expect(
      test.service.claimFamilyTask(principal, 'household-1', 'task-1', {
        ...command,
        version: 1,
      }),
    ).rejects.toBeInstanceOf(IdempotencyConflictException);
  });

  it('does not let resolve and dismiss share a command key', async () => {
    const test = harness({ openTask: true });
    const command = {
      version: 0,
      idempotencyKey: 'finish-action-fingerprint',
      resolutionCode: 'FAMILY_CONFIRMED',
      note: null,
    };
    await test.service.resolveFamilyTask(
      principal,
      'household-1',
      'task-1',
      command,
    );

    await expect(
      test.service.dismissFamilyTask(
        principal,
        'household-1',
        'task-1',
        command,
      ),
    ).rejects.toBeInstanceOf(IdempotencyConflictException);
  });

  it.each([
    ['version', { version: 1 }],
    ['resolutionCode', { resolutionCode: 'ESCALATED' }],
    ['note', { note: 'different note' }],
  ])(
    'rejects reusing a task command key after %s changes',
    async (_field, change) => {
      const test = harness({ openTask: true });
      const command = {
        version: 0,
        idempotencyKey: 'resolve-task-fingerprint',
        resolutionCode: 'FAMILY_CONFIRMED',
        note: 'called recipient',
      };
      await test.service.resolveFamilyTask(
        principal,
        'household-1',
        'task-1',
        command,
      );

      await expect(
        test.service.resolveFamilyTask(principal, 'household-1', 'task-1', {
          ...command,
          ...change,
        }),
      ).rejects.toBeInstanceOf(IdempotencyConflictException);
      expect(test.transaction.familyTaskAction.create).toHaveBeenCalledTimes(1);
    },
  );
});
