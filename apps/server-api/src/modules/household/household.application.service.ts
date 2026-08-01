import { BadRequestException, Inject, Injectable } from '@nestjs/common';

import type { Prisma } from '../../infrastructure/database/generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { newUlid } from '../identity/domain/ulid';
import { VerifiedEmailPolicy } from '../identity/domain/verified-email.policy';
import type { HouseholdSecurityConfig } from './config/household-security.config';
import { InvitationTokenService } from './crypto/invitation-token.service';
import { HouseholdAccessPolicy } from './domain/household-access.policy';
import {
  ACTIVE_AUTHORITY_STATUS,
  ACTIVE_HOUSEHOLD_STATUS,
  ACTIVE_MEMBER_STATUS,
  ACTIVE_RECIPIENT_STATUS,
  HOUSEHOLD_CLOCK,
  HOUSEHOLD_ROLE_CODES,
  HOUSEHOLD_ROLE_SCOPE,
  HOUSEHOLD_SECURITY_CONFIG,
  INVITATION_DELIVERY_PORT,
  LEFT_MEMBER_STATUS,
  REVOKED_AUTHORITY_STATUS,
  type HouseholdRoleCode,
} from './household.constants';
import {
  HouseholdAccessDeniedException,
  HouseholdMemberNotFoundException,
  HouseholdNotFoundException,
  HouseholdRoleConfigurationException,
  InvalidHouseholdRoleException,
  InvalidInvitationException,
  LastOwnerException,
  RecipientAccessDeniedException,
  RecipientNotFoundException,
  VersionConflictException,
} from './household.errors';
import type {
  AuthPrincipal,
  AuthorizationDecision,
  CareAuthorityView,
  CareRecipientView,
  CreateCareRecipientCommand,
  CreateHouseholdCommand,
  CreateInvitationCommand,
  HouseholdAction,
  HouseholdInvitationView,
  HouseholdMemberView,
  HouseholdView,
  PutCareAuthorityCommand,
  RecipientAction,
  UpdateCareRecipientCommand,
  UpdateHouseholdCommand,
  UpdateHouseholdMemberCommand,
} from './household.types';
import type { HouseholdClock } from './ports/household-clock.port';
import type { InvitationDeliveryPort } from './ports/invitation-delivery.port';
import { RemoteMediaSecurityCoordinator } from '../realtime-communication/remote-media-security.coordinator';

type TransactionClient = Prisma.TransactionClient;

const SERIALIZABLE_RETRY_LIMIT = 3;

interface HouseholdRecord {
  id: string;
  name: string;
  timezone: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

interface MemberRecord {
  id: string;
  householdId: string;
  userId: string;
  status: string;
  joinedAt: Date | null;
  version: number;
  user: { displayName: string };
  roles: Array<{ role: { code: string } }>;
}

interface RecipientRecord {
  id: string;
  householdId: string;
  name: string;
  preferredName: string;
  birthDate: Date | null;
  timezone: string;
  homeLabel: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

interface AuthorityRecord {
  id: string;
  householdId: string;
  recipientId: string;
  householdMemberId: string;
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
  member: { userId: string; user: { displayName: string } };
}

@Injectable()
export class HouseholdApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly verifiedEmailPolicy: VerifiedEmailPolicy,
    private readonly policy: HouseholdAccessPolicy,
    private readonly invitationTokens: InvitationTokenService,
    @Inject(INVITATION_DELIVERY_PORT)
    private readonly invitationDelivery: InvitationDeliveryPort,
    @Inject(HOUSEHOLD_CLOCK) private readonly clock: HouseholdClock,
    @Inject(HOUSEHOLD_SECURITY_CONFIG)
    private readonly securityConfig: HouseholdSecurityConfig,
    private readonly mediaSecurity: RemoteMediaSecurityCoordinator,
  ) {}

