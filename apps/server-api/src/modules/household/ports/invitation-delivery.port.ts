export interface HouseholdInvitationDelivery {
  invitationId: string;
  householdId: string;
  householdName: string;
  targetEmail: string;
  roleCode: string;
  rawToken: string;
  expiresAt: Date;
}

export interface InvitationDeliveryPort {
  sendHouseholdInvitation(
    invitation: HouseholdInvitationDelivery,
  ): Promise<void>;
}
