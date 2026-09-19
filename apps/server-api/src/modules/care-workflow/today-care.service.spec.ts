import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import type { UserPrincipal } from '../identity/identity.types';
import { TodayCareService } from './today-care.service';

const principal: UserPrincipal = {
  kind: 'USER',
  userId: 'user-1',
  sessionId: 'session-1',
  tokenId: 'token-1',
  status: 'ACTIVE',
};
const now = new Date('2026-09-19T18:00:00.000Z');

function harness() {
  const transaction = {
    careRecipient: {
      findFirstOrThrow: jest
        .fn()
        .mockResolvedValue({ timezone: 'Asia/Shanghai' }),
    },
    routineOccurrence: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
    },
    familyTask: { count: jest.fn().mockResolvedValue(0) },
  };
  const prisma = {
    $transaction: jest.fn(
      async (read: (tx: typeof transaction) => Promise<unknown>) =>
        read(transaction),
    ),
  };
  const policy = { requireRecipientAction: jest.fn().mockResolvedValue({}) };
  const service = new TodayCareService(
    prisma as unknown as PrismaService,
    policy as unknown as HouseholdAccessPolicy,
    { now: () => now },
  );
  return { service, transaction, prisma, policy };
}

describe('TodayCareService', () => {
  it('authorizes before querying any personal data', async () => {
    const { service, policy, transaction } = harness();
    policy.requireRecipientAction.mockRejectedValue(new ForbiddenException());
    await expect(service.read(principal, 'home-1', 'elder-1')).rejects.toThrow(
      ForbiddenException,
    );
    expect(policy.requireRecipientAction).toHaveBeenCalledWith(
      transaction,
      'user-1',
      'home-1',
      'elder-1',
      'VIEW_EVENTS',
    );
    expect(transaction.careRecipient.findFirstOrThrow).not.toHaveBeenCalled();
    expect(transaction.routineOccurrence.groupBy).not.toHaveBeenCalled();
    expect(transaction.familyTask.count).not.toHaveBeenCalled();
  });

  it('uses recipient-local half-open day bounds and one repeatable snapshot', async () => {
    const { service, transaction, prisma } = harness();
    const result = await service.read(principal, 'home-1', 'elder-1');
    expect(result).toMatchObject({
      localDate: '2026-09-20',
      timezone: 'Asia/Shanghai',
      generatedAt: now.toISOString(),
    });
    const where = {
      householdId: 'home-1',
      recipientId: 'elder-1',
      scheduledAtUtc: {
        gte: new Date('2026-09-19T16:00:00Z'),
        lt: new Date('2026-09-20T16:00:00Z'),
      },
    };
    expect(transaction.routineOccurrence.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where,
      _count: { _all: true },
    });
    for (const [query] of transaction.routineOccurrence.findMany.mock
      .calls as Array<[{ where: object; take: number }]>) {
      expect(query.where).toMatchObject(where);
      expect(query.take).toBe(5);
    }
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });

  it('counts all reminders, prioritizes review, and caps only the visible list', async () => {
    const { service, transaction } = harness();
    transaction.routineOccurrence.groupBy.mockResolvedValue([
      { status: 'CONFIRMED', _count: { _all: 12 } },
      { status: 'NEEDS_FAMILY_REVIEW', _count: { _all: 3 } },
      { status: 'DUE', _count: { _all: 7 } },
      { status: 'AWAITING_CONFIRMATION', _count: { _all: 2 } },
      { status: 'EXPIRED', _count: { _all: 4 } },
    ]);
    const item = (id: string, status: string) => ({
      id,
      status,
      scheduledAtUtc: now,
      routine: { title: id },
    });
    transaction.routineOccurrence.findMany
      .mockResolvedValueOnce(
        [1, 2, 3].map((id) => item(`review-${id}`, 'NEEDS_FAMILY_REVIEW')),
      )
      .mockResolvedValueOnce(
        [1, 2, 3, 4, 5].map((id) => item(`pending-${id}`, 'DUE')),
      );
    const result = await service.read(principal, 'home-1', 'elder-1');
    expect(result.counts).toEqual({
      total: 28,
      confirmed: 12,
      needsReview: 3,
      pending: 9,
      expired: 4,
    });
    expect(result.items.map((item) => item.id)).toEqual([
      'review-1',
      'review-2',
      'review-3',
      'pending-1',
      'pending-2',
    ]);
  });

  it('includes older open or claimed tasks but never another household or recipient', async () => {
    const { service, transaction } = harness();
    transaction.familyTask.count.mockResolvedValue(8);
    expect(
      (await service.read(principal, 'home-1', 'elder-1')).openTaskCount,
    ).toBe(8);
    expect(transaction.familyTask.count).toHaveBeenCalledWith({
      where: {
        householdId: 'home-1',
        recipientId: 'elder-1',
        status: { in: ['OPEN', 'CLAIMED'] },
      },
    });
  });

  it('returns a genuine empty snapshot without synthesizing occurrences', async () => {
    const { service } = harness();
    expect(await service.read(principal, 'home-1', 'elder-1')).toMatchObject({
      counts: {
        total: 0,
        confirmed: 0,
        needsReview: 0,
        pending: 0,
        expired: 0,
      },
      items: [],
      openTaskCount: 0,
    });
  });
});
