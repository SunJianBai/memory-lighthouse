import type { PrismaService } from '../../infrastructure/database/prisma.service';
import { Prisma } from '../../infrastructure/database/generated/prisma/client';
import type { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import type { CareWorkflowPrincipal } from './care-workflow.types';
import { CareWorkflowApplicationService } from './care-workflow.application.service';
import type { CareWorkflowContentCipher } from './ports/content-cipher.port';

const NOW = new Date('2026-08-01T08:00:30.000Z');
const principal = { userId: 'user-1' } as CareWorkflowPrincipal;
const cipher: CareWorkflowContentCipher = {
  encrypt: (text) => ({
    ciphertext: Buffer.from(text),
    nonce: Buffer.alloc(24),
    encryptionKeyId: 'test',
  }),
  decrypt: ({ ciphertext }) => Buffer.from(ciphertext).toString(),
};

function lifecycleHarness() {
  const content = Buffer.from(JSON.stringify(['Take a walk', 'Done?']));
  const schedules = [
    {
      id: 'schedule-1',
      routineId: 'routine-1',
      timezone: 'Asia/Shanghai',
      localTimeMinutes: 20 * 60,
      weekdayMask: 127,
      startDate: new Date('2026-01-01'),
      endDate: null as Date | null,
      graceMinutes: 10,
      familyNoticeMinutes: 20,
      scheduleVersion: 1,
      active: true,
      effectiveFromUtc: null as Date | null,
    },
  ];
  const routine = {
    id: 'routine-1',
    householdId: 'household-1',
    recipientId: 'recipient-1',
    type: 'ACTIVITY',
    medicationId: null,
    title: 'Walk',
    status: 'ACTIVE',
    instructionsCiphertext: content.subarray(0, 10),
    confirmationQuestionCiphertext: content.subarray(10),
    contentNonce: Buffer.alloc(24),
    encryptionKeyId: 'test',
    version: 0,
    deletedAt: null as Date | null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const occurrences = [
    ...Array.from({ length: 105 }, (_, index) => ({
      id: `occurrence-${index}`,
      householdId: 'household-1',
      recipientId: 'recipient-1',
      routineId: routine.id,
      scheduleId: 'schedule-1',
      scheduledAtUtc: NOW,
      scheduledLocalDate: new Date('2026-08-01'),
      status: index % 2 ? 'DUE' : 'AWAITING_CONFIRMATION',
      closureReason: null as string | null,
      completedAt: null,
      confirmationDeadlineAt: null,
      escalationAt: null,
      version: 0,
    })),
    ...['NEEDS_FAMILY_REVIEW', 'CONFIRMED', 'EXPIRED'].map((status) => ({
      id: status,
      householdId: 'household-1',
      recipientId: 'recipient-1',
      routineId: routine.id,
      scheduleId: 'schedule-1',
      scheduledAtUtc: NOW,
      scheduledLocalDate: new Date('2026-08-01'),
      status,
      closureReason: null as string | null,
      completedAt: null,
      confirmationDeadlineAt: null,
      escalationAt: null,
      version: 0,
    })),
  ];
  const receipts: Record<string, unknown>[] = [];
  const record = () => ({
    ...routine,
    schedules: [...schedules]
      .sort((a, b) => b.scheduleVersion - a.scheduleVersion)
      .slice(0, 1),
  });
  const db = {
    $queryRaw: jest.fn().mockResolvedValue([{ id: routine.id }]),
    routine: {
      findFirst: jest.fn().mockImplementation(() => Promise.resolve(record())),
      findUniqueOrThrow: jest
        .fn()
        .mockImplementation(() => Promise.resolve(record())),
      findMany: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(
            (
              typeof where.status === 'string'
                ? routine.status === where.status
                : where.status.in.includes(routine.status)
            )
              ? [record()]
              : [],
          ),
        ),
      updateMany: jest.fn().mockImplementation(({ where, data }) => {
        if (routine.version !== where.version)
          return Promise.resolve({ count: 0 });
        Object.assign(routine, { ...data, version: routine.version + 1 });
        return Promise.resolve({ count: 1 });
      }),
    },
    routineSchedule: {
      updateMany: jest.fn().mockImplementation(() => {
        schedules.forEach((s) => {
          s.active = false;
        });
        return Promise.resolve({ count: 1 });
      }),
      create: jest.fn().mockImplementation(({ data }) => {
        schedules.push(data);
        return Promise.resolve(data);
      }),
      aggregate: jest.fn().mockImplementation(() =>
        Promise.resolve({
          _max: {
            scheduleVersion: Math.max(
              ...schedules.map((s) => s.scheduleVersion),
            ),
          },
        }),
      ),
    },
    routineOccurrence: {
      updateMany: jest.fn().mockImplementation(({ where, data }) => {
        const rows = occurrences.filter((o) =>
          where.status.in.includes(o.status),
        );
        rows.forEach((o) =>
          Object.assign(o, { ...data, version: o.version + 1 }),
        );
        return Promise.resolve({ count: rows.length });
      }),
      findMany: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(occurrences.map((o) => ({ ...o, routine }))),
        ),
    },
    careCommandReceipt: {
      findUnique: jest
        .fn()
        .mockImplementation(({ where }) =>
          Promise.resolve(
            receipts.find((r) => r.idempotencyKey === where.idempotencyKey) ??
              null,
          ),
        ),
      create: jest.fn().mockImplementation(({ data }) => {
        receipts.push(data);
        return Promise.resolve(data);
      }),
    },
    outboxEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    ...db,
    $transaction: jest.fn().mockImplementation(async (work) => work(db)),
  };
  const policy = {
    requireRecipientAction: jest.fn().mockResolvedValue({ id: 'member-1' }),
  };
  const clock = { now: jest.fn().mockReturnValue(NOW) };
  return {
    routine,
    schedules,
    policy,
    db,
    clock,
    service: new CareWorkflowApplicationService(
      prisma as unknown as PrismaService,
      policy as unknown as HouseholdAccessPolicy,
      cipher,
      clock,
    ),
  };
}

