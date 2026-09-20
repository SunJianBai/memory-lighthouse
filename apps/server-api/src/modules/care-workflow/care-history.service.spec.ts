import { ForbiddenException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import type { UserPrincipal } from '../identity/identity.types';
import { AesGcmContentCipherAdapter } from './adapters/aes-gcm-content-cipher.adapter';
import { CareHistoryService } from './care-history.service';

const now = new Date('2026-09-20T04:00:00.000Z');
const principal: UserPrincipal = {
  kind: 'USER',
  userId: 'user-1',
  sessionId: 'session',
  tokenId: 'token',
  status: 'ACTIVE',
};

function harness() {
  const cipher = new AesGcmContentCipherAdapter(
    new ConfigService({ NODE_ENV: 'test' }),
  );
  const encrypted = cipher.encrypt(
    JSON.stringify(['家庭录入内容', '仅用作记录']),
  );
  const protectedPair = {
    titleCiphertext: encrypted.ciphertext,
    summaryCiphertext: Buffer.alloc(0),
    contentNonce: encrypted.nonce,
    encryptionKeyId: encrypted.encryptionKeyId,
  };
  const record = (index: number) => ({
    id: String(index).padStart(26, '0'),
    householdId: 'home',
    recipientId: 'recipient',
    type: 'ROUTINE_CONFIRMED',
    severity: 'INFO',
    sourceType: 'FAMILY',
    sourceId: null,
    routineOccurrenceId: null,
    payloadJson: null,
    occurredAt: now,
    createdAt: now,
    ...protectedPair,
  });
  const occurrence = (index: number) => ({
    id: String(index).padStart(26, '0'),
    householdId: 'home',
    recipientId: 'recipient',
    routineId: 'routine',
    scheduleId: 'schedule',
    scheduledAtUtc: now,
    scheduledLocalDate: new Date('2026-09-20T00:00:00Z'),
    status: 'NEEDS_FAMILY_REVIEW',
    version: 1,
    confirmationDeadlineAt: now,
    escalationAt: now,
    completedAt: null,
    routine: { title: '旧提醒', type: 'HYDRATION', ...protectedPair },
  });
  const tx = {
    careRecipient: {
      findFirstOrThrow: jest
        .fn()
        .mockResolvedValue({ timezone: 'Asia/Shanghai' }),
    },
    routineOccurrence: { findMany: jest.fn().mockResolvedValue([]) },
    careEvent: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = {
    $transaction: jest.fn(
      async (read: (value: typeof tx) => Promise<unknown>) => read(tx),
    ),
  };
  const policy = { requireRecipientAction: jest.fn().mockResolvedValue({}) };
  const decrypt = jest.spyOn(cipher, 'decrypt');
  const service = new CareHistoryService(
    prisma as unknown as PrismaService,
    policy as unknown as HouseholdAccessPolicy,
    { now: () => now },
    cipher,
  );
  return { service, prisma, policy, tx, decrypt, record, occurrence };
}

describe('CareHistoryService bounded reads', () => {
  it('authorizes before reading profile or records and uses a repeatable read per page', async () => {
    const { service, policy, tx, prisma } = harness();
    policy.requireRecipientAction.mockRejectedValue(new ForbiddenException());
    await expect(
      service.read(principal, 'home', 'recipient', 'events', {}),
    ).rejects.toThrow(ForbiddenException);
    expect(policy.requireRecipientAction).toHaveBeenCalledWith(
      tx,
      principal.userId,
      'home',
      'recipient',
      'VIEW_EVENTS',
    );
    expect(tx.careRecipient.findFirstOrThrow).not.toHaveBeenCalled();
    expect(tx.careEvent.findMany).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
  });

  it('fetches one extra row but only decrypts a page and uses stable time/id order', async () => {
    const { service, tx, record, decrypt } = harness();
    tx.careEvent.findMany.mockResolvedValue(
      Array.from({ length: 31 }, (_, i) => record(65 - i)),
    );
    const first = await service.read(
      principal,
      'home',
      'recipient',
      'events',
      {},
    );
    expect(first.items).toHaveLength(30);
    expect(first.items[0]).toMatchObject({
      title: '家庭录入内容',
      summary: '仅用作记录',
    });
    expect(decrypt).toHaveBeenCalledTimes(30);
    expect(tx.careEvent.findMany).toHaveBeenLastCalledWith({
      where: { householdId: 'home', recipientId: 'recipient' },
      take: 31,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
    tx.careEvent.findMany.mockResolvedValue([record(35)]);
    const next = await service.read(principal, 'home', 'recipient', 'events', {
      cursor: first.nextCursor!,
    });
    expect(tx.careEvent.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          householdId: 'home',
          recipientId: 'recipient',
          OR: [
            { occurredAt: { lt: now } },
            { occurredAt: now, id: { lt: record(36).id } },
          ],
        },
      }),
    );
    expect(next.items.map((item) => item.id)).toEqual([record(35).id]);
    expect(next.nextCursor).toBeNull();
  });

  it('passes all occurrence date and current-status filters to the database before projecting', async () => {
    const { service, tx, occurrence, decrypt } = harness();
    tx.routineOccurrence.findMany.mockResolvedValue([
      occurrence(3),
      occurrence(2),
      occurrence(1),
    ]);
    const query = {
      startDate: '2026-09-01',
      endDate: '2026-09-20',
      status: 'NEEDS_FAMILY_REVIEW',
      limit: 2,
    };
    const first = await service.read(
      principal,
      'home',
      'recipient',
      'occurrences',
      query,
    );
    expect(first).toMatchObject({
      timezone: 'Asia/Shanghai',
      from: '2026-08-31T16:00:00.000Z',
      to: '2026-09-20T16:00:00.000Z',
    });
    expect(first.items).toHaveLength(2);
    expect(first.items[0]).toMatchObject({
      routineTitle: '旧提醒',
      instructions: '家庭录入内容',
      status: 'NEEDS_FAMILY_REVIEW',
      version: 1,
    });
    expect(decrypt).toHaveBeenCalledTimes(2);
    const common = {
      householdId: 'home',
      recipientId: 'recipient',
      status: 'NEEDS_FAMILY_REVIEW',
      scheduledAtUtc: {
        gte: new Date('2026-08-31T16:00:00Z'),
        lt: new Date('2026-09-20T16:00:00Z'),
      },
    };
    expect(tx.routineOccurrence.findMany).toHaveBeenLastCalledWith({
      where: common,
      include: { routine: true },
      take: 3,
      orderBy: [{ scheduledAtUtc: 'desc' }, { id: 'desc' }],
    });
    tx.routineOccurrence.findMany.mockResolvedValue([occurrence(1)]);
    const next = await service.read(
      principal,
      'home',
      'recipient',
      'occurrences',
      { ...query, cursor: first.nextCursor! },
    );
    expect(next.nextCursor).toBeNull();
    expect(tx.routineOccurrence.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: {
          ...common,
          OR: [
            { scheduledAtUtc: { lt: now } },
            { scheduledAtUtc: now, id: { lt: occurrence(2).id } },
          ],
        },
      }),
    );
  });

  it('rejects a later page after access is revoked without reading or decrypting again', async () => {
    const { service, tx, policy, record, decrypt } = harness();
    tx.careEvent.findMany.mockResolvedValue([record(2), record(1)]);
    const first = await service.read(principal, 'home', 'recipient', 'events', {
      limit: 1,
    });
    policy.requireRecipientAction.mockRejectedValue(new ForbiddenException());
    await expect(
      service.read(principal, 'home', 'recipient', 'events', {
        limit: 1,
        cursor: first.nextCursor!,
      }),
    ).rejects.toThrow(ForbiddenException);
    expect(policy.requireRecipientAction).toHaveBeenCalledTimes(2);
    expect(tx.careEvent.findMany).toHaveBeenCalledTimes(1);
    expect(decrypt).toHaveBeenCalledTimes(1);
  });

  it('does not query records on invalid date ranges, timezone or mismatched cursors', async () => {
    const { service, tx, record } = harness();
    tx.careEvent.findMany.mockResolvedValue([record(2), record(1)]);
    const first = await service.read(principal, 'home', 'recipient', 'events', {
      limit: 1,
    });
    await expect(
      service.read(principal, 'home', 'other', 'events', {
        limit: 1,
        cursor: first.nextCursor!,
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service.read(principal, 'home', 'recipient', 'events', {
        startDate: '2026-02-30',
        endDate: '2026-03-01',
      }),
    ).rejects.toThrow(BadRequestException);
    tx.careRecipient.findFirstOrThrow.mockResolvedValue({
      timezone: 'Invalid/Zone',
    });
    await expect(
      service.read(principal, 'home', 'recipient', 'events', {}),
    ).rejects.toThrow(BadRequestException);
    expect(tx.careEvent.findMany).toHaveBeenCalledTimes(1);
  });

  it('queries event dates by occurredAt and returns a real empty page, not a failure', async () => {
    const { service, tx } = harness();
    const result = await service.read(
      principal,
      'home',
      'recipient',
      'events',
      { startDate: '2026-09-01', endDate: '2026-09-01', limit: 50 },
    );
    expect(tx.careEvent.findMany).toHaveBeenCalledWith({
      where: {
        householdId: 'home',
        recipientId: 'recipient',
        occurredAt: {
          gte: new Date('2026-08-31T16:00:00Z'),
          lt: new Date('2026-09-01T16:00:00Z'),
        },
      },
      take: 51,
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
    expect(result).toMatchObject({ items: [], nextCursor: null });
    tx.careEvent.findMany.mockRejectedValue(new Error('Database unavailable'));
    await expect(
      service.read(principal, 'home', 'recipient', 'events', {}),
    ).rejects.toThrow('Database unavailable');
  });
});
