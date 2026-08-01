import { describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '../../infrastructure/database/prisma.service';
import { HouseholdAccessDeniedException } from '../household/household.errors';
import type { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import { NotificationApplicationService } from './notification.application.service';
import { contentInspectionDedupeKey } from './notification.constants';
import {
  AdminAccessReceiptNotFoundException,
  InspectionNotificationRecipientUnavailableException,
  InvalidAdminAccessCursorException,
} from './notification.errors';

type Row = Record<string, any>;

const ID = {
  household: '01K1M000000000000000000001',
  otherHousehold: '01K1M000000000000000000002',
  owner: '01K1M000000000000000000003',
  secondOwner: '01K1M000000000000000000004',
  inspection1: '01K1M000000000000000000011',
  inspection2: '01K1M000000000000000000012',
  inspection3: '01K1M000000000000000000013',
  inspection4: '01K1M000000000000000000014',
};

const FULL_REASON = '完整检查原因：' + '需要验证模型能力。'.repeat(20);
const READ_AT = new Date('2026-08-02T10:05:00.000Z');

class NotificationPrismaHarness {
  ownerUserIds = [ID.owner, ID.secondOwner];
  readonly notifications: Row[] = [];
  readonly receipts: Row[] = [];
  readonly inspections: Row[] = [
    {
      id: ID.inspection1,
      householdId: ID.household,
      resourceType: 'MEMORY_REVISION',
      resourceId: 'private-resource-1',
      operatorUserId: 'private-operator',
      requestId: 'private-request',
      occurredAt: new Date('2026-08-02T10:04:00.000Z'),
      grant: { reason: FULL_REASON, id: 'private-grant' },
    },
    {
      id: ID.inspection2,
      householdId: ID.household,
      resourceType: 'CONVERSATION_UTTERANCE',
      resourceId: 'private-resource-2',
      occurredAt: new Date('2026-08-02T10:03:00.000Z'),
      grant: { reason: '对话质量检查' },
    },
    {
      id: ID.inspection3,
      householdId: ID.household,
      resourceType: 'MEMORY_REVISION',
      resourceId: 'private-resource-3',
      occurredAt: new Date('2026-08-02T10:02:00.000Z'),
      grant: { reason: '历史记录' },
    },
    {
      id: ID.inspection4,
      householdId: ID.household,
      resourceType: 'MEMORY_REVISION',
      resourceId: 'private-resource-4',
      occurredAt: new Date('2026-08-02T10:01:00.000Z'),
      grant: { reason: '下一页' },
    },
  ];

  readonly householdMember = {
    findMany: jest.fn(async () =>
      this.ownerUserIds.map((userId) => ({ userId })),
    ),
  };

  readonly contentInspection = {
    findFirst: jest.fn(
      async ({ where }: Row) =>
        this.inspections.find(
          (inspection) =>
            inspection.id === where.id &&
            inspection.householdId === where.grant.householdId,
        ) ?? null,
    ),
    findMany: jest.fn(async ({ where, take, cursor, skip }: Row) => {
      const householdRecords = this.inspections.filter(
        (inspection) => inspection.householdId === where.grant.householdId,
      );
      const start = cursor
        ? householdRecords.findIndex((record) => record.id === cursor.id) +
          (skip ?? 0)
        : 0;
      return householdRecords.slice(start, start + take);
    }),
  };

  readonly notification = {
    create: jest.fn(async ({ data }: Row) => {
      this.notifications.push(data);
      return data;
    }),
    findUnique: jest.fn(async ({ where }: Row) => {
      const key = where.householdId_dedupeKey;
      return (
        this.notifications.find(
          (notification) =>
            notification.householdId === key.householdId &&
            notification.dedupeKey === key.dedupeKey,
        ) ?? null
      );
    }),
  };

  readonly userNotification = {
    createMany: jest.fn(async ({ data }: Row) => {
      this.receipts.push(...data);
      return { count: data.length };
    }),
    findMany: jest.fn(async ({ where }: Row) =>
      this.receipts
        .filter((receipt) => {
          const notification = this.notifications.find(
            (candidate) => candidate.id === receipt.notificationId,
          );
          return (
            receipt.userId === where.userId &&
            notification?.householdId === where.notification.householdId &&
            notification.type === where.notification.type &&
            where.notification.dedupeKey.in.includes(notification.dedupeKey)
          );
        })
        .map((receipt) => ({
          readAt: receipt.readAt,
          notification: {
            dedupeKey: this.notifications.find(
              (candidate) => candidate.id === receipt.notificationId,
            )?.dedupeKey,
          },
        })),
    ),
    count: jest.fn(
      async ({ where }: Row) =>
        this.receipts.filter((receipt) => {
          const notification = this.notifications.find(
            (candidate) => candidate.id === receipt.notificationId,
          );
          return (
            receipt.userId === where.userId &&
            receipt.readAt === null &&
            notification?.householdId === where.notification.householdId &&
            notification.type === where.notification.type
          );
        }).length,
    ),
    findUnique: jest.fn(async ({ where }: Row) => {
      const key = where.notificationId_userId;
      return (
        this.receipts.find(
          (receipt) =>
            receipt.notificationId === key.notificationId &&
            receipt.userId === key.userId,
        ) ?? null
      );
    }),
    updateMany: jest.fn(async ({ where, data }: Row) => {
      const receipt = this.receipts.find(
        (candidate) =>
          candidate.notificationId === where.notificationId &&
          candidate.userId === where.userId &&
          candidate.readAt === null,
      );
      if (!receipt) {
        return { count: 0 };
      }
      receipt.readAt = data.readAt;
      return { count: 1 };
    }),
  };

  readonly $transaction = jest.fn(
    async (
      work: (transaction: NotificationPrismaHarness) => Promise<unknown>,
    ) => work(this),
  );

  addInspectionNotification(
    inspectionId: string,
    receiptStates: Array<{ userId: string; readAt: Date | null }>,
  ): void {
    const notificationId = `N${inspectionId.slice(1)}`;
    this.notifications.push({
      id: notificationId,
      householdId: ID.household,
      type: 'CONTENT_INSPECTION_PERFORMED',
      dedupeKey: contentInspectionDedupeKey(inspectionId),
    });
    this.receipts.push(
      ...receiptStates.map((receipt) => ({
        notificationId,
        ...receipt,
      })),
    );
  }
}

function makeService() {
  const prisma = new NotificationPrismaHarness();
  const access = {
    requireHouseholdAction: jest.fn(async () => ({
      id: 'member-owner',
      userId: ID.owner,
      householdId: ID.household,
      roleCodes: ['OWNER'],
    })),
  };
  const service = new NotificationApplicationService(
    prisma as unknown as PrismaService,
    access as unknown as HouseholdAccessPolicy,
  );
  return { prisma, access, service };
}

describe('NotificationApplicationService', () => {
  it('enqueues one minimal notification and independent receipts for every current active OWNER', async () => {
    const { prisma, service } = makeService();
    const occurredAt = new Date('2026-08-02T10:00:00.000Z');

    await service.enqueueInspectionPerformed(prisma as never, {
      inspectionId: ID.inspection1,
      householdId: ID.household,
      recipientId: '01K1M000000000000000000021',
      category: 'MEMORY_REVISION',
      reason: FULL_REASON,
      occurredAt,
    });

    expect(prisma.householdMember.findMany).toHaveBeenCalledWith({
      where: {
        householdId: ID.household,
        status: 'ACTIVE',
        household: { status: 'ACTIVE' },
        roles: {
          some: { role: { scope: 'HOUSEHOLD', code: 'OWNER' } },
        },
      },
      select: { userId: true },
    });
    expect(prisma.notifications).toHaveLength(1);
    expect(prisma.notifications[0]).toMatchObject({
      householdId: ID.household,
      type: 'CONTENT_INSPECTION_PERFORMED',
      templateVariablesJson: {
        inspectionId: ID.inspection1,
        category: 'MEMORY_REVISION',
        reason: FULL_REASON,
        occurredAt: occurredAt.toISOString(),
      },
    });
    expect(Object.keys(prisma.notifications[0].templateVariablesJson)).toEqual([
      'inspectionId',
      'category',
      'reason',
      'occurredAt',
    ]);
    expect(
      JSON.stringify(prisma.notifications[0].templateVariablesJson),
    ).not.toMatch(
      /resourceId|operatorUserId|grantId|requestId|ticket|content|rawText/,
    );
    expect(prisma.receipts.map((receipt) => receipt.userId)).toEqual([
      ID.owner,
      ID.secondOwner,
    ]);
  });

  it('fails closed when no active OWNER can receive the privacy notification', async () => {
    const { prisma, service } = makeService();
    prisma.ownerUserIds = [];

    await expect(
      service.enqueueInspectionPerformed(prisma as never, {
        inspectionId: ID.inspection1,
        householdId: ID.household,
        category: 'MEMORY_REVISION',
        reason: FULL_REASON,
        occurredAt: new Date(),
      }),
    ).rejects.toBeInstanceOf(
      InspectionNotificationRecipientUnavailableException,
    );
    expect(prisma.notifications).toHaveLength(0);
    expect(prisma.receipts).toHaveLength(0);
  });

  it('returns only family-safe metadata with unread, read, and historical states', async () => {
    const { prisma, access, service } = makeService();
    prisma.addInspectionNotification(ID.inspection1, [
      { userId: ID.owner, readAt: null },
    ]);
    prisma.addInspectionNotification(ID.inspection2, [
      { userId: ID.owner, readAt: READ_AT },
    ]);

    const result = await service.listAdminAccesses({
      userId: ID.owner,
      householdId: ID.household,
      limit: 3,
    });

    expect(access.requireHouseholdAction).toHaveBeenCalledWith(
      prisma,
      ID.owner,
      ID.household,
      'VIEW_PRIVACY_AUDIT',
    );
    expect(result).toEqual({
      items: [
        {
          id: ID.inspection1,
          occurredAt: '2026-08-02T10:04:00.000Z',
          category: 'MEMORY_REVISION',
          categoryLabel: '记忆修订原文',
          reason: FULL_REASON,
          notificationState: 'UNREAD',
          readAt: null,
        },
        {
          id: ID.inspection2,
          occurredAt: '2026-08-02T10:03:00.000Z',
          category: 'CONVERSATION_UTTERANCE',
          categoryLabel: '对话话轮原文',
          reason: '对话质量检查',
          notificationState: 'READ',
          readAt: READ_AT.toISOString(),
        },
        {
          id: ID.inspection3,
          occurredAt: '2026-08-02T10:02:00.000Z',
          category: 'MEMORY_REVISION',
          categoryLabel: '记忆修订原文',
          reason: '历史记录',
          notificationState: 'HISTORICAL',
          readAt: null,
        },
      ],
      nextCursor: ID.inspection3,
      unreadCount: 1,
    });
    const apiJson = JSON.stringify(result);
    expect(apiJson).not.toMatch(
      /resourceId|operatorUserId|grantId|requestId|ticketReference|private-resource|private-operator|private-request/,
    );
  });

  it('rejects a cursor from another household before querying a page', async () => {
    const { prisma, service } = makeService();

    await expect(
      service.listAdminAccesses({
        userId: ID.owner,
        householdId: ID.otherHousehold,
        cursor: ID.inspection1,
      }),
    ).rejects.toBeInstanceOf(InvalidAdminAccessCursorException);
    expect(prisma.contentInspection.findMany).not.toHaveBeenCalled();
  });

  it('does not query inspection metadata after owner authorization fails', async () => {
    const { prisma, access, service } = makeService();
    access.requireHouseholdAction.mockRejectedValueOnce(
      new HouseholdAccessDeniedException() as never,
    );

    await expect(
      service.listAdminAccesses({
        userId: ID.owner,
        householdId: ID.household,
      }),
    ).rejects.toBeInstanceOf(HouseholdAccessDeniedException);
    expect(prisma.contentInspection.findMany).not.toHaveBeenCalled();
  });

  it('marks only the current OWNER receipt and preserves the first read time on retries', async () => {
    const { prisma, service } = makeService();
    prisma.addInspectionNotification(ID.inspection1, [
      { userId: ID.owner, readAt: null },
      { userId: ID.secondOwner, readAt: null },
    ]);

    const first = await service.markAdminAccessRead({
      userId: ID.owner,
      householdId: ID.household,
      inspectionId: ID.inspection1,
    });
    const second = await service.markAdminAccessRead({
      userId: ID.owner,
      householdId: ID.household,
      inspectionId: ID.inspection1,
    });

    expect(second).toEqual(first);
    expect(prisma.userNotification.updateMany).toHaveBeenCalledTimes(1);
    expect(
      prisma.receipts.find((receipt) => receipt.userId === ID.secondOwner)
        ?.readAt,
    ).toBeNull();
  });

  it('retries a serializable conflict before marking the receipt read', async () => {
    const { prisma, service } = makeService();
    prisma.addInspectionNotification(ID.inspection1, [
      { userId: ID.owner, readAt: null },
    ]);
    prisma.$transaction.mockRejectedValueOnce({ code: 'P2034' } as never);

    const result = await service.markAdminAccessRead({
      userId: ID.owner,
      householdId: ID.household,
      inspectionId: ID.inspection1,
    });

    expect(result.inspectionId).toBe(ID.inspection1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(prisma.userNotification.updateMany).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-serializable database failure', async () => {
    const { prisma, service } = makeService();
    const failure = { code: 'P2003' };
    prisma.$transaction.mockRejectedValueOnce(failure as never);

    await expect(
      service.listAdminAccesses({
        userId: ID.owner,
        householdId: ID.household,
      }),
    ).rejects.toBe(failure);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('does not create a receipt when a historical inspection is marked read', async () => {
    const { prisma, service } = makeService();

    await expect(
      service.markAdminAccessRead({
        userId: ID.owner,
        householdId: ID.household,
        inspectionId: ID.inspection3,
      }),
    ).rejects.toBeInstanceOf(AdminAccessReceiptNotFoundException);
    expect(prisma.userNotification.updateMany).not.toHaveBeenCalled();
  });
});
