import type {
  CareAuthorityView,
  HouseholdMemberView,
} from "../../api/types";

export type CareAuthorityDraft = {
  relationshipLabel: string;
  accessLevel: string;
  canManageProfile: boolean;
  canManageConsent: boolean;
  canManageRoutine: boolean;
  canViewEvents: boolean;
  canViewConversation: boolean;
  canActivateDevice: boolean;
  canRemoteCall: boolean;
  receiveNotifications: boolean;
  contactPriority: string;
  status: "ACTIVE" | "REVOKED";
};

export const authorityDraftFor = (
  member: HouseholdMemberView,
  authority?: CareAuthorityView,
): CareAuthorityDraft => {
  if (authority) {
    return {
      relationshipLabel: authority.relationshipLabel ?? "",
      accessLevel: authority.accessLevel,
      canManageProfile: authority.canManageProfile,
      canManageConsent: authority.canManageConsent,
      canManageRoutine: authority.canManageRoutine,
      canViewEvents: authority.canViewEvents,
      canViewConversation: authority.canViewConversation,
      canActivateDevice: authority.canActivateDevice,
      canRemoteCall: authority.canRemoteCall,
      receiveNotifications: authority.receiveNotifications,
      contactPriority: authority.contactPriority?.toString() ?? "",
      status: authority.status,
    };
  }

  const owner = member.roleCodes.includes("OWNER");
  const caregiver = member.roleCodes.includes("CAREGIVER");
  return {
    relationshipLabel: "",
    accessLevel: owner ? "OWNER" : caregiver ? "CAREGIVER" : "VIEWER",
    canManageProfile: owner || caregiver,
    canManageConsent: owner,
    canManageRoutine: owner || caregiver,
    canViewEvents: owner || caregiver,
    canViewConversation: owner,
    canActivateDevice: owner,
    canRemoteCall: owner,
    receiveNotifications: true,
    contactPriority: "",
    status: "ACTIVE",
  };
};

export const authorityRequestBody = (
  draft: CareAuthorityDraft,
  currentPassword: string,
  version: number,
) => ({
  relationshipLabel: draft.relationshipLabel.trim() || null,
  accessLevel: draft.accessLevel.trim(),
  canManageProfile: draft.canManageProfile,
  canManageConsent: draft.canManageConsent,
  canManageRoutine: draft.canManageRoutine,
  canViewEvents: draft.canViewEvents,
  canViewConversation: draft.canViewConversation,
  canActivateDevice: draft.canActivateDevice,
  canRemoteCall: draft.canRemoteCall,
  receiveNotifications: draft.receiveNotifications,
  contactPriority: draft.contactPriority
    ? Number(draft.contactPriority)
    : null,
  status: draft.status,
  version,
  currentPassword,
});
