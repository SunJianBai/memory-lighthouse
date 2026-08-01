import { describe, expect, it, jest } from '@jest/globals';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AssetLifecycleQueue } from './asset-lifecycle.queue';

describe('AssetLifecycleQueue', () => {
  it('lets only one worker lease the same outbox event', async () => {
    const event = {
      id: '01EVENT00000000000000000000',
      aggregateType: 'ASSET',
      aggregateId: '01ASSET00000000000000000000',
      eventType: 'asset.scan-requested',
      availableAt: new Date('2026-08-02T00:00:00.000Z'),
      leaseOwner: null as string | null,
      leaseUntil: null as Date | null,
      publishedAt: null as Date | null,
      attemptCount: 0,
    };
    const raw = {
      outboxEvent: {
        findFirst: jest.fn(async () =>
          event.publishedAt ||
          (event.leaseUntil &&
            event.leaseUntil > new Date('2026-08-02T00:00:00.000Z'))
            ? null
            : { ...event },
        ),
        updateMany: jest.fn(
          async ({
            where,
            data,
          }: {
            where: { id: string; attemptCount: number };
            data: {
              leaseOwner: string;
              leaseUntil: Date;
              attemptCount: { increment: number };
            };
          }) => {
            if (
              where.id !== event.id ||
              where.attemptCount !== event.attemptCount ||
              event.publishedAt ||
              (event.leaseUntil &&
                event.leaseUntil > new Date('2026-08-02T00:00:00.000Z'))
            ) {
              return { count: 0 };
            }
            event.leaseOwner = data.leaseOwner;
            event.leaseUntil = data.leaseUntil;
            event.attemptCount += data.attemptCount.increment;
            return { count: 1 };
          },
        ),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (work: (transaction: typeof raw) => Promise<unknown>) =>
          work(raw),
      ),
    } as unknown as PrismaService;
    const first = new AssetLifecycleQueue(prisma);
    const second = new AssetLifecycleQueue(prisma);
    const now = new Date('2026-08-02T00:00:00.000Z');

    const results = await Promise.all([
      first.claim(now, 300_000),
      second.claim(now, 300_000),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(event.attemptCount).toBe(1);
  });

  it('recovers a missing delete job only after the upload grant has expired', async () => {
    const createdAt = new Date('2026-08-02T00:00:00.000Z');
    const now = new Date('2026-08-02T00:00:10.000Z');
    const asset = {
      id: '01ASSET00000000000000000000',
      status: 'PENDING_DELETE',
      scanStatus: 'PENDING',
      createdAt,
    };
    const createdEvents: Array<Record<string, unknown>> = [];
    const transaction = {
      asset: {
        findUnique: jest.fn(async () => asset),
      },
      outboxEvent: {
        findFirst: jest.fn(async () => null),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          createdEvents.push(data);
          return data;
        }),
      },
    };
    const prisma = {
      asset: {
        findMany: jest.fn(async () => [asset]),
      },
      $transaction: jest.fn(
        async (work: (client: typeof transaction) => Promise<unknown>) =>
          work(transaction),
      ),
    } as unknown as PrismaService;

    await new AssetLifecycleQueue(prisma).recoverMissingJobs(null, 10, now);

    expect(createdEvents).toHaveLength(1);
    expect(createdEvents[0]).toMatchObject({
      aggregateId: asset.id,
      eventType: 'asset.delete-requested',
      availableAt: new Date('2026-08-02T00:06:00.000Z'),
    });
  });
});