  async listHouseholds(principal: AuthPrincipal): Promise<HouseholdView[]> {
    const memberships = await this.prisma.householdMember.findMany({
      where: {
        userId: principal.userId,
        status: ACTIVE_MEMBER_STATUS,
        household: { status: ACTIVE_HOUSEHOLD_STATUS },
      },
      select: {
        household: {
          select: {
            id: true,
            name: true,
            timezone: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            version: true,
          },
        },
        roles: {
          where: { role: { scope: HOUSEHOLD_ROLE_SCOPE } },
          select: { role: { select: { code: true } } },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return memberships.map((membership) =>
      this.toHouseholdView(
        membership.household,
        this.roleCodes(membership.roles),
      ),
    );
  }

  async createHousehold(
    principal: AuthPrincipal,
    command: CreateHouseholdCommand,
  ): Promise<HouseholdView> {
    await this.verifiedEmailPolicy.requireVerifiedEmail(
      this.prisma,
      principal.userId,
    );
    const now = this.clock.now();

    const created = await this.prisma.$transaction(async (transaction) => {
      const ownerRole = await this.requireRole(transaction, 'OWNER');
      const household = await transaction.household.create({
        data: {
          id: newUlid(now.getTime()),
          name: command.name.trim(),
          timezone: command.timezone ?? 'Asia/Shanghai',
          status: ACTIVE_HOUSEHOLD_STATUS,
          createdByUserId: principal.userId,
        },
      });
      const ownerMember = await transaction.householdMember.create({
        data: {
          id: newUlid(now.getTime()),
          householdId: household.id,
          userId: principal.userId,
          status: ACTIVE_MEMBER_STATUS,
          joinedAt: now,
        },
      });
      await transaction.householdMemberRole.create({
        data: { memberId: ownerMember.id, roleId: ownerRole.id },
      });

      return household;
    });

    return this.toHouseholdView(created, ['OWNER']);
  }

  async getHousehold(
    principal: AuthPrincipal,
    householdId: string,
  ): Promise<HouseholdView> {
    const member = await this.policy.requireHouseholdAction(
      this.prisma,
      principal.userId,
      householdId,
      'VIEW_HOUSEHOLD',
    );
    const household = await this.prisma.household.findUnique({
      where: { id: householdId },
    });
    if (!household) {
      throw new HouseholdNotFoundException();
    }

    return this.toHouseholdView(
      household,
      this.checkedRoleCodes(member.roleCodes),
    );
  }

  async updateHousehold(
    principal: AuthPrincipal,
    householdId: string,
    command: UpdateHouseholdCommand,
  ): Promise<HouseholdView> {
    const result = await this.serializable(async (transaction) => {
      const member = await this.policy.requireHouseholdAction(
        transaction,
        principal.userId,
        householdId,
        'MANAGE_HOUSEHOLD',
      );
      const updated = await transaction.household.updateMany({
        where: { id: householdId, version: command.version },
        data: {
          ...(command.name === undefined ? {} : { name: command.name.trim() }),
          ...(command.timezone === undefined
            ? {}
            : { timezone: command.timezone }),
          version: { increment: 1 },
        },
      });
      this.requireUpdated(updated.count);
      const household = await transaction.household.findUnique({
        where: { id: householdId },
      });
      return {
        household,
        roleCodes: this.checkedRoleCodes(member.roleCodes),
      };
    });
    if (!result.household) {
      throw new HouseholdNotFoundException();
    }
    return this.toHouseholdView(result.household, result.roleCodes);
  }

  async listMembers(
    principal: AuthPrincipal,
    householdId: string,
  ): Promise<HouseholdMemberView[]> {
    await this.policy.requireHouseholdAction(
      this.prisma,
      principal.userId,
      householdId,
      'VIEW_HOUSEHOLD',
    );
    const members = await this.prisma.householdMember.findMany({
      where: { householdId, status: ACTIVE_MEMBER_STATUS },
      select: this.memberSelection(),
      orderBy: { joinedAt: 'asc' },
    });

    return members.map((member) => this.toMemberView(member));
  }

  async updateMember(
    principal: AuthPrincipal,
    householdId: string,
    memberId: string,
    command: UpdateHouseholdMemberCommand,
  ): Promise<HouseholdMemberView> {
    const roleCodes = this.checkedRoleCodes(command.roleCodes);
    if (roleCodes.length === 0) {
      throw new InvalidHouseholdRoleException();
    }

    const result = await this.serializable(async (transaction) => {
      await this.policy.requireHouseholdAction(
        transaction,
        principal.userId,
        householdId,
        'MANAGE_MEMBERS',
      );
      const target = await transaction.householdMember.findFirst({
        where: { id: memberId, householdId, status: ACTIVE_MEMBER_STATUS },
        select: this.memberSelection(),
      });
      if (!target) {
        throw new HouseholdAccessDeniedException();
      }
      if (target.version !== command.version) {
        throw new VersionConflictException();
      }

      const currentlyOwner = this.roleCodes(target.roles).includes('OWNER');
      if (currentlyOwner && !roleCodes.includes('OWNER')) {
        await this.assertNotLastOwner(transaction, householdId);
      }
      const roles = await this.requireRoles(transaction, roleCodes);
      const updated = await transaction.householdMember.updateMany({
        where: {
          id: memberId,
          householdId,
          status: ACTIVE_MEMBER_STATUS,
          version: command.version,
        },
        data: { version: { increment: 1 } },
      });
      this.requireUpdated(updated.count);
      await transaction.householdMemberRole.deleteMany({ where: { memberId } });
      await transaction.householdMemberRole.createMany({
        data: roles.map((role) => ({ memberId, roleId: role.id })),
      });

      const member = await transaction.householdMember.findFirst({
        where: { id: memberId, householdId },
        select: this.memberSelection(),
      });
      if (!member) {
        throw new HouseholdMemberNotFoundException();
      }
      await this.mediaSecurity.markMemberRevoked(
        transaction,
        householdId,
        memberId,
        'MEMBER_AUTHORITY_CHANGED',
        this.clock.now(),
      );
      return this.toMemberView(member);
    });
    await this.mediaSecurity.cleanupPendingForMember(householdId, memberId);
    return result;
  }

  async removeMember(
    principal: AuthPrincipal,
    householdId: string,
    memberId: string,
    version: number,
  ): Promise<void> {
    await this.serializable(async (transaction) => {
      const removedAt = this.clock.now();
      await this.policy.requireHouseholdAction(
        transaction,
        principal.userId,
        householdId,
        'MANAGE_MEMBERS',
      );
      const target = await transaction.householdMember.findFirst({
        where: { id: memberId, householdId, status: ACTIVE_MEMBER_STATUS },
        select: {
          version: true,
          roles: {
            where: { role: { scope: HOUSEHOLD_ROLE_SCOPE } },
            select: { role: { select: { code: true } } },
          },
        },
      });
      if (!target) {
        throw new HouseholdAccessDeniedException();
      }
      if (target.version !== version) {
        throw new VersionConflictException();
      }
      if (this.roleCodes(target.roles).includes('OWNER')) {
        await this.assertNotLastOwner(transaction, householdId);
      }

      const removed = await transaction.householdMember.updateMany({
        where: {
          id: memberId,
          householdId,
          status: ACTIVE_MEMBER_STATUS,
          version,
        },
        data: {
          status: LEFT_MEMBER_STATUS,
          leftAt: removedAt,
          version: { increment: 1 },
        },
      });
      this.requireUpdated(removed.count);
      await transaction.householdMemberRole.deleteMany({ where: { memberId } });
      await transaction.householdInvitation.updateMany({
        where: {
          householdId,
          issuedByMemberId: memberId,
          acceptedAt: null,
          revokedAt: null,
        },
        data: { revokedAt: removedAt },
      });
      await transaction.recipientMember.updateMany({
        where: { householdId, householdMemberId: memberId },
        data: {
          status: REVOKED_AUTHORITY_STATUS,
          version: { increment: 1 },
        },
      });
      await this.mediaSecurity.markMemberRevoked(
        transaction,
        householdId,
        memberId,
        'HOUSEHOLD_MEMBER_REMOVED',
        removedAt,
      );
    });
    await this.mediaSecurity.cleanupPendingForMember(householdId, memberId);
  }

  async createInvitation(
    principal: AuthPrincipal,
    householdId: string,
    command: CreateInvitationCommand,
  ): Promise<HouseholdInvitationView> {
    const roleCode = this.checkedRoleCodes([command.roleCode])[0];
    const now = this.clock.now();
    const expiresInSeconds =
      command.expiresInSeconds ?? this.securityConfig.invitationTtlSeconds;
    if (
      !Number.isInteger(expiresInSeconds) ||
      expiresInSeconds < 15 * 60 ||
      expiresInSeconds > 7 * 24 * 60 * 60
    ) {
      throw new BadRequestException({
        code: 'INVALID_INVITATION_EXPIRY',
        message: '邀请有效期无效',
      });
    }
    const expiresAt = new Date(now.getTime() + expiresInSeconds * 1_000);
    const targetEmail = this.normalizeEmail(command.targetEmail);
    const issuedToken = this.invitationTokens.issue();

    const created = await this.serializable(async (transaction) => {
      const issuer = await this.policy.requireHouseholdAction(
        transaction,
        principal.userId,
        householdId,
        'MANAGE_MEMBERS',
      );
      const household = await transaction.household.findUnique({
        where: { id: householdId },
        select: { name: true },
      });
      if (!household) {
        throw new HouseholdNotFoundException();
      }
      const role = await this.requireRole(transaction, roleCode);
      const invitation = await transaction.householdInvitation.create({
        data: {
          id: newUlid(now.getTime()),
          householdId,
          targetEmailNormalized: targetEmail,
          roleId: role.id,
          tokenHash: issuedToken.tokenHash,
          issuedByMemberId: issuer.id,
          expiresAt,
        },
      });
      return { invitation, householdName: household.name };
    });

    await this.invitationDelivery.sendHouseholdInvitation({
      invitationId: created.invitation.id,
      householdId,
      householdName: created.householdName,
      targetEmail,
      roleCode,
      rawToken: issuedToken.rawToken,
      expiresAt,
    });

    return {
      id: created.invitation.id,
      householdId,
      targetEmail,
      roleCode,
      expiresAt: expiresAt.toISOString(),
      createdAt: created.invitation.createdAt.toISOString(),
    };
  }

  async acceptInvitation(
    principal: AuthPrincipal,
    rawToken: string,
  ): Promise<HouseholdMemberView> {
    if (!/^[A-Za-z0-9_-]{40,128}$/.test(rawToken)) {
      throw new InvalidInvitationException();
    }
    const now = this.clock.now();
    const tokenHash = this.invitationTokens.hash(rawToken);

    const result = await this.serializable(async (transaction) => {
      const invitation = await transaction.householdInvitation.findUnique({
        where: { tokenHash },
        include: {
          role: true,
          household: { select: { status: true } },
        },
      });
      if (
        !invitation ||
        invitation.acceptedAt ||
        invitation.revokedAt ||
        invitation.expiresAt <= now ||
        invitation.household.status !== ACTIVE_HOUSEHOLD_STATUS ||
        invitation.role.scope !== HOUSEHOLD_ROLE_SCOPE ||
        !this.isRoleCode(invitation.role.code)
      ) {
        throw new InvalidInvitationException();
      }

      const matchingIdentity = await transaction.loginIdentity.findFirst({
        where: {
          userId: principal.userId,
          type: 'EMAIL',
          normalizedValue: invitation.targetEmailNormalized,
          verifiedAt: { not: null },
        },
        select: { id: true },
      });
      if (!matchingIdentity) {
        throw new InvalidInvitationException();
      }

      const consumed = await transaction.householdInvitation.updateMany({
        where: {
          id: invitation.id,
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { acceptedAt: now },
      });
      if (consumed.count !== 1) {
        throw new InvalidInvitationException();
      }

      const existing = await transaction.householdMember.findUnique({
        where: {
          householdId_userId: {
            householdId: invitation.householdId,
            userId: principal.userId,
          },
        },
        select: { id: true, status: true },
      });
      const memberId = existing?.id ?? newUlid(now.getTime());
      if (existing) {
        await transaction.householdMember.update({
          where: { id: existing.id },
          data: {
            status: ACTIVE_MEMBER_STATUS,
            joinedAt:
              existing.status === ACTIVE_MEMBER_STATUS ? undefined : now,
            leftAt: null,
            version: { increment: 1 },
          },
        });
      } else {
        await transaction.householdMember.create({
          data: {
            id: memberId,
            householdId: invitation.householdId,
            userId: principal.userId,
            status: ACTIVE_MEMBER_STATUS,
            invitedByMemberId: invitation.issuedByMemberId,
            joinedAt: now,
          },
        });
      }
      await transaction.householdMemberRole.upsert({
        where: {
          memberId_roleId: { memberId, roleId: invitation.roleId },
        },
        create: { memberId, roleId: invitation.roleId },
        update: {},
      });

      const member = await transaction.householdMember.findFirst({
        where: { id: memberId, householdId: invitation.householdId },
        select: this.memberSelection(),
      });
      if (!member) {
        throw new HouseholdMemberNotFoundException();
      }
      return this.toMemberView(member);
    });
    return result;
  }

  async listCareRecipients(
    principal: AuthPrincipal,
    householdId: string,
  ): Promise<CareRecipientView[]> {
    const member = await this.policy.requireHouseholdAction(
      this.prisma,
      principal.userId,
      householdId,
      'VIEW_HOUSEHOLD',
    );
    const owner = member.roleCodes.includes('OWNER');
    const recipients = await this.prisma.careRecipient.findMany({
      where: {
        householdId,
        status: ACTIVE_RECIPIENT_STATUS,
        deletedAt: null,
        ...(owner
          ? {}
          : {
              memberAuthorities: {
                some: {
                  householdMemberId: member.id,
                  status: ACTIVE_AUTHORITY_STATUS,
                },
              },
            }),
      },
      orderBy: { createdAt: 'asc' },
    });

    return recipients.map((recipient) => this.toRecipientView(recipient));
  }

  async createCareRecipient(
    principal: AuthPrincipal,
    householdId: string,
    command: CreateCareRecipientCommand,
  ): Promise<CareRecipientView> {
    const now = this.clock.now();

    const recipient = await this.serializable(async (transaction) => {
      const creator = await this.policy.requireHouseholdAction(
        transaction,
        principal.userId,
        householdId,
        'MANAGE_HOUSEHOLD',
      );
      const created = await transaction.careRecipient.create({
        data: {
          id: newUlid(now.getTime()),
          householdId,
          name: command.name.trim(),
          preferredName: command.preferredName?.trim() ?? command.name.trim(),
          birthDate: command.birthDate
            ? this.parseDateOnly(command.birthDate)
            : null,
          timezone: command.timezone ?? 'Asia/Shanghai',
          homeLabel: command.homeLabel?.trim() ?? null,
          status: ACTIVE_RECIPIENT_STATUS,
        },
      });
      await transaction.recipientMember.create({
        data: {
          id: newUlid(now.getTime()),
          householdId,
          recipientId: created.id,
          householdMemberId: creator.id,
          accessLevel: 'FULL',
          canManageProfile: true,
          canManageConsent: true,
          canManageRoutine: true,
          canViewEvents: true,
          canViewConversation: true,
          canActivateDevice: true,
          canRemoteCall: true,
          receiveNotifications: true,
          contactPriority: 1,
          status: ACTIVE_AUTHORITY_STATUS,
        },
      });
      return created;
    });

    return this.toRecipientView(recipient);
  }

  async getCareRecipient(
    principal: AuthPrincipal,
    householdId: string,
    recipientId: string,
  ): Promise<CareRecipientView> {
    await this.policy.requireRecipientAction(
      this.prisma,
      principal.userId,
      householdId,
      recipientId,
      'VIEW_RECIPIENT',
    );
    const recipient = await this.prisma.careRecipient.findFirst({
      where: {
        id: recipientId,
        householdId,
        status: ACTIVE_RECIPIENT_STATUS,
        deletedAt: null,
      },
    });
    if (!recipient) {
      throw new RecipientAccessDeniedException();
    }
    return this.toRecipientView(recipient);
  }

  async updateCareRecipient(
    principal: AuthPrincipal,
    householdId: string,
    recipientId: string,
    command: UpdateCareRecipientCommand,
  ): Promise<CareRecipientView> {
    const recipient = await this.serializable(async (transaction) => {
      await this.policy.requireRecipientAction(
        transaction,
        principal.userId,
        householdId,
        recipientId,
        'MANAGE_RECIPIENT',
      );
      const updated = await transaction.careRecipient.updateMany({
        where: {
          id: recipientId,
          householdId,
          status: ACTIVE_RECIPIENT_STATUS,
          deletedAt: null,
          version: command.version,
        },
        data: {
          ...(command.name === undefined ? {} : { name: command.name.trim() }),
          ...(command.preferredName === undefined
            ? {}
            : { preferredName: command.preferredName.trim() }),
          ...(command.birthDate === undefined
            ? {}
            : {
                birthDate:
                  command.birthDate === null
                    ? null
                    : this.parseDateOnly(command.birthDate),
              }),
          ...(command.timezone === undefined
            ? {}
            : { timezone: command.timezone }),
          ...(command.homeLabel === undefined
            ? {}
            : { homeLabel: command.homeLabel?.trim() ?? null }),
          version: { increment: 1 },
        },
      });
      this.requireUpdated(updated.count);
      return transaction.careRecipient.findFirst({
        where: { id: recipientId, householdId, deletedAt: null },
      });
    });
    if (!recipient) {
      throw new RecipientNotFoundException();
    }
    return this.toRecipientView(recipient);
  }

  async getCareAuthorities(
    principal: AuthPrincipal,
    householdId: string,
    recipientId: string,
  ): Promise<CareAuthorityView[]> {
    await this.policy.requireRecipientAction(
      this.prisma,
      principal.userId,
      householdId,
      recipientId,
      'MANAGE_AUTHORITIES',
    );
    await this.requireRecipientInHousehold(
      this.prisma,
      householdId,
      recipientId,
    );
    const authorities = await this.prisma.recipientMember.findMany({
      where: { householdId, recipientId },
      select: this.authoritySelection(),
      orderBy: [{ contactPriority: 'asc' }, { createdAt: 'asc' }],
    });
    return authorities.map((authority) => this.toAuthorityView(authority));
  }

  async putCareAuthority(
    principal: AuthPrincipal,
    householdId: string,
    recipientId: string,
    memberId: string,
    command: PutCareAuthorityCommand,
  ): Promise<CareAuthorityView> {
    const result = await this.serializable(async (transaction) => {
      await this.policy.requireRecipientAction(
        transaction,
        principal.userId,
        householdId,
        recipientId,
        'MANAGE_AUTHORITIES',
      );
      await this.requireRecipientInHousehold(
        transaction,
        householdId,
        recipientId,
      );
      const targetMember = await transaction.householdMember.findFirst({
        where: { id: memberId, householdId, status: ACTIVE_MEMBER_STATUS },
        select: { id: true },
      });
      if (!targetMember) {
        throw new HouseholdAccessDeniedException();
      }

      const existing = await transaction.recipientMember.findUnique({
        where: {
          recipientId_householdMemberId: {
            recipientId,
            householdMemberId: memberId,
          },
        },
        select: { id: true, version: true },
      });
      const data = {
        relationshipLabel: command.relationshipLabel?.trim() ?? null,
        accessLevel: command.accessLevel,
        canManageProfile: command.canManageProfile,
        canManageConsent: command.canManageConsent,
        canManageRoutine: command.canManageRoutine,
        canViewEvents: command.canViewEvents,
        canViewConversation: command.canViewConversation,
        canActivateDevice: command.canActivateDevice,
        canRemoteCall: command.canRemoteCall,
        receiveNotifications: command.receiveNotifications,
        contactPriority: command.contactPriority ?? null,
        status: command.status,
      };

      let authorityId: string;
      if (existing) {
        if (
          command.version === undefined ||
          command.version !== existing.version
        ) {
          throw new VersionConflictException();
        }
        const updated = await transaction.recipientMember.updateMany({
          where: {
            id: existing.id,
            householdId,
            recipientId,
            version: command.version,
          },
          data: { ...data, version: { increment: 1 } },
        });
        this.requireUpdated(updated.count);
        authorityId = existing.id;
      } else {
        if (command.version !== undefined && command.version !== 0) {
          throw new VersionConflictException();
        }
        authorityId = newUlid(this.clock.now().getTime());
        await transaction.recipientMember.create({
          data: {
            id: authorityId,
            householdId,
            recipientId,
            householdMemberId: memberId,
            ...data,
          },
        });
      }

      const authority = await transaction.recipientMember.findUnique({
        where: { id: authorityId },
        select: this.authoritySelection(),
      });
      if (!authority) {
        throw new RecipientNotFoundException();
      }
      if (command.status !== 'ACTIVE' || !command.canRemoteCall) {
        await this.mediaSecurity.markMemberRevoked(
          transaction,
          householdId,
          memberId,
          'RECIPIENT_REMOTE_AUTHORITY_REVOKED',
          this.clock.now(),
        );
      }
      return this.toAuthorityView(authority);
    });
    if (command.status !== 'ACTIVE' || !command.canRemoteCall) {
      await this.mediaSecurity.cleanupPendingForMember(householdId, memberId);
    }
    return result;
  }

  async authorizeHouseholdAction(
    principal: AuthPrincipal,
    householdId: string,
    action: HouseholdAction,
  ): Promise<AuthorizationDecision> {
    try {
      await this.policy.requireHouseholdAction(
        this.prisma,
        principal.userId,
        householdId,
        action,
      );
      return { allowed: true };
    } catch (error) {
      if (error instanceof HouseholdAccessDeniedException) {
        return { allowed: false, reason: 'HOUSEHOLD_ACCESS_DENIED' };
      }
      throw error;
    }
  }

  async authorizeRecipientAction(
    principal: AuthPrincipal,
    householdId: string,
    recipientId: string,
    action: RecipientAction,
  ): Promise<AuthorizationDecision> {
    try {
      await this.policy.requireRecipientAction(
        this.prisma,
        principal.userId,
        householdId,
        recipientId,
        action,
      );
      return { allowed: true };
    } catch (error) {
      if (error instanceof HouseholdAccessDeniedException) {
        return { allowed: false, reason: 'HOUSEHOLD_ACCESS_DENIED' };
      }
      if (error instanceof RecipientAccessDeniedException) {
        return { allowed: false, reason: 'RECIPIENT_ACCESS_DENIED' };
      }
      throw error;
    }
  }

  private async serializable<T>(
    work: (transaction: TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: 'Serializable',
        });
      } catch (error) {
        if (attempt === SERIALIZABLE_RETRY_LIMIT || !isRetryable(error)) {
          throw error;
        }
      }
    }
    throw new Error('Serializable household transaction exhausted');
  }

  private async requireRole(
    transaction: TransactionClient,
    code: HouseholdRoleCode,
  ): Promise<{ id: string; code: string }> {
    const role = await transaction.role.findFirst({
      where: { scope: HOUSEHOLD_ROLE_SCOPE, code },
      select: { id: true, code: true },
    });
    if (!role) {
      throw new HouseholdRoleConfigurationException();
    }
    return role;
  }

  private async requireRoles(
    transaction: TransactionClient,
    codes: HouseholdRoleCode[],
  ): Promise<Array<{ id: string; code: string }>> {
    const roles = await transaction.role.findMany({
      where: { scope: HOUSEHOLD_ROLE_SCOPE, code: { in: codes } },
      select: { id: true, code: true },
    });
    if (roles.length !== codes.length) {
      throw new HouseholdRoleConfigurationException();
    }
    return roles;
  }

  private async assertNotLastOwner(
    transaction: TransactionClient,
    householdId: string,
  ): Promise<void> {
    const ownerCount = await transaction.householdMember.count({
      where: {
        householdId,
        status: ACTIVE_MEMBER_STATUS,
        roles: {
          some: {
            role: { scope: HOUSEHOLD_ROLE_SCOPE, code: 'OWNER' },
          },
        },
      },
    });
    if (ownerCount <= 1) {
      throw new LastOwnerException();
    }
  }

  private async requireRecipientInHousehold(
    client: Pick<TransactionClient, 'careRecipient'>,
    householdId: string,
    recipientId: string,
  ): Promise<void> {
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
  }

  private memberSelection() {
    return {
      id: true,
      householdId: true,
      userId: true,
      status: true,
      joinedAt: true,
      version: true,
      user: { select: { displayName: true } },
      roles: {
        where: { role: { scope: HOUSEHOLD_ROLE_SCOPE } },
        select: { role: { select: { code: true } } },
      },
    } as const;
  }

  private authoritySelection() {
    return {
      id: true,
      householdId: true,
      recipientId: true,
      householdMemberId: true,
      relationshipLabel: true,
      accessLevel: true,
      canManageProfile: true,
      canManageConsent: true,
      canManageRoutine: true,
      canViewEvents: true,
      canViewConversation: true,
      canActivateDevice: true,
      canRemoteCall: true,
      receiveNotifications: true,
      contactPriority: true,
      status: true,
      version: true,
      member: {
        select: {
          userId: true,
          user: { select: { displayName: true } },
        },
      },
    } as const;
  }

  private toHouseholdView(
    household: HouseholdRecord,
    roleCodes: HouseholdRoleCode[],
  ): HouseholdView {
    return {
      id: household.id,
      name: household.name,
      timezone: household.timezone,
      status: household.status,
      roleCodes,
      createdAt: household.createdAt.toISOString(),
      updatedAt: household.updatedAt.toISOString(),
      version: household.version,
    };
  }

  private toMemberView(member: MemberRecord): HouseholdMemberView {
    return {
      id: member.id,
      householdId: member.householdId,
      userId: member.userId,
      displayName: member.user.displayName,
      status: member.status,
      roleCodes: this.roleCodes(member.roles),
      joinedAt: member.joinedAt?.toISOString() ?? null,
      version: member.version,
    };
  }

  private toRecipientView(recipient: RecipientRecord): CareRecipientView {
    return {
      id: recipient.id,
      householdId: recipient.householdId,
      name: recipient.name,
      preferredName: recipient.preferredName,
      birthDate: recipient.birthDate
        ? recipient.birthDate.toISOString().slice(0, 10)
        : null,
      timezone: recipient.timezone,
      homeLabel: recipient.homeLabel,
      status: recipient.status,
      createdAt: recipient.createdAt.toISOString(),
      updatedAt: recipient.updatedAt.toISOString(),
      version: recipient.version,
    };
  }

  private toAuthorityView(authority: AuthorityRecord): CareAuthorityView {
    return {
      id: authority.id,
      householdId: authority.householdId,
      recipientId: authority.recipientId,
      memberId: authority.householdMemberId,
      userId: authority.member.userId,
      displayName: authority.member.user.displayName,
      relationshipLabel: authority.relationshipLabel,
      accessLevel: authority.accessLevel,
      canManageProfile: authority.canManageProfile,
      canManageConsent: authority.canManageConsent,
      canManageRoutine: authority.canManageRoutine,
      canViewEvents: authority.canViewEvents,
      canViewConversation: authority.canViewConversation,
      canActivateDevice: authority.canActivateDevice,
      canRemoteCall: authority.canRemoteCall,
      receiveNotifications: authority.receiveNotifications,
      contactPriority: authority.contactPriority,
      status: authority.status,
      version: authority.version,
    };
  }

  private roleCodes(
    assignments: Array<{ role: { code: string } }>,
  ): HouseholdRoleCode[] {
    return this.checkedRoleCodes(assignments.map((item) => item.role.code));
  }

  private checkedRoleCodes(codes: readonly string[]): HouseholdRoleCode[] {
    const unique = [...new Set(codes)];
    if (!unique.every((code) => this.isRoleCode(code))) {
      throw new InvalidHouseholdRoleException();
    }
    return unique;
  }

  private isRoleCode(code: string): code is HouseholdRoleCode {
    return (HOUSEHOLD_ROLE_CODES as readonly string[]).includes(code);
  }

  private requireUpdated(count: number): void {
    if (count !== 1) {
      throw new VersionConflictException();
    }
  }

  private normalizeEmail(value: string): string {
    return value.trim().normalize('NFKC').toLocaleLowerCase('en-US');
  }

  private parseDateOnly(value: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException({
        code: 'INVALID_BIRTH_DATE',
        message: '出生日期格式无效',
      });
    }
    return date;
  }
}

function isRetryable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2034'
  );
}
