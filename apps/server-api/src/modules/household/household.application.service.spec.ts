import { describe, expect, it, jest } from '@jest/globals';

import type { HouseholdSecurityConfig } from './config/household-security.config';
import { VerifiedEmailPolicy } from '../identity/domain/verified-email.policy';
import { EmailVerificationRequiredException } from '../identity/identity.errors';
import { InvitationTokenService } from './crypto/invitation-token.service';
import {
  HouseholdAccessDeniedException,
  InvalidInvitationException,
  LastOwnerException,
  VersionConflictException,
} from './household.errors';
import { HouseholdApplicationService } from './household.application.service';
import type { AuthPrincipal } from './household.types';
import type { HouseholdClock } from './ports/household-clock.port';
import { InMemoryInvitationDeliveryAdapter } from './testing/in-memory-invitation-delivery.adapter';

jest.mock('../../infrastructure/database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const now = new Date('2026-08-01T00:00:00.000Z');
const principal: AuthPrincipal = {
  kind: 'USER',
  userId: '01JUSER0000000000000000000',
  sessionId: '01JSESSION00000000000000000',
  tokenId: '01JTOKEN0000000000000000000',
  status: 'ACTIVE',
};
const config: HouseholdSecurityConfig = {
  environment: 'test',
  invitationTokenPepper: Buffer.from('h'.repeat(48)),
  invitationTtlSeconds: 3600,
};

type AsyncMock = jest.Mock<(...arguments_: unknown[]) => Promise<unknown>>;

function asyncMock(): AsyncMock {
  return jest.fn<(...arguments_: unknown[]) => Promise<unknown>>();
}

function makeHarness() {
  const transaction = {
    household: {
      create: asyncMock(),
      findUnique: asyncMock(),
      updateMany: asyncMock(),
    },
    householdMember: {
      create: asyncMock(),
      findFirst: asyncMock(),
      findMany: asyncMock(),
      findUnique: asyncMock(),
      update: asyncMock(),
      updateMany: asyncMock(),
      count: asyncMock(),
    },
    householdMemberRole: {
      create: asyncMock(),
      createMany: asyncMock(),
      deleteMany: asyncMock(),
      upsert: asyncMock(),
    },
    householdInvitation: {
      create: asyncMock(),
      findUnique: asyncMock(),
      updateMany: asyncMock(),
    },
    careRecipient: {
      create: asyncMock(),
      findFirst: asyncMock(),
      findMany: asyncMock(),
      updateMany: asyncMock(),
    },
    recipientMember: {
      create: asyncMock(),
      findFirst: asyncMock(),
      findMany: asyncMock(),
      findUnique: asyncMock(),
      updateMany: asyncMock(),
    },
    loginIdentity: { findFirst: asyncMock() },
    role: { findFirst: asyncMock(), findMany: asyncMock() },
  };
  const prisma = {
    ...transaction,
    $transaction: jest.fn(
      async (work: (client: typeof transaction) => Promise<unknown>) =>
        work(transaction),
    ),
  };
  const policy = {
    requireHouseholdAction: asyncMock(),
    requireRecipientAction: asyncMock(),
  };
  const delivery = new InMemoryInvitationDeliveryAdapter();
  const clock: HouseholdClock = { now: () => now };
  const tokens = new InvitationTokenService(config);
  const verifiedEmailPolicy = new VerifiedEmailPolicy();
  const service = new HouseholdApplicationService(
    prisma as never,
    verifiedEmailPolicy,
    policy as never,
    tokens,
    delivery,
    clock,
    config,
  );

  return { service, prisma, transaction, policy, delivery, tokens };
}

function householdRecord() {
  return {
    id: '01JHOUSEHOLD00000000000000',
    name: '温暖之家',
    timezone: 'Asia/Shanghai',
    status: 'ACTIVE',
    createdByUserId: principal.userId,
    createdAt: now,
    updatedAt: now,
    version: 0,
  };
}

function recipientRecord() {
  return {
    id: '01JRECIPIENT0000000000000',
    householdId: '01JHOUSEHOLD00000000000000',
    linkedUserId: null,
    name: '李奶奶',
    preferredName: '李奶奶',
    birthDate: null,
    timezone: 'Asia/Shanghai',
    homeLabel: null,
    communicationNotesCiphertext: null,
    communicationNotesNonce: null,
    encryptionKeyId: null,
    status: 'ACTIVE',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    version: 0,
  };
}

function memberRecord() {
  return {
    id: 'accepted-member',
    householdId: householdRecord().id,
    userId: principal.userId,
    status: 'ACTIVE',
    joinedAt: now,
    version: 0,
    user: { displayName: '家属用户' },
    roles: [{ role: { code: 'CAREGIVER' } }],
  };
}

describe('HouseholdApplicationService invariants', () => {
  it('creates the household, ACTIVE owner member, and OWNER assignment atomically', async () => {
    const harness = makeHarness();
    harness.transaction.loginIdentity.findFirst.mockResolvedValue({
      id: 'verified-email',
    });
    harness.transaction.role.findFirst.mockResolvedValue({
      id: 'owner-role',
      code: 'OWNER',
    });
    harness.transaction.household.create.mockResolvedValue(householdRecord());
    harness.transaction.householdMember.create.mockResolvedValue({
      id: 'owner-member',
    });
    harness.transaction.householdMemberRole.create.mockResolvedValue({});

    await expect(
      harness.service.createHousehold(principal, { name: '温暖之家' }),
    ).resolves.toMatchObject({ roleCodes: ['OWNER'], version: 0 });

    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(harness.transaction.householdMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdId: householdRecord().id,
        userId: principal.userId,
        status: 'ACTIVE',
      }),
    });
    expect(harness.transaction.householdMemberRole.create).toHaveBeenCalledWith(
      {
        data: { memberId: 'owner-member', roleId: 'owner-role' },
      },
    );
  });

  it('rejects household creation until the account has a verified email', async () => {
    const harness = makeHarness();
    harness.transaction.loginIdentity.findFirst.mockResolvedValue(null);

    await expect(
      harness.service.createHousehold(principal, { name: '温暖之家' }),
    ).rejects.toBeInstanceOf(EmailVerificationRequiredException);

    expect(harness.transaction.loginIdentity.findFirst).toHaveBeenCalledWith({
      where: {
        userId: principal.userId,
        type: 'EMAIL',
        verifiedAt: { not: null },
      },
      select: { id: true },
    });
    expect(harness.prisma.$transaction).not.toHaveBeenCalled();
    expect(harness.transaction.household.create).not.toHaveBeenCalled();
  });

  it('rejects stale household mutations through the version predicate', async () => {
    const harness = makeHarness();
    harness.policy.requireHouseholdAction.mockResolvedValue({
      id: 'owner-member',
      roleCodes: ['OWNER'],
    });
    harness.transaction.household.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      harness.service.updateHousehold(principal, householdRecord().id, {
        name: '其他客户端已更新',
        version: 1,
      }),
    ).rejects.toBeInstanceOf(VersionConflictException);
    expect(harness.transaction.household.updateMany).toHaveBeenCalledWith({
      where: { id: householdRecord().id, version: 1 },
      data: {
        name: '其他客户端已更新',
        version: { increment: 1 },
      },
    });
  });

  it('rejects a member id from another household instead of mutating it', async () => {
    const harness = makeHarness();
    harness.policy.requireHouseholdAction.mockResolvedValue({
      id: 'owner-member',
      roleCodes: ['OWNER'],
    });
    harness.transaction.householdMember.findFirst.mockResolvedValue(null);

    await expect(
      harness.service.removeMember(
        principal,
        'household-a',
        'member-from-household-b',
        0,
      ),
    ).rejects.toBeInstanceOf(HouseholdAccessDeniedException);
    expect(
      harness.transaction.householdMember.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('does not remove the final active OWNER', async () => {
    const harness = makeHarness();
    harness.policy.requireHouseholdAction.mockResolvedValue({
      id: 'owner-member',
      roleCodes: ['OWNER'],
    });
    harness.transaction.householdMember.findFirst.mockResolvedValue({
      version: 3,
      roles: [{ role: { code: 'OWNER' } }],
    });
    harness.transaction.householdMember.count.mockResolvedValue(1);

    await expect(
      harness.service.removeMember(principal, 'household-1', 'owner-member', 3),
    ).rejects.toBeInstanceOf(LastOwnerException);
    expect(
      harness.transaction.householdMember.updateMany,
    ).not.toHaveBeenCalled();
  });

  it('revokes roles, Care Authorities, and outstanding invitations when a member leaves', async () => {
    const harness = makeHarness();
    harness.policy.requireHouseholdAction.mockResolvedValue({
      id: 'owner-member',
      roleCodes: ['OWNER'],
    });
    harness.transaction.householdMember.findFirst.mockResolvedValue({
      version: 2,
      roles: [{ role: { code: 'CAREGIVER' } }],
    });
    harness.transaction.householdMember.updateMany.mockResolvedValue({
      count: 1,
    });
    harness.transaction.householdMemberRole.deleteMany.mockResolvedValue({});
    harness.transaction.householdInvitation.updateMany.mockResolvedValue({});
    harness.transaction.recipientMember.updateMany.mockResolvedValue({});

    await expect(
      harness.service.removeMember(
        principal,
        'household-1',
        'caregiver-member',
        2,
      ),
    ).resolves.toBeUndefined();
    expect(
      harness.transaction.householdInvitation.updateMany,
    ).toHaveBeenCalledWith({
      where: {
        householdId: 'household-1',
        issuedByMemberId: 'caregiver-member',
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
    expect(harness.transaction.recipientMember.updateMany).toHaveBeenCalledWith(
      {
        where: {
          householdId: 'household-1',
          householdMemberId: 'caregiver-member',
        },
        data: { status: 'REVOKED', version: { increment: 1 } },
      },
    );
  });

  it('creates the Care Recipient and creator full Care Authority in one transaction', async () => {
    const harness = makeHarness();
    harness.policy.requireHouseholdAction.mockResolvedValue({
      id: 'owner-member',
      householdId: householdRecord().id,
      userId: principal.userId,
      roleCodes: ['OWNER'],
    });
    harness.transaction.careRecipient.create.mockResolvedValue(
      recipientRecord(),
    );
    harness.transaction.recipientMember.create.mockResolvedValue({});

    await expect(
      harness.service.createCareRecipient(principal, householdRecord().id, {
        name: '李奶奶',
      }),
    ).resolves.toMatchObject({ name: '李奶奶', version: 0 });

    expect(harness.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(harness.transaction.recipientMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        householdMemberId: 'owner-member',
        accessLevel: 'FULL',
        canManageProfile: true,
        canManageConsent: true,
        canManageRoutine: true,
        canViewEvents: true,
        canViewConversation: true,
        canActivateDevice: true,
        canRemoteCall: true,
        receiveNotifications: true,
        status: 'ACTIVE',
      }),
    });
  });

  it('delivers a raw invitation token through the port but never returns it', async () => {
    const harness = makeHarness();
    harness.policy.requireHouseholdAction.mockResolvedValue({
      id: 'owner-member',
      roleCodes: ['OWNER'],
    });
    harness.transaction.household.findUnique.mockResolvedValue({
      name: '温暖之家',
    });
    harness.transaction.role.findFirst.mockResolvedValue({
      id: 'caregiver-role',
      code: 'CAREGIVER',
    });
    harness.transaction.householdInvitation.create.mockImplementation(
      (input: unknown) =>
        Promise.resolve({
          id: 'invitation-1',
          createdAt: now,
          ...(input as { data: object }).data,
        }),
    );

    const result = await harness.service.createInvitation(
      principal,
      householdRecord().id,
      {
        targetEmail: 'Family@Example.com',
        roleCode: 'CAREGIVER',
      },
    );

    expect(result).not.toHaveProperty('rawToken');
    expect(result).not.toHaveProperty('tokenHash');
    expect(harness.delivery.sent).toHaveLength(1);
    expect(harness.delivery.sent[0]).toEqual(
      expect.objectContaining({
        targetEmail: 'family@example.com',
        rawToken: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
      }),
    );
    const persisted = harness.transaction.householdInvitation.create.mock
      .calls[0][0] as { data: { tokenHash: Uint8Array } };
    expect(persisted.data.tokenHash).toBeInstanceOf(Uint8Array);
    expect(JSON.stringify(persisted.data)).not.toContain(
      harness.delivery.sent[0].rawToken,
    );
  });

  it('accepts an invitation only for the verified target email and consumes it atomically', async () => {
    const harness = makeHarness();
    const issued = harness.tokens.issue();
    harness.transaction.householdInvitation.findUnique.mockResolvedValue({
      id: 'invitation-1',
      householdId: householdRecord().id,
      targetEmailNormalized: 'family@example.com',
      roleId: 'caregiver-role',
      issuedByMemberId: 'owner-member',
      acceptedAt: null,
      revokedAt: null,
      expiresAt: new Date('2026-08-02T00:00:00.000Z'),
      household: { status: 'ACTIVE' },
      role: { id: 'caregiver-role', scope: 'HOUSEHOLD', code: 'CAREGIVER' },
    });
    harness.transaction.loginIdentity.findFirst.mockResolvedValue({
      id: 'verified-email',
    });
    harness.transaction.householdInvitation.updateMany.mockResolvedValue({
      count: 1,
    });
    harness.transaction.householdMember.findUnique.mockResolvedValue(null);
    harness.transaction.householdMember.create.mockResolvedValue({});
    harness.transaction.householdMemberRole.upsert.mockResolvedValue({});
    harness.transaction.householdMember.findFirst.mockResolvedValue(
      memberRecord(),
    );

    await expect(
      harness.service.acceptInvitation(principal, issued.rawToken),
    ).resolves.toMatchObject({
      householdId: householdRecord().id,
      roleCodes: ['CAREGIVER'],
    });
    expect(
      harness.transaction.householdInvitation.updateMany,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ data: { acceptedAt: now } }),
    );
    expect(harness.transaction.householdMember.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: principal.userId,
        householdId: householdRecord().id,
        status: 'ACTIVE',
      }),
    });
  });

  it('does not consume an invitation when the authenticated email is not the target', async () => {
    const harness = makeHarness();
    const issued = harness.tokens.issue();
    harness.transaction.householdInvitation.findUnique.mockResolvedValue({
      id: 'invitation-1',
      householdId: householdRecord().id,
      targetEmailNormalized: 'other@example.com',
      roleId: 'caregiver-role',
      issuedByMemberId: 'owner-member',
      acceptedAt: null,
      revokedAt: null,
      expiresAt: new Date('2026-08-02T00:00:00.000Z'),
      household: { status: 'ACTIVE' },
      role: { id: 'caregiver-role', scope: 'HOUSEHOLD', code: 'CAREGIVER' },
    });
    harness.transaction.loginIdentity.findFirst.mockResolvedValue(null);

    await expect(
      harness.service.acceptInvitation(principal, issued.rawToken),
    ).rejects.toBeInstanceOf(InvalidInvitationException);
    expect(
      harness.transaction.householdInvitation.updateMany,
    ).not.toHaveBeenCalled();
    expect(harness.transaction.householdMember.create).not.toHaveBeenCalled();
  });
});
