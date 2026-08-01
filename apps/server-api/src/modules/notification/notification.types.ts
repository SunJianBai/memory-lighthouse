import type { Prisma } from '../../infrastructure/database/generated/prisma/client';

export type AdminAccessNotificationState = 'UNREAD' | 'READ' | 'HISTORICAL';

export interface AdminAccessView {
  id: string;
  occurredAt: string;
  category: string;
  categoryLabel: string;
  reason: string;
  notificationState: AdminAccessNotificationState;
  readAt: string | null;
}

export interface AdminAccessPage {
  items: AdminAccessView[];
  nextCursor: string | null;
  unreadCount: number;
}

export interface ListAdminAccessesQuery {
  userId: string;
  householdId: string;
  cursor?: string;
  limit?: number;
}

export interface MarkAdminAccessReadCommand {
  userId: string;
  householdId: string;
  inspectionId: string;
}

export interface MarkAdminAccessReadResult {
  inspectionId: string;
  readAt: string;
}

export interface InspectionPerformedNotificationVariables {
  inspectionId: string;
  category: string;
  reason: string;
  occurredAt: string;
}

export interface EnqueueInspectionPerformedInput {
  inspectionId: string;
  householdId: string;
  recipientId?: string;
  category: string;
  reason: string;
  occurredAt: Date;
}

export type NotificationTransaction = Pick<
  Prisma.TransactionClient,
  'householdMember' | 'notification' | 'userNotification'
>;
