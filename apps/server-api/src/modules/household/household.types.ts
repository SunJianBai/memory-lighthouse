import type { UserPrincipal } from '../identity/identity.types';
import type { HouseholdRoleCode } from './household.constants';

export type AuthPrincipal = UserPrincipal;

export interface HouseholdView {
  id: string;
  name: string;
  timezone: string;
  status: string;
  roleCodes: HouseholdRoleCode[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface HouseholdMemberView {
  id: string;
  householdId: string;
  userId: string;
  displayName: string;
  status: string;
  roleCodes: HouseholdRoleCode[];
  joinedAt: string | null;
  version: number;
}

export interface HouseholdInvitationView {
  id: string;
  householdId: string;
  targetEmail: string;
  roleCode: HouseholdRoleCode;
  expiresAt: string;
  createdAt: string;
}

export interface CareRecipientView {
  id: string;
  householdId: string;
  name: string;
  preferredName: string;
  birthDate: string | null;
  timezone: string;
  homeLabel: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CareAuthorityView {
  id: string;
  householdId: string;
  recipientId: string;
  memberId: string;
  userId: string;
  displayName: string;
  relationshipLabel: string | null;
  accessLevel: string;
  canManageProfile: boolean;
  canManageConsent: boolean;
  canManageRoutine: boolean;
  canViewEvents: boolean;
  canViewConversation: boolean;
  canActivateDevice: boolean;
  canRemoteCall: boolean;
  receiveNotifications: boolean;
  contactPriority: number | null;
  status: string;
  version: number;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason?: 'HOUSEHOLD_ACCESS_DENIED' | 'RECIPIENT_ACCESS_DENIED';
}

export type HouseholdAction =
  'VIEW_HOUSEHOLD' | 'MANAGE_HOUSEHOLD' | 'MANAGE_MEMBERS';

export type RecipientAction =
  | 'VIEW_RECIPIENT'
  | 'MANAGE_RECIPIENT'
  | 'MANAGE_CONSENT'
  | 'MANAGE_AUTHORITIES'
  | 'MANAGE_ROUTINE'
  | 'VIEW_EVENTS'
  | 'VIEW_CONVERSATION'
  | 'ACTIVATE_DEVICE'
  | 'REMOTE_CALL';

export interface CreateHouseholdCommand {
  name: string;
  timezone?: string;
}

export interface UpdateHouseholdCommand {
  name?: string;
  timezone?: string;
  version: number;
}

export interface UpdateHouseholdMemberCommand {
  roleCodes: HouseholdRoleCode[];
  version: number;
}

export interface CreateInvitationCommand {
  targetEmail: string;
  roleCode: HouseholdRoleCode;
  expiresInSeconds?: number;
}

export interface CreateCareRecipientCommand {
  name: string;
  preferredName?: string;
  birthDate?: string;
  timezone?: string;
  homeLabel?: string;
}

export interface UpdateCareRecipientCommand {
  name?: string;
  preferredName?: string;
  birthDate?: string | null;
  timezone?: string;
  homeLabel?: string | null;
  version: number;
}

export interface PutCareAuthorityCommand {
  relationshipLabel?: string | null;
  accessLevel: string;
  canManageProfile: boolean;
  canManageConsent: boolean;
  canManageRoutine: boolean;
  canViewEvents: boolean;
  canViewConversation: boolean;
  canActivateDevice: boolean;
  canRemoteCall: boolean;
  receiveNotifications: boolean;
  contactPriority?: number | null;
  status: 'ACTIVE' | 'REVOKED';
  version?: number;
}
