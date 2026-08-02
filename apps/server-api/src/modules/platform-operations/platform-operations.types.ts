import type { AdminPrincipal } from '../identity/identity.types';
import type { UserView } from '../identity/identity.types';
import type { PlatformCapabilityCode } from './platform-capabilities';
import type {
  InspectionDataCategory,
  PlatformRoleCode,
} from './platform-operations.constants';

export interface PlatformPrincipal extends AdminPrincipal {
  platformRoles: PlatformRoleCode[];
}

export interface PlatformIdentityView {
  user: UserView;
  platformRoles: PlatformRoleCode[];
  capabilities: PlatformCapabilityCode[];
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
  sourceIpHash: Uint8Array;
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
