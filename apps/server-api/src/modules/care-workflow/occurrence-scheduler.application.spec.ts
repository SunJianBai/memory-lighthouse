import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { CareWorkflowContentCipher } from './ports/content-cipher.port';
import { PrismaOccurrenceScheduler } from './occurrence-scheduler.application';

describe('PrismaOccurrenceScheduler', () => {
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
