import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../infrastructure/database/generated/prisma/client';
import {
  ACTIVE_AUTHORITY_STATUS,
  ACTIVE_MEMBER_STATUS,
  ACTIVE_RECIPIENT_STATUS,
  HOUSEHOLD_ROLE_SCOPE,
} from '../household.constants';
import {
  HouseholdAccessDeniedException,
  RecipientAccessDeniedException,
} from '../household.errors';
import type { HouseholdAction, RecipientAction } from '../household.types';

type AccessDataClient = Pick<
  Prisma.TransactionClient,
  'householdMember' | 'recipientMember' | 'careRecipient'
>;

export interface ActiveHouseholdMember {
  id: string;
  householdId: string;
  userId: string;
  roleCodes: string[];
}

interface RecipientAuthorityRecord {
  canManageProfile: boolean;
  canManageConsent: boolean;
  canManageRoutine: boolean;
  canViewEvents: boolean;
  canViewConversation: boolean;
  canActivateDevice: boolean;
  canRemoteCall: boolean;
}

@Injectable()
export class HouseholdAccessPolicy {
  async requireHouseholdAction(
    client: AccessDataClient,
    userId: string,
    householdId: string,
    action: HouseholdAction,
  ): Promise<ActiveHouseholdMember> {
    const member = await this.findActiveMember(client, userId, householdId);
    if (!member || !this.allowsHouseholdAction(member, action)) {
      throw new HouseholdAccessDeniedException();
    }

    return member;
  }

  async requireRecipientAction(
    client: AccessDataClient,
    userId: string,
    householdId: string,
    recipientId: string,
    action: RecipientAction,
  ): Promise<ActiveHouseholdMember> {
    const member = await this.findActiveMember(client, userId, householdId);
    if (!member) {
      throw new HouseholdAccessDeniedException();
    }

    const recipient = await client.careRecipient.findFirst({
      where: {
        id: recipientId,
        householdId,
        status: ACTIVE_RECIPIENT_STATUS,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!recipient) {
      throw new RecipientAccessDeniedException();
    }

    const owner = member.roleCodes.includes('OWNER');
    if (action === 'MANAGE_AUTHORITIES') {
      if (!owner) {
        throw new RecipientAccessDeniedException();
      }
      return member;
    }

    const authority = await client.recipientMember.findFirst({
      where: {
        householdId,
        recipientId,
        householdMemberId: member.id,
        status: ACTIVE_AUTHORITY_STATUS,
      },
      select: {
        canManageProfile: true,
        canManageConsent: true,
        canManageRoutine: true,
        canViewEvents: true,
        canViewConversation: true,
        canActivateDevice: true,
        canRemoteCall: true,
      },
    });

    if (!this.allowsRecipientAction(member, authority, action)) {
      throw new RecipientAccessDeniedException();
    }

    return member;
  }

  async findActiveMember(
    client: AccessDataClient,
    userId: string,
    householdId: string,
  ): Promise<ActiveHouseholdMember | null> {
    const member = await client.householdMember.findFirst({
      where: {
        householdId,
        userId,
        status: ACTIVE_MEMBER_STATUS,
        household: { status: 'ACTIVE' },
      },
      select: {
        id: true,
        householdId: true,
        userId: true,
        roles: {
          where: { role: { scope: HOUSEHOLD_ROLE_SCOPE } },
          select: { role: { select: { code: true } } },
        },
      },
    });

    if (!member) {
      return null;
    }

    return {
      id: member.id,
      householdId: member.householdId,
      userId: member.userId,
      roleCodes: member.roles.map((assignment) => assignment.role.code),
    };
  }

  private allowsHouseholdAction(
    member: ActiveHouseholdMember,
    action: HouseholdAction,
  ): boolean {
    if (action === 'VIEW_HOUSEHOLD') {
      return true;
    }
    return member.roleCodes.includes('OWNER');
  }

  private allowsRecipientAction(
    member: ActiveHouseholdMember,
    authority: RecipientAuthorityRecord | null,
    action: Exclude<RecipientAction, 'MANAGE_AUTHORITIES'>,
  ): boolean {
    if (member.roleCodes.includes('OWNER')) {
      // High-risk capabilities remain explicit Care Authority even for OWNER.
      if (
        action === 'REMOTE_CALL' ||
        action === 'ACTIVATE_DEVICE' ||
        action === 'VIEW_CONVERSATION' ||
        action === 'MANAGE_CONSENT'
      ) {
        return authority !== null && this.authorityAllows(authority, action);
      }
      return true;
    }

    if (!authority) {
      return false;
    }

    if (action === 'VIEW_RECIPIENT') {
      return (
        member.roleCodes.includes('CAREGIVER') ||
        member.roleCodes.includes('VIEWER')
      );
    }

    if (!member.roleCodes.includes('CAREGIVER')) {
      return false;
    }

    return this.authorityAllows(authority, action);
  }

  private authorityAllows(
    authority: RecipientAuthorityRecord,
    action: Exclude<RecipientAction, 'VIEW_RECIPIENT' | 'MANAGE_AUTHORITIES'>,
  ): boolean {
    switch (action) {
      case 'MANAGE_RECIPIENT':
        return authority.canManageProfile;
      case 'MANAGE_CONSENT':
        return authority.canManageConsent;
      case 'MANAGE_ROUTINE':
        return authority.canManageRoutine;
      case 'VIEW_EVENTS':
        return authority.canViewEvents;
      case 'VIEW_CONVERSATION':
        return authority.canViewConversation;
      case 'ACTIVATE_DEVICE':
        return authority.canActivateDevice;
      case 'REMOTE_CALL':
        return authority.canRemoteCall;
    }
  }
}
