import type { UserPrincipal } from '../identity/identity.types';
import type {
  InspectionDataCategory,
  PlatformRoleCode,
} from './platform-operations.constants';

export interface PlatformPrincipal extends UserPrincipal {
  platformRoles: PlatformRoleCode[];
}

export interface PlatformPageQuery {
  page?: number;
  limit?: number;
  search?: string;
  status?: string;
}

export interface PlatformPage<T> {
  items: T[];
  page: number;
  limit: number;
  total: number;
  hasNext: boolean;
}

export interface PlatformRequestMetadata {
  requestId: string;
  userAgent?: string;
}

export interface RequestInspectionGrantCommand {
  principal: PlatformPrincipal;
  householdId: string;
  recipientId?: string;
  dataCategories: InspectionDataCategory[];
  reason: string;
  ticketReference?: string;
  expiresInSeconds?: number;
  request: PlatformRequestMetadata;
}

export interface GrantMutationCommand {
  principal: PlatformPrincipal;
  grantId: string;
  request: PlatformRequestMetadata;
}

export interface InspectMemoryCommand {
  principal: PlatformPrincipal;
  grantId: string;
  memoryId: string;
  revisionId?: string;
  request: PlatformRequestMetadata;
}

export interface InspectUtteranceCommand {
  principal: PlatformPrincipal;
  grantId: string;
  utteranceId: string;
  request: PlatformRequestMetadata;
}

export interface InspectionWatermark {
  operatorUserId: string;
  grantId: string;
  requestId: string;
  occurredAt: string;
}
