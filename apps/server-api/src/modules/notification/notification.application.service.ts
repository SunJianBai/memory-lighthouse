import { Injectable } from '@nestjs/common';

import { Prisma } from '../../infrastructure/database/generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  ACTIVE_MEMBER_STATUS,
  HOUSEHOLD_ROLE_SCOPE,
} from '../household/household.constants';
import { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import { newUlid } from '../identity/domain/ulid';
import {
  ADMIN_ACCESS_CATEGORY_LABELS,
  ADMIN_ACCESS_PAGE_DEFAULT,
  ADMIN_ACCESS_PAGE_MAX,
  ADMIN_ACCESS_SERIALIZABLE_RETRY_LIMIT,
  CONTENT_INSPECTION_NOTIFICATION_PRIORITY,
  CONTENT_INSPECTION_NOTIFICATION_TEMPLATE,
  CONTENT_INSPECTION_NOTIFICATION_TYPE,
  contentInspectionDedupeKey,
} from './notification.constants';
import {
  AdminAccessReceiptNotFoundException,
  InspectionNotificationRecipientUnavailableException,
  InvalidAdminAccessCursorException,
} from './notification.errors';
import type {
  AdminAccessPage,
  EnqueueInspectionPerformedInput,
  InspectionPerformedNotificationVariables,
  ListAdminAccessesQuery,
  MarkAdminAccessReadCommand,
  MarkAdminAccessReadResult,
  NotificationTransaction,
} from './notification.types';

@Injectable()
export class NotificationApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: HouseholdAccessPolicy,
  ) {}

  async enqueueInspectionPerformed(
    transaction: NotificationTransaction,
    input: EnqueueInspectionPerformedInput,
  ): Promise<void> {
    const owners = await transaction.householdMember.findMany({
      where: {
        householdId: input.householdId,
        status: ACTIVE_MEMBER_STATUS,
        household: { status: 'ACTIVE' },
        roles: {
          some: {
            role: { scope: HOUSEHOLD_ROLE_SCOPE, code: 'OWNER' },
          },
        },
      },
      select: { userId: true },
    });
    const ownerUserIds = [...new Set(owners.map((owner) => owner.userId))];
    if (ownerUserIds.length === 0) {
      throw new InspectionNotificationRecipientUnavailableException();
    }

    const notificationId = newUlid(input.occurredAt.getTime());
    const variables: InspectionPerformedNotificationVariables = {
      inspectionId: input.inspectionId,
      category: input.category,
      reason: input.reason,
      occurredAt: input.occurredAt.toISOString(),
    };
    await transaction.notification.create({
      data: {
        id: notificationId,
        householdId: input.householdId,
        recipientId: input.recipientId ?? null,
        type: CONTENT_INSPECTION_NOTIFICATION_TYPE,
        priority: CONTENT_INSPECTION_NOTIFICATION_PRIORITY,
        templateCode: CONTENT_INSPECTION_NOTIFICATION_TEMPLATE,
        templateVariablesJson: variables as unknown as Prisma.InputJsonValue,
        scheduledAt: input.occurredAt,
        dedupeKey: contentInspectionDedupeKey(input.inspectionId),
        createdAt: input.occurredAt,
      },
    });
    const receipts = await transaction.userNotification.createMany({
      data: ownerUserIds.map((userId) => ({
        notificationId,
        userId,
        readAt: null,
        createdAt: input.occurredAt,
      })),
    });
    if (receipts.count !== ownerUserIds.length) {
      throw new InspectionNotificationRecipientUnavailableException();
    }
  }

  listAdminAccesses(query: ListAdminAccessesQuery): Promise<AdminAccessPage> {
    return this.retrySerializable(async (transaction) => {
      await this.access.requireHouseholdAction(
        transaction,
        query.userId,
        query.householdId,
        'VIEW_PRIVACY_AUDIT',
      );
      const limit = Math.min(
        Math.max(query.limit ?? ADMIN_ACCESS_PAGE_DEFAULT, 1),
        ADMIN_ACCESS_PAGE_MAX,
      );

      if (query.cursor) {
        const cursor = await transaction.contentInspection.findFirst({
          where: {
            id: query.cursor,
            grant: { householdId: query.householdId },
          },
          select: { id: true },
        });
        if (!cursor) {
          throw new InvalidAdminAccessCursorException();
        }
      }

      const records = await transaction.contentInspection.findMany({
        where: { grant: { householdId: query.householdId } },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        select: {
          id: true,
          resourceType: true,
          occurredAt: true,
          grant: { select: { reason: true } },
        },
      });
      const hasNextPage = records.length > limit;
      const page = hasNextPage ? records.slice(0, limit) : records;
      const dedupeKeys = page.map((record) =>
        contentInspectionDedupeKey(record.id),
      );
      const receipts =
        dedupeKeys.length === 0
          ? []
          : await transaction.userNotification.findMany({
              where: {
                userId: query.userId,
                notification: {
                  householdId: query.householdId,
                  type: CONTENT_INSPECTION_NOTIFICATION_TYPE,
                  dedupeKey: { in: dedupeKeys },
                },
              },
              select: {
                readAt: true,
                notification: { select: { dedupeKey: true } },
              },
            });
      const receiptByDedupeKey = new Map(
        receipts.map((receipt) => [receipt.notification.dedupeKey, receipt]),
      );
      const unreadCount = await transaction.userNotification.count({
        where: {
          userId: query.userId,
          readAt: null,
          notification: {
            householdId: query.householdId,
            type: CONTENT_INSPECTION_NOTIFICATION_TYPE,
          },
        },
      });

      return {
        items: page.map((record) => {
          const receipt = receiptByDedupeKey.get(
            contentInspectionDedupeKey(record.id),
          );
          return {
            id: record.id,
            occurredAt: record.occurredAt.toISOString(),
            category: record.resourceType,
            categoryLabel:
              ADMIN_ACCESS_CATEGORY_LABELS[record.resourceType] ??
              record.resourceType,
            reason: record.grant.reason,
            notificationState: receipt
              ? receipt.readAt === null
                ? ('UNREAD' as const)
                : ('READ' as const)
              : ('HISTORICAL' as const),
            readAt: receipt?.readAt?.toISOString() ?? null,
          };
        }),
        nextCursor: hasNextPage ? (page.at(-1)?.id ?? null) : null,
        unreadCount,
      };
    });
  }

  markAdminAccessRead(
    command: MarkAdminAccessReadCommand,
  ): Promise<MarkAdminAccessReadResult> {
    return this.retrySerializable(async (transaction) => {
      await this.access.requireHouseholdAction(
        transaction,
        command.userId,
        command.householdId,
        'VIEW_PRIVACY_AUDIT',
      );
      const inspection = await transaction.contentInspection.findFirst({
        where: {
          id: command.inspectionId,
          grant: { householdId: command.householdId },
        },
        select: { id: true },
      });
      if (!inspection) {
        throw new AdminAccessReceiptNotFoundException();
      }
      const notification = await transaction.notification.findUnique({
        where: {
          householdId_dedupeKey: {
            householdId: command.householdId,
            dedupeKey: contentInspectionDedupeKey(command.inspectionId),
          },
        },
        select: { id: true, type: true },
      });
      if (
        !notification ||
        notification.type !== CONTENT_INSPECTION_NOTIFICATION_TYPE
      ) {
        throw new AdminAccessReceiptNotFoundException();
      }
      const key = {
        notificationId_userId: {
          notificationId: notification.id,
          userId: command.userId,
        },
      } as const;
      const receipt = await transaction.userNotification.findUnique({
        where: key,
        select: { readAt: true },
      });
      if (!receipt) {
        throw new AdminAccessReceiptNotFoundException();
      }
      if (receipt.readAt) {
        return {
          inspectionId: command.inspectionId,
          readAt: receipt.readAt.toISOString(),
        };
      }

      const readAt = new Date();
      const updated = await transaction.userNotification.updateMany({
        where: {
          notificationId: notification.id,
          userId: command.userId,
          readAt: null,
        },
        data: { readAt },
      });
      if (updated.count === 1) {
        return {
          inspectionId: command.inspectionId,
          readAt: readAt.toISOString(),
        };
      }
      const concurrentlyRead = await transaction.userNotification.findUnique({
        where: key,
        select: { readAt: true },
      });
      if (!concurrentlyRead?.readAt) {
        throw new AdminAccessReceiptNotFoundException();
      }
      return {
        inspectionId: command.inspectionId,
        readAt: concurrentlyRead.readAt.toISOString(),
      };
    });
  }

  private async retrySerializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (
      let attempt = 0;
      attempt < ADMIN_ACCESS_SERIALIZABLE_RETRY_LIMIT;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        lastError = error;
        if (!this.isSerializableConflict(error)) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  private isSerializableConflict(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2034'
    );
  }
}
