import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { CareWorkflowContentCipher } from './ports/content-cipher.port';
import { PrismaOccurrenceScheduler } from './occurrence-scheduler.application';

describe('PrismaOccurrenceScheduler', () => {
  it('does not generate from an in-flight candidate after pause has invalidated its schedule', async () => {
    const db = {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'routine-1' }]),
      routineSchedule: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'old-schedule', routineId: 'routine-1' }]),
        findFirst: jest.fn().mockResolvedValue(null),
      },
      routineOccurrence: { createMany: jest.fn() },
    };
    const scheduler = new PrismaOccurrenceScheduler(
      {
        ...db,
        $transaction: async (work: (tx: unknown) => Promise<unknown>) =>
          work(db),
      } as unknown as PrismaService,
      {} as CareWorkflowContentCipher,
    );
    expect(
      await scheduler.generateOccurrences({
        windowStartUtc: new Date('2026-08-01'),
        windowEndUtc: new Date('2026-08-02'),
      }),
    ).toEqual({ attempted: 0, created: 0 });
    expect(db.routineOccurrence.createMany).not.toHaveBeenCalled();
  });
  it('is idempotent when the same schedule window is generated twice', async () => {
    const seen = new Set<string>();
    const prisma = {
      routineSchedule: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'schedule-1',
            routineId: 'routine-1',
            timezone: 'Asia/Shanghai',
            localTimeMinutes: 8 * 60,
            weekdayMask: 0b1111111,
            startDate: new Date('2026-08-01T00:00:00.000Z'),
            endDate: null,
            graceMinutes: 10,
            familyNoticeMinutes: 20,
            active: true,
            routine: {
              householdId: 'household-1',
              recipientId: 'recipient-1',
              status: 'ACTIVE',
              deletedAt: null,
            },
          },
        ]),
      },
      routineOccurrence: {
        createMany: jest.fn().mockImplementation(({ data }) => {
          let count = 0;
          for (const row of data as Array<{
            scheduleId: string;
            scheduledAtUtc: Date;
          }>) {
            const key = `${row.scheduleId}:${row.scheduledAtUtc.toISOString()}`;
            if (!seen.has(key)) {
              seen.add(key);
              count += 1;
            }
          }
          return Promise.resolve({ count });
        }),
      },
    };
    const cipher = {} as CareWorkflowContentCipher;
    Object.assign(prisma, {
      $queryRaw: jest.fn().mockResolvedValue([{ id: 'routine-1' }]),
      $transaction: async (work: (transaction: unknown) => Promise<unknown>) =>
        work(prisma),
    });
    Object.assign(prisma.routineSchedule, {
      findFirst: async () => (await prisma.routineSchedule.findMany())[0],
    });
    const scheduler = new PrismaOccurrenceScheduler(
      prisma as unknown as PrismaService,
      cipher,
    );
    const command = {
      windowStartUtc: new Date('2026-08-01T00:00:00.000Z'),
      windowEndUtc: new Date('2026-08-02T00:00:00.000Z'),
    };

    await expect(scheduler.generateOccurrences(command)).resolves.toEqual({
      attempted: 1,
      created: 1,
    });
    await expect(scheduler.generateOccurrences(command)).resolves.toEqual({
      attempted: 1,
      created: 0,
    });
  });
});