describe('routine lifecycle public application contract', () => {
  it('resamples the resume boundary on a successful retry and bounds database conflicts to three attempts', async () => {
    const test = lifecycleHarness();
    await test.service.pauseRoutine(principal, 'household-1', 'routine-1', {
      version: 0,
      idempotencyKey: 'p',
    });
    const conflict = new Prisma.PrismaClientKnownRequestError(
      'synthetic serialization conflict',
      { code: 'P2034', clientVersion: 'test' },
    );
    const retryAt = new Date('2026-08-01T08:10:00.123Z');
    test.db.$queryRaw
      .mockRejectedValueOnce(conflict)
      .mockImplementation(async () => {
        test.clock.now.mockReturnValue(retryAt);
        return [{ id: 'routine-1' }];
      });
    await test.service.resumeRoutine(principal, 'household-1', 'routine-1', {
      version: 1,
      idempotencyKey: 'r',
    });
    expect(test.schedules[1].effectiveFromUtc).toEqual(retryAt);
    test.db.$queryRaw.mockClear().mockRejectedValue(conflict);
    await expect(
      test.service.pauseRoutine(principal, 'household-1', 'routine-1', {
        version: 2,
        idempotencyKey: 'p2',
      }),
    ).rejects.toBe(conflict);
    expect(test.db.$queryRaw).toHaveBeenCalledTimes(3);
  });
  it('edits a paused schedule without activating it and allows deletion then authorized receipt replay', async () => {
    const test = lifecycleHarness();
    const paused = await test.service.pauseRoutine(
      principal,
      'household-1',
      'routine-1',
      { version: 0, idempotencyKey: 'p' },
    );
    const edited = await test.service.updateRoutine(
      principal,
      'household-1',
      'routine-1',
      {
        version: 1,
        idempotencyKey: 'edit',
        schedule: {
          timezone: 'Asia/Shanghai',
          localTimeMinutes: 1300,
          weekdayMask: 127,
          startDate: '2026-01-01',
          graceMinutes: 10,
          familyNoticeMinutes: 20,
        },
      },
    );
    expect(edited).toMatchObject({
      status: 'PAUSED',
      version: 2,
      schedules: [{ localTimeMinutes: 1300 }],
    });
    expect(test.schedules.some((s) => s.active)).toBe(false);
    await test.service.deleteRoutine(principal, 'household-1', 'routine-1', 2);
    expect(
      await test.service.pauseRoutine(principal, 'household-1', 'routine-1', {
        version: 0,
        idempotencyKey: 'p',
      }),
    ).toEqual(paused);
    expect(
      await test.service.listRoutines(
        principal,
        'household-1',
        'recipient-1',
        true,
      ),
    ).toEqual([]);
    test.policy.requireRecipientAction.mockRejectedValue(
      new Error('permission revoked'),
    );
    await expect(
      test.service.pauseRoutine(principal, 'household-1', 'routine-1', {
        version: 0,
        idempotencyKey: 'p',
      }),
    ).rejects.toThrow('permission revoked');
  });

  it('rejects a resume without a future matching time and preserves the paused version', async () => {
    const test = lifecycleHarness();
    test.schedules[0].endDate = new Date('2026-07-31');
    await test.service.pauseRoutine(principal, 'household-1', 'routine-1', {
      version: 0,
      idempotencyKey: 'p',
    });
    await expect(
      test.service.resumeRoutine(principal, 'household-1', 'routine-1', {
        version: 1,
        idempotencyKey: 'r',
      }),
    ).rejects.toMatchObject({
      response: { code: 'ROUTINE_NO_FUTURE_OCCURRENCE' },
    });
    expect(
      (
        await test.service.listRoutines(
          principal,
          'household-1',
          'recipient-1',
          true,
        )
      )[0],
    ).toMatchObject({ status: 'PAUSED', version: 1 });
  });

  it('rejects changed commands using the same receipt key and same-version competing operations', async () => {
    const { service } = lifecycleHarness();
    await service.pauseRoutine(principal, 'household-1', 'routine-1', {
      version: 0,
      idempotencyKey: 'p',
    });
    await expect(
      service.pauseRoutine(principal, 'household-1', 'routine-1', {
        version: 1,
        idempotencyKey: 'p',
      }),
    ).rejects.toMatchObject({ response: { code: 'IDEMPOTENCY_CONFLICT' } });
    await expect(
      service.pauseRoutine(principal, 'household-1', 'routine-1', {
        version: 0,
        idempotencyKey: 'another',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CARE_WORKFLOW_VERSION_CONFLICT' },
    });
  });
  it('resumes a new schedule strictly after the clock sampled following the lock, without reviving closed occurrences', async () => {
    const test = lifecycleHarness();
    await test.service.pauseRoutine(principal, 'household-1', 'routine-1', {
      version: 0,
      idempotencyKey: 'p',
    });
    const lockedAt = new Date('2026-08-01T08:01:15.123Z');
    test.db.$queryRaw.mockImplementation(async () => {
      test.clock.now.mockReturnValue(lockedAt);
      return [{ id: 'routine-1' }];
    });
    const view = await test.service.resumeRoutine(
      principal,
      'household-1',
      'routine-1',
      { version: 1, idempotencyKey: 'r' },
    );
    expect(view).toMatchObject({
      status: 'ACTIVE',
      version: 2,
      schedules: [{ scheduleVersion: 2 }],
    });
    expect(view.schedules[0].id).not.toBe('schedule-1');
    expect(test.schedules[1].effectiveFromUtc).toEqual(lockedAt);
    expect(
      (
        await test.service.listOccurrences(
          principal,
          'household-1',
          'recipient-1',
        )
      )[0].status,
    ).toBe('EXPIRED');
  });
  it('pauses all pending occurrences atomically without completing history or hiding the saved configuration', async () => {
    const { service } = lifecycleHarness();
    const view = await service.pauseRoutine(
      principal,
      'household-1',
      'routine-1',
      { version: 0, idempotencyKey: 'pause-1' },
    );
    expect(view).toMatchObject({
      status: 'PAUSED',
      version: 1,
      schedules: [{ id: 'schedule-1', localTimeMinutes: 1200 }],
    });
    expect(
      await service.listRoutines(principal, 'household-1', 'recipient-1'),
    ).toEqual([]);
    expect(
      await service.listRoutines(principal, 'household-1', 'recipient-1', true),
    ).toHaveLength(1);
    const history = await service.listOccurrences(
      principal,
      'household-1',
      'recipient-1',
    );
    expect(
      history
        .slice(0, 105)
        .every(
          (o) =>
            o.status === 'EXPIRED' &&
            o.closureReason === 'ROUTINE_PAUSED' &&
            o.version === 1 &&
            o.completedAt === null,
        ),
    ).toBe(true);
    expect(history.slice(105).map((o) => [o.status, o.version])).toEqual([
      ['NEEDS_FAMILY_REVIEW', 0],
      ['CONFIRMED', 0],
      ['EXPIRED', 0],
    ]);
  });
});
