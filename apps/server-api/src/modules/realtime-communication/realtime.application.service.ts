import { createHash, randomBytes } from 'node:crypto';

import { ForbiddenException, Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ulid } from 'ulid';

import {
  Prisma,
  type RemoteAccessPolicy,
  type RemoteAssistanceSession,
} from '../../infrastructure/database/generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { DevicePrincipal } from '../device-activation/device-activation.types';
import { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import type { UserPrincipal } from '../identity/identity.types';
import {
  assertRemoteTransition,
  isRemoteTerminal,
} from './domain/remote-session-state-machine';
import {
  LIVEKIT_PORT,
  MEDIA_LEASE_PORT,
  OPEN_REMOTE_STATUSES,
  REMOTE_ANSWER_MODE,
  REMOTE_JOIN_TICKET_TTL_SECONDS,
  REMOTE_CONNECT_TIMEOUT_SECONDS,
  REMOTE_MEDIA_LEASE_TTL_SECONDS,
  REMOTE_POLICY_MODE,
  REMOTE_RING_TIMEOUT_SECONDS,
  REMOTE_SESSION_STATUS,
} from './realtime.constants';
import {
  RemoteCallNotAllowedException,
  RemoteConsentRequiredException,
  RemoteDeviceBusyException,
  RemoteDeviceOfflineException,
  RemoteIdempotencyConflictException,
  RemoteIdempotencyKeyException,
  RemoteMediaInvalidException,
  RemoteSessionNotFoundException,
  RemoteSessionStateException,
} from './realtime.errors';
import type {
  RemoteAccessPolicyView,
  RemoteAvailabilityView,
  RemoteJoinTicketView,
  RemoteSessionView,
  RequestedRemoteMedia,
  VerifiedLiveKitWebhook,
} from './realtime.types';
import type { LiveKitPort } from './ports/livekit.port';
import type { MediaLeaseOwner, MediaLeasePort } from './ports/media-lease.port';

const SERIALIZABLE_RETRIES = 3;

type SessionWithParticipants = Prisma.RemoteAssistanceSessionGetPayload<{
  include: { participants: true };
}>;

type SessionParticipant = SessionWithParticipants['participants'][number];

type RealtimeConsentClient = Pick<
  Prisma.TransactionClient,
  'recipientConsentState'
>;

interface BindingForRemote {
  id: string;
  householdId: string;
  recipientId: string;
  status: string;
  bindingVersion: number;
  device: {
    id: string;
    status: string;
    lastSeenAt: Date | null;
  };
  recipient: {
    id: string;
    status: string;
    deletedAt: Date | null;
  };
  remoteAccessPolicy: RemoteAccessPolicy | null;
}

export interface RequestRemoteSessionCommand {
  principal: UserPrincipal;
  householdId: string;
  bindingId: string;
  media: RequestedRemoteMedia;
  idempotencyKey: string;
  traceId: string;
}

export interface UpdateRemotePolicyCommand {
  principal: UserPrincipal;
  householdId: string;
  bindingId: string;
  cameraAllowed: boolean;
  microphoneAllowed: boolean;
  sendFamilyAudioAllowed: boolean;
  version: number;
}

@Injectable()
export class RealtimeCommunicationApplicationService {
  private readonly logger = new Logger(
    RealtimeCommunicationApplicationService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly householdAccess: HouseholdAccessPolicy,
    private readonly config: ConfigService,
    @Inject(MEDIA_LEASE_PORT) private readonly leases: MediaLeasePort,
    @Inject(LIVEKIT_PORT) private readonly livekit: LiveKitPort,
  ) {}

  async getCurrentDeviceSession(
    principal: DevicePrincipal,
  ): Promise<RemoteSessionView | null> {
    this.assertRemoteDeviceCapability(principal);
    const session = await this.prisma.remoteAssistanceSession.findFirst({
      where: {
        householdId: principal.householdId,
        recipientId: principal.recipientId,
        bindingId: principal.bindingId,
        status: { in: [...OPEN_REMOTE_STATUSES] },
      },
      orderBy: { requestedAt: 'desc' },
    });
    if (!session) {
      return null;
    }
    if (await this.expireOrFailStaleSession(session, new Date())) {
      return null;
    }
    try {
      const { binding } =
        await this.requireCurrentSessionEligibilityOrRevoke(session);
      if (
        binding.bindingVersion !== principal.bindingVersion ||
        binding.device.id !== principal.deviceId
      ) {
        await this.finishSession(session, {
          targetStatus: REMOTE_SESSION_STATUS.revoked,
          actorType: 'SYSTEM',
          actorId: null,
          reason: 'DEVICE_AUTHORITY_REVOKED',
        });
        return null;
      }
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof RemoteMediaInvalidException
      ) {
        return null;
      }
      throw error;
    }
    return this.toSessionView(session);
  }

  async getAvailability(
    principal: UserPrincipal,
    householdId: string,
    bindingId: string,
  ): Promise<RemoteAvailabilityView> {
    const binding = await this.requireFamilyBinding(
      principal,
      householdId,
      bindingId,
    );
    const [currentLease, openSession] = await Promise.all([
      this.leases.current(bindingId),
      this.prisma.remoteAssistanceSession.findFirst({
        where: {
          bindingId,
          status: { in: [...OPEN_REMOTE_STATUSES] },
        },
        select: { id: true },
      }),
    ]);
    return {
      bindingId,
      online: this.isOnline(binding.device.lastSeenAt),
      // MySQL is the durable source of lifecycle state. Redis is the fast
      // mutual-exclusion path. Reporting either as busy avoids advertising an
      // immediately unusable device while a lost-lease session is reconciled.
      busy: currentLease !== null || openSession !== null,
      answerMode: REMOTE_ANSWER_MODE.onsite,
      lastSeenAt: binding.device.lastSeenAt?.toISOString() ?? null,
    };
  }

  async getRemoteAccessPolicy(
    principal: UserPrincipal,
    householdId: string,
    bindingId: string,
  ): Promise<RemoteAccessPolicyView> {
    const binding = await this.requireFamilyBinding(
      principal,
      householdId,
      bindingId,
    );
    const policy =
      binding.remoteAccessPolicy ?? (await this.createDefaultPolicy(binding));
    return this.toPolicyView(policy);
  }

  async updateRemoteAccessPolicy(
    command: UpdateRemotePolicyCommand,
  ): Promise<RemoteAccessPolicyView> {
    const binding = await this.requireFamilyBinding(
      command.principal,
      command.householdId,
      command.bindingId,
    );
    // A member who may place a call is not automatically allowed to change the
    // recipient-wide camera/microphone policy.
    await this.householdAccess.requireRecipientAction(
      this.prisma,
      command.principal.userId,
      command.householdId,
      binding.recipientId,
      'MANAGE_RECIPIENT',
    );
    const policy =
      binding.remoteAccessPolicy ?? (await this.createDefaultPolicy(binding));
    const result = await this.prisma.remoteAccessPolicy.updateMany({
      where: {
        id: policy.id,
        householdId: command.householdId,
        bindingId: command.bindingId,
        version: command.version,
        status: 'ACTIVE',
      },
      data: {
        // This release deliberately exposes only onsite answer. There is no
        // silent/administrator mode and no family-controlled localConfirmedAt.
        mode: REMOTE_POLICY_MODE.onsite,
        cameraAllowed: command.cameraAllowed,
        microphoneAllowed: command.microphoneAllowed,
        sendFamilyAudioAllowed: command.sendFamilyAudioAllowed,
        countdownSeconds: 10,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) {
      throw new RemoteSessionStateException(['CURRENT_POLICY_VERSION']);
    }
    const updated = await this.prisma.remoteAccessPolicy.findUnique({
      where: { id: policy.id },
    });
    if (!updated) {
      throw new RemoteCallNotAllowedException();
    }
    await this.revokeSessionsDisallowedByPolicy(updated);
    return this.toPolicyView(updated);
  }

  async requestRemoteSession(
    command: RequestRemoteSessionCommand,
  ): Promise<RemoteSessionView> {
    const idempotencyKey = this.requireIdempotencyKey(command.idempotencyKey);
    this.validateMedia(command.media);
    const binding = await this.requireFamilyBinding(
      command.principal,
      command.householdId,
      command.bindingId,
    );
    if (!this.isOnline(binding.device.lastSeenAt)) {
      throw new RemoteDeviceOfflineException();
    }
    const member = await this.householdAccess.requireRecipientAction(
      this.prisma,
      command.principal.userId,
      command.householdId,
      binding.recipientId,
      'REMOTE_CALL',
    );
    await this.requireRemoteConsents(
      binding.householdId,
      binding.recipientId,
      command.media,
    );
    const policy =
      binding.remoteAccessPolicy ?? (await this.createDefaultPolicy(binding));
    this.assertPolicyAllows(policy, command.media);

    const sessionId = deterministicSessionId(
      command.principal.userId,
      member.id,
      binding.id,
      idempotencyKey,
    );
    const replay = await this.prisma.remoteAssistanceSession.findUnique({
      where: { id: sessionId },
    });
    if (replay) {
      this.assertRemoteReplay(replay, member.id, binding.id, command.media);
      await this.ensureReplayLease(replay);
      return this.toSessionView(replay);
    }

    const leaseOwner = this.leaseOwner(sessionId);
    const reservation = await this.reserveRemoteLeaseForRequest(
      binding.id,
      leaseOwner,
    );
    const now = new Date();
    try {
      await this.reconcileDisplacedSessions(binding.id, sessionId);
      const created = await this.serializable(async (transaction) => {
        const existing = await transaction.remoteAssistanceSession.findUnique({
          where: { id: sessionId },
        });
        if (existing) {
          this.assertRemoteReplay(
            existing,
            member.id,
            binding.id,
            command.media,
          );
          return existing;
        }

        // All authorization-sensitive reads above are repeated inside the
        // serializable unit. This closes the window where a binding, Care
        // Authority, consent, or policy is revoked after the initial checks but
        // before the durable session is created.
        const currentBinding = await transaction.companionBinding.findFirst({
          where: {
            id: binding.id,
            householdId: binding.householdId,
            recipientId: binding.recipientId,
            bindingVersion: binding.bindingVersion,
            status: 'ACTIVE',
            revokedAt: null,
            device: { status: 'ACTIVE' },
            household: { status: 'ACTIVE' },
            recipient: { status: 'ACTIVE', deletedAt: null },
          },
          include: {
            device: { select: { id: true, status: true, lastSeenAt: true } },
            recipient: {
              select: { id: true, status: true, deletedAt: true },
            },
            remoteAccessPolicy: true,
          },
        });
        if (
          !currentBinding ||
          !this.isOnline(currentBinding.device.lastSeenAt) ||
          !currentBinding.remoteAccessPolicy ||
          currentBinding.remoteAccessPolicy.id !== policy.id ||
          currentBinding.remoteAccessPolicy.version !== policy.version
        ) {
          throw new RemoteCallNotAllowedException();
        }
        const currentMember = await this.householdAccess.requireRecipientAction(
          transaction,
          command.principal.userId,
          command.householdId,
          binding.recipientId,
          'REMOTE_CALL',
        );
        if (currentMember.id !== member.id) {
          throw new RemoteCallNotAllowedException();
        }
        const currentConsent = await this.requireRemoteConsents(
          binding.householdId,
          binding.recipientId,
          command.media,
          transaction,
        );
        this.assertPolicyAllows(
          currentBinding.remoteAccessPolicy,
          command.media,
        );
        const busy = await transaction.remoteAssistanceSession.findFirst({
          where: {
            bindingId: binding.id,
            status: { in: [...OPEN_REMOTE_STATUSES] },
          },
          select: { id: true },
        });
        if (busy) {
          throw new RemoteDeviceBusyException();
        }
        const session = await transaction.remoteAssistanceSession.create({
          data: {
            id: sessionId,
            householdId: binding.householdId,
            recipientId: binding.recipientId,
            bindingId: binding.id,
            initiatedByMemberId: member.id,
            accessPolicyId: policy.id,
            answerMode: REMOTE_ANSWER_MODE.onsite,
            requestedMedia: encodeMedia(command.media),
            status: REMOTE_SESSION_STATUS.ringing,
            livekitRoomName: `ml_${randomBytes(24).toString('base64url')}`,
            requestedAt: now,
            consentSnapshotJson: currentConsent,
            traceId: command.traceId,
          },
        });
        await this.appendSessionEvent(transaction, session.id, {
          eventType: 'REQUESTED',
          actorType: 'USER',
          actorId: command.principal.userId,
          occurredAt: now,
          metadata: { answerMode: REMOTE_ANSWER_MODE.onsite },
        });
        await this.appendOutbox(
          transaction,
          session,
          'remote-session.invited',
          now,
        );
        return session;
      });
      return this.toSessionView(created);
    } catch (error) {
      if (reservation === 'REMOTE_RESERVED') {
        await this.safeRelease(binding.id, leaseOwner);
      }
      throw error;
    }
  }

  async getFamilySession(
    principal: UserPrincipal,
    householdId: string,
    sessionId: string,
  ): Promise<RemoteSessionView> {
    const session = await this.prisma.remoteAssistanceSession.findFirst({
      where: { id: sessionId, householdId },
    });
    if (!session) {
      throw new RemoteSessionNotFoundException();
    }
    await this.householdAccess.requireRecipientAction(
      this.prisma,
      principal.userId,
      householdId,
      session.recipientId,
      'REMOTE_CALL',
    );
    return this.toSessionView(session);
  }

  async acceptByDevice(
    principal: DevicePrincipal,
    sessionId: string,
  ): Promise<RemoteSessionView> {
    const session = await this.requireDeviceSession(principal, sessionId);
    assertRemoteTransition(session.status, REMOTE_SESSION_STATUS.accepted);
    const { binding } =
      await this.requireCurrentSessionEligibilityOrRevoke(session);
    if (binding.bindingVersion !== principal.bindingVersion) {
      await this.finishSession(session, {
        targetStatus: REMOTE_SESSION_STATUS.revoked,
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'DEVICE_AUTHORITY_REVOKED',
      });
      throw new RemoteCallNotAllowedException();
    }
    const owner = this.leaseOwner(session.id);
    const handoff = await this.claimRemoteLeaseForAcceptance(session, owner);
    if (!handoff.claimed) {
      await this.finishSession(session, {
        targetStatus: REMOTE_SESSION_STATUS.failed,
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'MEDIA_LEASE_LOST',
      });
      throw new RemoteDeviceBusyException();
    }
    const now = new Date();
    let updated: RemoteAssistanceSession | null;
    try {
      updated = await this.prisma.$transaction(async (transaction) => {
        const currentBinding = await transaction.companionBinding.findFirst({
          where: {
            id: session.bindingId,
            householdId: session.householdId,
            recipientId: session.recipientId,
            bindingVersion: principal.bindingVersion,
            status: 'ACTIVE',
            revokedAt: null,
            device: { status: 'ACTIVE' },
            household: { status: 'ACTIVE' },
            recipient: { status: 'ACTIVE', deletedAt: null },
          },
          include: { remoteAccessPolicy: true },
        });
        if (
          !currentBinding?.remoteAccessPolicy ||
          currentBinding.remoteAccessPolicy.id !== session.accessPolicyId
        ) {
          throw new RemoteCallNotAllowedException();
        }
        const currentMedia = decodeMedia(session.requestedMedia);
        await this.requireRemoteConsents(
          session.householdId,
          session.recipientId,
          currentMedia,
          transaction,
        );
        this.assertPolicyAllows(
          currentBinding.remoteAccessPolicy,
          currentMedia,
        );
        const changed = await transaction.remoteAssistanceSession.updateMany({
          where: {
            id: session.id,
            status: REMOTE_SESSION_STATUS.ringing,
            version: session.version,
          },
          data: {
            status: REMOTE_SESSION_STATUS.accepted,
            acceptedAt: now,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) {
          throw new RemoteSessionStateException([
            REMOTE_SESSION_STATUS.ringing,
          ]);
        }
        // Family media takes exclusive ownership. Persisting the interruption
        // before issuing any LiveKit token prevents the AI session from being
        // treated as active after a device reconnect.
        await transaction.modelSession.updateMany({
          where: {
            companionSession: {
              bindingId: session.bindingId,
              status: 'ACTIVE',
            },
            status: 'ACTIVE',
          },
          data: {
            status: 'ENDED',
            endedAt: now,
            endReason: 'REMOTE_ASSISTANCE_ACCEPTED',
          },
        });
        await transaction.companionSession.updateMany({
          where: { bindingId: session.bindingId, status: 'ACTIVE' },
          data: {
            status: 'ENDED',
            endedAt: now,
            endReason: 'REMOTE_ASSISTANCE_ACCEPTED',
            version: { increment: 1 },
          },
        });
        await this.appendSessionEvent(transaction, session.id, {
          eventType: 'ACCEPTED_ON_DEVICE',
          actorType: 'DEVICE',
          actorId: principal.deviceId,
          occurredAt: now,
        });
        await this.appendOutbox(
          transaction,
          session,
          'remote-session.accepted',
          now,
        );
        return transaction.remoteAssistanceSession.findUnique({
          where: { id: session.id },
        });
      });
    } catch (error) {
      await this.safeRelease(session.bindingId, owner);
      if (handoff.previousAiOwner) {
        try {
          await this.leases.acquire(
            session.bindingId,
            handoff.previousAiOwner,
            REMOTE_MEDIA_LEASE_TTL_SECONDS,
          );
        } catch (restoreError) {
          this.logger.warn(
            `AI media lease restore deferred (${restoreError instanceof Error ? restoreError.name : 'unknown'})`,
          );
        }
      }
      if (
        error instanceof RemoteCallNotAllowedException ||
        error instanceof RemoteConsentRequiredException ||
        error instanceof RemoteMediaInvalidException
      ) {
        await this.finishSession(session, {
          targetStatus: REMOTE_SESSION_STATUS.revoked,
          actorType: 'SYSTEM',
          actorId: null,
          reason: 'REMOTE_AUTHORITY_REVOKED',
        });
      }
      throw error;
    }
    if (!updated) {
      throw new RemoteSessionNotFoundException();
    }
    return this.toSessionView(updated);
  }

  async declineByDevice(
    principal: DevicePrincipal,
    sessionId: string,
  ): Promise<RemoteSessionView> {
    const session = await this.requireDeviceSession(principal, sessionId);
    return this.finishSession(session, {
      targetStatus: REMOTE_SESSION_STATUS.declined,
      actorType: 'DEVICE',
      actorId: principal.deviceId,
      reason: 'DECLINED_ON_DEVICE',
    });
  }

  async cancelByFamily(
    principal: UserPrincipal,
    householdId: string,
    sessionId: string,
  ): Promise<RemoteSessionView> {
    const session = await this.requireFamilySession(
      principal,
      householdId,
      sessionId,
      true,
    );
    return this.finishSession(session, {
      targetStatus: REMOTE_SESSION_STATUS.cancelled,
      actorType: 'USER',
      actorId: principal.userId,
      reason: 'CALLER_CANCELLED',
    });
  }

  async endByFamily(
    principal: UserPrincipal,
    householdId: string,
    sessionId: string,
  ): Promise<RemoteSessionView> {
    const session = await this.requireFamilySession(
      principal,
      householdId,
      sessionId,
      true,
    );
    return this.finishSession(session, {
      targetStatus: REMOTE_SESSION_STATUS.ended,
      actorType: 'USER',
      actorId: principal.userId,
      reason: 'FAMILY_ENDED',
    });
  }

  async endByDevice(
    principal: DevicePrincipal,
    sessionId: string,
  ): Promise<RemoteSessionView> {
    const session = await this.requireDeviceSession(principal, sessionId);
    return this.finishSession(session, {
      targetStatus: REMOTE_SESSION_STATUS.ended,
      actorType: 'DEVICE',
      actorId: principal.deviceId,
      reason: 'DEVICE_ENDED',
    });
  }

  async issueFamilyJoinTicket(
    principal: UserPrincipal,
    householdId: string,
    sessionId: string,
    clientType: 'WEB' | 'ANDROID',
  ): Promise<RemoteJoinTicketView> {
    const session = await this.requireFamilySession(
      principal,
      householdId,
      sessionId,
      true,
    );
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      select: { displayName: true },
    });
    if (!user) {
      throw new RemoteCallNotAllowedException();
    }
    return this.issueJoinTicket(session, {
      principalType: 'USER',
      userId: principal.userId,
      bindingId: null,
      role: 'FAMILY',
      clientType,
      displayName: user.displayName,
    });
  }

  async issueDeviceJoinTicket(
    principal: DevicePrincipal,
    sessionId: string,
    clientType: 'WEB' | 'ANDROID',
  ): Promise<RemoteJoinTicketView> {
    const session = await this.requireDeviceSession(principal, sessionId);
    return this.issueJoinTicket(
      session,
      {
        principalType: 'DEVICE',
        userId: null,
        bindingId: principal.bindingId,
        role: 'DEVICE',
        clientType,
        displayName: '守忆灯塔陪伴设备',
      },
      principal.bindingVersion,
    );
  }

  async renewDeviceLease(
    principal: DevicePrincipal,
    sessionId: string,
  ): Promise<{ renewed: true; expiresInSeconds: number }> {
    const session = await this.requireDeviceSession(principal, sessionId);
    if (isRemoteTerminal(session.status)) {
      await this.cleanupFinishedSession(session);
      throw new RemoteSessionStateException([...OPEN_REMOTE_STATUSES]);
    }
    const { binding } =
      await this.requireCurrentSessionEligibilityOrRevoke(session);
    if (binding.bindingVersion !== principal.bindingVersion) {
      await this.finishSession(session, {
        targetStatus: REMOTE_SESSION_STATUS.revoked,
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'DEVICE_AUTHORITY_REVOKED',
      });
      throw new RemoteCallNotAllowedException();
    }
    const renewed = await this.leases.renew(
      session.bindingId,
      this.leaseOwner(session.id),
      REMOTE_MEDIA_LEASE_TTL_SECONDS,
    );
    if (!renewed) {
      await this.finishSession(session, {
        targetStatus: REMOTE_SESSION_STATUS.failed,
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'MEDIA_LEASE_LOST',
      });
      throw new RemoteDeviceBusyException();
    }
    return {
      renewed: true,
      expiresInSeconds: REMOTE_MEDIA_LEASE_TTL_SECONDS,
    };
  }

  async expireStaleSessions(now: Date): Promise<{
    examined: number;
    expired: number;
    failed: number;
  }> {
    if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
      throw new TypeError('expireStaleSessions requires a valid Date');
    }
    const sessions = await this.prisma.remoteAssistanceSession.findMany({
      where: { status: { in: [...OPEN_REMOTE_STATUSES] } },
      orderBy: { requestedAt: 'asc' },
    });
    let expired = 0;
    let failed = 0;
    for (const session of sessions) {
      const result = await this.expireOrFailStaleSession(session, now);
      if (result === REMOTE_SESSION_STATUS.expired) {
        expired += 1;
      } else if (result === REMOTE_SESSION_STATUS.failed) {
        failed += 1;
      }
    }
    return { examined: sessions.length, expired, failed };
  }

  async handleLiveKitWebhook(
    rawBody: string,
    authorization: string | undefined,
  ): Promise<{ received: true }> {
    const event = await this.livekit.verifyWebhook(rawBody, authorization);
    if (!event.roomName) {
      return { received: true };
    }
    const session = await this.prisma.remoteAssistanceSession.findFirst({
      where: { livekitRoomName: event.roomName },
      include: { participants: true },
    });
    if (!session) {
      return { received: true };
    }
    if (isRemoteTerminal(session.status)) {
      await this.cleanupFinishedSession(session);
      return { received: true };
    }
    await this.applyLiveKitEvent(session, event);
    return { received: true };
  }

  private async issueJoinTicket(
    session: RemoteAssistanceSession,
    participant: {
      principalType: 'USER' | 'DEVICE';
      userId: string | null;
      bindingId: string | null;
      role: 'FAMILY' | 'DEVICE';
      clientType: 'WEB' | 'ANDROID';
      displayName: string;
    },
    expectedBindingVersion?: number,
  ): Promise<RemoteJoinTicketView> {
    if (
      ![
        REMOTE_SESSION_STATUS.accepted,
        REMOTE_SESSION_STATUS.connecting,
        REMOTE_SESSION_STATUS.active,
      ].includes(session.status as never)
    ) {
      throw new RemoteSessionStateException([
        REMOTE_SESSION_STATUS.accepted,
        REMOTE_SESSION_STATUS.connecting,
        REMOTE_SESSION_STATUS.active,
      ]);
    }
    if (
      session.answerMode !== REMOTE_ANSWER_MODE.onsite ||
      !session.acceptedAt
    ) {
      throw new RemoteCallNotAllowedException();
    }
    const { binding, media } =
      await this.requireCurrentSessionEligibilityOrRevoke(session);
    if (
      expectedBindingVersion !== undefined &&
      binding.bindingVersion !== expectedBindingVersion
    ) {
      await this.finishSession(session, {
        targetStatus: REMOTE_SESSION_STATUS.revoked,
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'DEVICE_AUTHORITY_REVOKED',
      });
      throw new RemoteCallNotAllowedException();
    }
    if (
      !(await this.leases.renew(
        session.bindingId,
        this.leaseOwner(session.id),
        REMOTE_MEDIA_LEASE_TTL_SECONDS,
      ))
    ) {
      await this.finishSession(session, {
        targetStatus: REMOTE_SESSION_STATUS.failed,
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'MEDIA_LEASE_LOST',
      });
      throw new RemoteDeviceBusyException();
    }

    const subjectId = participant.userId ?? participant.bindingId;
    if (!subjectId) {
      throw new RemoteCallNotAllowedException();
    }
    const participantId = deterministicScopedId(
      'remote-participant',
      session.id,
      participant.principalType,
      subjectId,
      participant.role,
    );
    const row = await this.prisma.remoteSessionParticipant.upsert({
      where: { id: participantId },
      create: {
        id: participantId,
        sessionId: session.id,
        principalType: participant.principalType,
        userId: participant.userId,
        bindingId: participant.bindingId,
        role: participant.role,
        clientType: participant.clientType,
      },
      update: { clientType: participant.clientType },
    });
    if (
      row.sessionId !== session.id ||
      row.principalType !== participant.principalType ||
      row.userId !== participant.userId ||
      row.bindingId !== participant.bindingId ||
      row.role !== participant.role
    ) {
      throw new RemoteCallNotAllowedException();
    }

    if (session.status === REMOTE_SESSION_STATUS.accepted) {
      const changed = await this.prisma.remoteAssistanceSession.updateMany({
        where: {
          id: session.id,
          status: REMOTE_SESSION_STATUS.accepted,
          version: session.version,
        },
        data: {
          status: REMOTE_SESSION_STATUS.connecting,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        const current = await this.prisma.remoteAssistanceSession.findUnique({
          where: { id: session.id },
          select: { status: true },
        });
        if (
          !current ||
          ![
            REMOTE_SESSION_STATUS.connecting,
            REMOTE_SESSION_STATUS.active,
          ].includes(current.status as never)
        ) {
          throw new RemoteSessionStateException([
            REMOTE_SESSION_STATUS.accepted,
            REMOTE_SESSION_STATUS.connecting,
            REMOTE_SESSION_STATUS.active,
          ]);
        }
      }
    }

    const family = participant.role === 'FAMILY';
    const identity = this.participantIdentity(session.id, row);
    let ticket: Awaited<ReturnType<LiveKitPort['issueJoinTicket']>>;
    try {
      ticket = await this.livekit.issueJoinTicket({
        roomName: session.livekitRoomName,
        identity,
        displayName: participant.displayName,
        ttlSeconds: REMOTE_JOIN_TICKET_TTL_SECONDS,
        publishMicrophone: family
          ? media.sendFamilyAudio
          : media.receiveDeviceAudio,
        publishCamera: family
          ? media.sendFamilyVideo
          : media.receiveDeviceVideo,
        canSubscribe: family
          ? media.receiveDeviceAudio || media.receiveDeviceVideo
          : media.sendFamilyAudio || media.sendFamilyVideo,
        metadata: {
          remoteSessionId: session.id,
          participantId: row.id,
          role: participant.role,
          recording: 'false',
          transcription: 'false',
        },
      });
    } catch (error) {
      await this.finishSession(session, {
        targetStatus: REMOTE_SESSION_STATUS.failed,
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'MEDIA_PROVIDER_UNAVAILABLE',
      });
      throw error;
    }
    const current = await this.prisma.remoteAssistanceSession.findUnique({
      where: { id: session.id },
      select: { status: true },
    });
    if (
      !current ||
      ![
        REMOTE_SESSION_STATUS.connecting,
        REMOTE_SESSION_STATUS.active,
      ].includes(current.status as never)
    ) {
      // Never return a token minted concurrently with cancellation/revocation.
      // The participant id was persisted before minting, so the same identity
      // can also be revoked by normal terminal cleanup.
      await this.safeRemoveParticipant(session.livekitRoomName, identity);
      throw new RemoteSessionStateException([
        REMOTE_SESSION_STATUS.connecting,
        REMOTE_SESSION_STATUS.active,
      ]);
    }
    return {
      sessionId: session.id,
      participantId: row.id,
      participantIdentity: identity,
      url: ticket.url,
      token: ticket.token,
      expiresAt: ticket.expiresAt.toISOString(),
      media,
      recording: false,
      transcription: false,
    };
  }

  private async applyLiveKitEvent(
    session: SessionWithParticipants,
    event: VerifiedLiveKitWebhook,
  ): Promise<void> {
    const participant = event.participantIdentity
      ? this.findParticipantByIdentity(session, event.participantIdentity)
      : null;
    if (event.event === 'participant_joined' && participant) {
      await this.prisma.remoteSessionParticipant.updateMany({
        where: { id: participant.id, joinedAt: null, leftAt: null },
        data: { joinedAt: event.occurredAt },
      });
    } else if (event.event === 'track_published' && participant) {
      await this.prisma.remoteSessionParticipant.updateMany({
        where: { id: participant.id, leftAt: null },
        data: {
          ...(event.trackSource === 'microphone'
            ? { publishedAudio: true }
            : {}),
          ...(event.trackSource === 'camera' ? { publishedVideo: true } : {}),
        },
      });
    } else if (event.event === 'track_unpublished' && participant) {
      await this.prisma.remoteSessionParticipant.updateMany({
        where: { id: participant.id, leftAt: null },
        data: {
          ...(event.trackSource === 'microphone'
            ? { publishedAudio: false }
            : {}),
          ...(event.trackSource === 'camera' ? { publishedVideo: false } : {}),
        },
      });
      if (this.isRequiredTrack(session, participant, event.trackSource)) {
        await this.finishSession(session, {
          targetStatus: REMOTE_SESSION_STATUS.ended,
          actorType: 'SYSTEM',
          actorId: null,
          reason: 'REQUIRED_TRACK_UNPUBLISHED',
        });
      }
      return;
    } else if (event.event === 'participant_left' && participant) {
      await this.prisma.remoteSessionParticipant.updateMany({
        where: { id: participant.id, leftAt: null },
        data: { leftAt: event.occurredAt },
      });
      // Once a ticket has been issued, either side leaving terminates the
      // attempt. In particular, CONNECTING must not linger and later be
      // revived by a delayed track_published webhook.
      await this.finishSession(session, {
        targetStatus: REMOTE_SESSION_STATUS.ended,
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'PARTICIPANT_LEFT',
      });
      return;
    } else if (event.event === 'room_finished') {
      await this.finishSession(session, {
        targetStatus: REMOTE_SESSION_STATUS.ended,
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'ROOM_FINISHED',
      });
      return;
    }

    const refreshed = await this.prisma.remoteAssistanceSession.findUnique({
      where: { id: session.id },
      include: { participants: true },
    });
    if (refreshed && refreshed.status === REMOTE_SESSION_STATUS.connecting) {
      const media = decodeMedia(refreshed.requestedMedia);
      const family = refreshed.participants.find(
        (candidate) => candidate.role === 'FAMILY',
      );
      const device = refreshed.participants.find(
        (candidate) => candidate.role === 'DEVICE',
      );
      const ready =
        family?.joinedAt &&
        !family.leftAt &&
        device?.joinedAt &&
        !device.leftAt &&
        (!media.receiveDeviceAudio || device.publishedAudio) &&
        (!media.receiveDeviceVideo || device.publishedVideo) &&
        (!media.sendFamilyAudio || family.publishedAudio) &&
        (!media.sendFamilyVideo || family.publishedVideo);
      if (ready) {
        try {
          await this.requireCurrentSessionEligibilityOrRevoke(refreshed);
        } catch (error) {
          if (
            error instanceof ForbiddenException ||
            error instanceof RemoteMediaInvalidException
          ) {
            return;
          }
          throw error;
        }
        if (
          !(await this.leases.renew(
            refreshed.bindingId,
            this.leaseOwner(refreshed.id),
            REMOTE_MEDIA_LEASE_TTL_SECONDS,
          ))
        ) {
          await this.finishSession(refreshed, {
            targetStatus: REMOTE_SESSION_STATUS.failed,
            actorType: 'SYSTEM',
            actorId: null,
            reason: 'MEDIA_LEASE_LOST',
          });
          return;
        }
        await this.activateSession(refreshed, event.occurredAt);
      }
    }
  }

  private findParticipantByIdentity(
    session: SessionWithParticipants,
    identity: string,
  ): SessionParticipant | null {
    return (
      session.participants.find(
        (candidate) =>
          identity === this.participantIdentity(session.id, candidate),
      ) ?? null
    );
  }

  private participantIdentity(
    sessionId: string,
    participant: Pick<SessionParticipant, 'id' | 'role'>,
  ): string {
    return `${participant.role === 'FAMILY' ? 'family' : 'device'}_${sessionId}_${participant.id}`;
  }

  private isRequiredTrack(
    session: RemoteAssistanceSession,
    participant: Pick<SessionParticipant, 'role'>,
    source: VerifiedLiveKitWebhook['trackSource'],
  ): boolean {
    const media = decodeMedia(session.requestedMedia);
    if (participant.role === 'FAMILY') {
      return (
        (source === 'microphone' && media.sendFamilyAudio) ||
        (source === 'camera' && media.sendFamilyVideo)
      );
    }
    return (
      (source === 'microphone' && media.receiveDeviceAudio) ||
      (source === 'camera' && media.receiveDeviceVideo)
    );
  }

  private async activateSession(
    session: RemoteAssistanceSession,
    connectedAt: Date,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.remoteAssistanceSession.updateMany({
        where: {
          id: session.id,
          status: REMOTE_SESSION_STATUS.connecting,
          version: session.version,
        },
        data: {
          status: REMOTE_SESSION_STATUS.active,
          connectedAt,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        return;
      }
      await this.appendSessionEvent(transaction, session.id, {
        eventType: 'MEDIA_CONNECTED',
        actorType: 'SYSTEM',
        actorId: null,
        occurredAt: connectedAt,
      });
      await this.appendOutbox(
        transaction,
        session,
        'remote-session.connected',
        connectedAt,
      );
    });
  }

  private async finishSession(
    session: RemoteAssistanceSession,
    command: {
      targetStatus: string;
      actorType: 'USER' | 'DEVICE' | 'SYSTEM';
      actorId: string | null;
      reason: string;
    },
  ): Promise<RemoteSessionView> {
    let current = session;
    for (let attempt = 1; attempt <= SERIALIZABLE_RETRIES; attempt += 1) {
      if (isRemoteTerminal(current.status)) {
        await this.cleanupFinishedSession(current);
        return this.toSessionView(current);
      }
      const target = this.resolveTerminalTarget(
        current.status,
        command.targetStatus,
      );
      assertRemoteTransition(current.status, target);
      const now = new Date();
      const outcome = await this.prisma.$transaction(async (transaction) => {
        const changed = await transaction.remoteAssistanceSession.updateMany({
          where: {
            id: current.id,
            status: current.status,
            version: current.version,
          },
          data: {
            status: target,
            endedAt: now,
            endedByType: command.actorType,
            endedById: command.actorId,
            endReason: command.reason,
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) {
          return {
            changed: false,
            session: await transaction.remoteAssistanceSession.findUnique({
              where: { id: current.id },
            }),
          };
        }
        await this.appendSessionEvent(transaction, current.id, {
          eventType: target,
          actorType: command.actorType,
          actorId: command.actorId,
          occurredAt: now,
          metadata: { reason: command.reason },
        });
        await this.appendOutbox(
          transaction,
          current,
          'remote-session.ended',
          now,
        );
        return {
          changed: true,
          session: await transaction.remoteAssistanceSession.findUnique({
            where: { id: current.id },
          }),
        };
      });
      if (!outcome.session) {
        throw new RemoteSessionNotFoundException();
      }
      if (outcome.changed || isRemoteTerminal(outcome.session.status)) {
        await this.cleanupFinishedSession(outcome.session);
        return this.toSessionView(outcome.session);
      }
      // A webhook and a user/device action may race while the session moves
      // forward (for example CONNECTING -> ACTIVE vs. hang-up). Re-read and
      // retry so the termination request wins without reviving terminal state.
      current = outcome.session;
    }
    throw new RemoteSessionStateException([current.status]);
  }

  private resolveTerminalTarget(status: string, requested: string): string {
    if (
      requested === REMOTE_SESSION_STATUS.ended ||
      requested === REMOTE_SESSION_STATUS.cancelled
    ) {
      return status === REMOTE_SESSION_STATUS.active ||
        status === REMOTE_SESSION_STATUS.ending
        ? REMOTE_SESSION_STATUS.ended
        : REMOTE_SESSION_STATUS.cancelled;
    }
    if (
      requested === REMOTE_SESSION_STATUS.revoked &&
      status === REMOTE_SESSION_STATUS.ending
    ) {
      return REMOTE_SESSION_STATUS.failed;
    }
    return requested;
  }

  private async requireFamilyBinding(
    principal: UserPrincipal,
    householdId: string,
    bindingId: string,
  ): Promise<BindingForRemote> {
    const binding = await this.prisma.companionBinding.findFirst({
      where: {
        id: bindingId,
        householdId,
        status: 'ACTIVE',
        revokedAt: null,
        device: { status: 'ACTIVE' },
        household: { status: 'ACTIVE' },
        recipient: { status: 'ACTIVE', deletedAt: null },
      },
      include: {
        device: { select: { id: true, status: true, lastSeenAt: true } },
        recipient: {
          select: { id: true, status: true, deletedAt: true },
        },
        remoteAccessPolicy: true,
      },
    });
    if (!binding) {
      throw new RemoteCallNotAllowedException();
    }
    await this.householdAccess.requireRecipientAction(
      this.prisma,
      principal.userId,
      householdId,
      binding.recipientId,
      'REMOTE_CALL',
    );
    return binding;
  }

  private async requireActiveBinding(
    bindingId: string,
  ): Promise<BindingForRemote> {
    const binding = await this.prisma.companionBinding.findFirst({
      where: {
        id: bindingId,
        status: 'ACTIVE',
        revokedAt: null,
        device: { status: 'ACTIVE' },
        household: { status: 'ACTIVE' },
        recipient: { status: 'ACTIVE', deletedAt: null },
      },
      include: {
        device: { select: { id: true, status: true, lastSeenAt: true } },
        recipient: {
          select: { id: true, status: true, deletedAt: true },
        },
        remoteAccessPolicy: true,
      },
    });
    if (!binding) {
      throw new RemoteCallNotAllowedException();
    }
    return binding;
  }

  private async requireCurrentSessionEligibility(
    session: RemoteAssistanceSession,
  ): Promise<{ binding: BindingForRemote; media: RequestedRemoteMedia }> {
    const initiatingMember = await this.prisma.householdMember.findFirst({
      where: {
        id: session.initiatedByMemberId,
        householdId: session.householdId,
        status: 'ACTIVE',
        user: { status: 'ACTIVE', deletedAt: null },
      },
      select: { userId: true },
    });
    if (!initiatingMember) {
      throw new RemoteCallNotAllowedException();
    }
    const currentMember = await this.householdAccess.requireRecipientAction(
      this.prisma,
      initiatingMember.userId,
      session.householdId,
      session.recipientId,
      'REMOTE_CALL',
    );
    if (currentMember.id !== session.initiatedByMemberId) {
      throw new RemoteCallNotAllowedException();
    }
    const binding = await this.requireActiveBinding(session.bindingId);
    if (
      binding.householdId !== session.householdId ||
      binding.recipientId !== session.recipientId ||
      !binding.remoteAccessPolicy ||
      binding.remoteAccessPolicy.id !== session.accessPolicyId
    ) {
      throw new RemoteCallNotAllowedException();
    }
    const media = decodeMedia(session.requestedMedia);
    await this.requireRemoteConsents(
      session.householdId,
      session.recipientId,
      media,
    );
    this.assertPolicyAllows(binding.remoteAccessPolicy, media);
    return { binding, media };
  }

  private async requireCurrentSessionEligibilityOrRevoke(
    session: RemoteAssistanceSession,
  ): Promise<{ binding: BindingForRemote; media: RequestedRemoteMedia }> {
    try {
      return await this.requireCurrentSessionEligibility(session);
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof RemoteMediaInvalidException
      ) {
        await this.finishSession(session, {
          targetStatus: REMOTE_SESSION_STATUS.revoked,
          actorType: 'SYSTEM',
          actorId: null,
          reason: 'REMOTE_AUTHORITY_REVOKED',
        });
      }
      throw error;
    }
  }

  private async requireFamilySession(
    principal: UserPrincipal,
    householdId: string,
    sessionId: string,
    requireInitiator = false,
  ): Promise<RemoteAssistanceSession> {
    const session = await this.prisma.remoteAssistanceSession.findFirst({
      where: { id: sessionId, householdId },
    });
    if (!session) {
      throw new RemoteSessionNotFoundException();
    }
    const member = await this.householdAccess.requireRecipientAction(
      this.prisma,
      principal.userId,
      householdId,
      session.recipientId,
      'REMOTE_CALL',
    );
    if (requireInitiator && member.id !== session.initiatedByMemberId) {
      throw new RemoteCallNotAllowedException();
    }
    return session;
  }

  private async requireDeviceSession(
    principal: DevicePrincipal,
    sessionId: string,
  ): Promise<RemoteAssistanceSession> {
    this.assertRemoteDeviceCapability(principal);
    const session = await this.prisma.remoteAssistanceSession.findFirst({
      where: {
        id: sessionId,
        householdId: principal.householdId,
        recipientId: principal.recipientId,
        bindingId: principal.bindingId,
      },
    });
    if (!session) {
      throw new RemoteSessionNotFoundException();
    }
    return session;
  }

  private assertRemoteDeviceCapability(principal: DevicePrincipal): void {
    if (!principal.capabilities.includes('REMOTE_ASSISTANCE')) {
      throw new RemoteCallNotAllowedException();
    }
  }

  private async createDefaultPolicy(
    binding: BindingForRemote,
  ): Promise<RemoteAccessPolicy> {
    try {
      return await this.prisma.remoteAccessPolicy.create({
        data: {
          id: ulid(),
          householdId: binding.householdId,
          recipientId: binding.recipientId,
          bindingId: binding.id,
          mode: REMOTE_POLICY_MODE.onsite,
          cameraAllowed: true,
          microphoneAllowed: true,
          sendFamilyAudioAllowed: true,
          countdownSeconds: 10,
          validFrom: new Date(),
          status: 'ACTIVE',
        },
      });
    } catch (error) {
      if (!isPrismaConflict(error)) {
        throw error;
      }
      const existing = await this.prisma.remoteAccessPolicy.findUnique({
        where: { bindingId: binding.id },
      });
      if (!existing) {
        throw new RemoteCallNotAllowedException();
      }
      return existing;
    }
  }

  private async requireRemoteConsents(
    householdId: string,
    recipientId: string,
    media: RequestedRemoteMedia,
    client: RealtimeConsentClient = this.prisma,
  ): Promise<Record<string, boolean | string>> {
    const rows = await client.recipientConsentState.findMany({
      where: { householdId, recipientId },
      select: { scope: true, decision: true },
    });
    const granted = new Map(rows.map((row) => [row.scope, row.decision]));
    const audioRequired = media.receiveDeviceAudio || media.sendFamilyAudio;
    const videoRequired = media.receiveDeviceVideo || media.sendFamilyVideo;
    if (audioRequired && granted.get('REMOTE_ASSISTANCE_AUDIO') !== 'GRANTED') {
      throw new RemoteConsentRequiredException('REMOTE_ASSISTANCE_AUDIO');
    }
    if (videoRequired && granted.get('REMOTE_ASSISTANCE_VIDEO') !== 'GRANTED') {
      throw new RemoteConsentRequiredException('REMOTE_ASSISTANCE_VIDEO');
    }
    return {
      capturedAt: new Date().toISOString(),
      REMOTE_ASSISTANCE_AUDIO:
        granted.get('REMOTE_ASSISTANCE_AUDIO') === 'GRANTED',
      REMOTE_ASSISTANCE_VIDEO:
        granted.get('REMOTE_ASSISTANCE_VIDEO') === 'GRANTED',
      recording: false,
      transcription: false,
    };
  }

  private assertPolicyAllows(
    policy: RemoteAccessPolicy,
    media: RequestedRemoteMedia,
  ): void {
    if (!this.policyAllows(policy, media)) {
      throw new RemoteCallNotAllowedException();
    }
  }

  private policyAllows(
    policy: RemoteAccessPolicy,
    media: RequestedRemoteMedia,
  ): boolean {
    const now = new Date();
    return !(
      policy.status !== 'ACTIVE' ||
      policy.mode !== REMOTE_POLICY_MODE.onsite ||
      policy.validFrom > now ||
      (policy.validUntil && policy.validUntil <= now) ||
      (media.receiveDeviceVideo && !policy.cameraAllowed) ||
      (media.receiveDeviceAudio && !policy.microphoneAllowed) ||
      (media.sendFamilyAudio && !policy.sendFamilyAudioAllowed) ||
      media.sendFamilyVideo
    );
  }

  private async revokeSessionsDisallowedByPolicy(
    policy: RemoteAccessPolicy,
  ): Promise<void> {
    const sessions = await this.prisma.remoteAssistanceSession.findMany({
      where: {
        bindingId: policy.bindingId,
        status: { in: [...OPEN_REMOTE_STATUSES] },
      },
    });
    for (const session of sessions) {
      const media = decodeMedia(session.requestedMedia);
      if (this.policyAllows(policy, media)) {
        continue;
      }
      await this.finishSession(session, {
        targetStatus: REMOTE_SESSION_STATUS.revoked,
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'REMOTE_POLICY_RESTRICTED',
      });
    }
  }

  private async reconcileDisplacedSessions(
    bindingId: string,
    currentSessionId: string,
  ): Promise<void> {
    // This runs only after Redis granted the new owner. Any different durable
    // open session therefore lost its lease and must be closed before a new
    // room can use the device media. Compare-and-delete release prevents the
    // old cleanup from deleting the newly acquired lease.
    const displaced = await this.prisma.remoteAssistanceSession.findMany({
      where: {
        bindingId,
        id: { not: currentSessionId },
        status: { in: [...OPEN_REMOTE_STATUSES] },
      },
    });
    for (const session of displaced) {
      await this.finishSession(session, {
        targetStatus: REMOTE_SESSION_STATUS.failed,
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'MEDIA_LEASE_LOST',
      });
    }
  }

  private async expireOrFailStaleSession(
    session: RemoteAssistanceSession,
    now: Date,
  ): Promise<'EXPIRED' | 'FAILED' | null> {
    const ringTimeoutSeconds = this.timeoutSeconds(
      'REMOTE_RING_TIMEOUT_SECONDS',
      REMOTE_RING_TIMEOUT_SECONDS,
    );
    if (
      session.status === REMOTE_SESSION_STATUS.ringing &&
      session.requestedAt.getTime() + ringTimeoutSeconds * 1_000 <=
        now.getTime()
    ) {
      try {
        const result = await this.finishSession(session, {
          targetStatus: REMOTE_SESSION_STATUS.expired,
          actorType: 'SYSTEM',
          actorId: null,
          reason: 'RING_TIMEOUT',
        });
        return result.status === REMOTE_SESSION_STATUS.expired
          ? REMOTE_SESSION_STATUS.expired
          : null;
      } catch (error) {
        // A device acceptance that wins the optimistic-lock race also wins over
        // the timeout sweep. A later sweep will evaluate its CONNECTING lease.
        if (error instanceof RemoteSessionStateException) {
          return null;
        }
        throw error;
      }
    }

    const connectTimeoutSeconds = this.timeoutSeconds(
      'REMOTE_CONNECT_TIMEOUT_SECONDS',
      REMOTE_CONNECT_TIMEOUT_SECONDS,
    );
    if (
      (session.status === REMOTE_SESSION_STATUS.accepted ||
        session.status === REMOTE_SESSION_STATUS.connecting) &&
      (session.acceptedAt ?? session.requestedAt).getTime() +
        connectTimeoutSeconds * 1_000 <=
        now.getTime()
    ) {
      const result = await this.finishSession(session, {
        targetStatus: REMOTE_SESSION_STATUS.failed,
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'MEDIA_CONNECT_TIMEOUT',
      });
      return result.status === REMOTE_SESSION_STATUS.failed
        ? REMOTE_SESSION_STATUS.failed
        : null;
    }

    const expected = this.leaseOwner(session.id);
    const current = await this.leases.current(session.bindingId);
    if (
      session.status === REMOTE_SESSION_STATUS.ringing &&
      current?.ownerType === 'AI_COMPANION'
    ) {
      return null;
    }
    if (
      session.status === REMOTE_SESSION_STATUS.ringing &&
      current === null &&
      (await this.leases.acquire(
        session.bindingId,
        expected,
        REMOTE_MEDIA_LEASE_TTL_SECONDS,
      ))
    ) {
      return null;
    }
    if (
      !current ||
      current.ownerType !== expected.ownerType ||
      current.ownerId !== expected.ownerId ||
      current.leaseId !== expected.leaseId
    ) {
      const result = await this.finishSession(session, {
        targetStatus: REMOTE_SESSION_STATUS.failed,
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'MEDIA_LEASE_LOST',
      });
      return result.status === REMOTE_SESSION_STATUS.failed
        ? REMOTE_SESSION_STATUS.failed
        : null;
    }
    return null;
  }

  private timeoutSeconds(key: string, fallback: number): number {
    const raw = this.config.get<string | number>(key);
    const parsed = typeof raw === 'number' ? raw : Number(raw);
    return Number.isSafeInteger(parsed) && parsed >= 10 && parsed <= 3_600
      ? parsed
      : fallback;
  }

  private validateMedia(media: RequestedRemoteMedia): void {
    if (
      !media.receiveDeviceAudio ||
      !media.sendFamilyAudio ||
      media.sendFamilyVideo
    ) {
      throw new RemoteMediaInvalidException();
    }
  }

  private requireIdempotencyKey(value: string): string {
    const normalized = value.trim();
    if (
      normalized.length < 8 ||
      normalized.length > 128 ||
      !/^[A-Za-z0-9._:-]+$/.test(normalized)
    ) {
      throw new RemoteIdempotencyKeyException();
    }
    return normalized;
  }

  private assertRemoteReplay(
    session: RemoteAssistanceSession,
    memberId: string,
    bindingId: string,
    media: RequestedRemoteMedia,
  ): void {
    if (
      session.bindingId !== bindingId ||
      session.initiatedByMemberId !== memberId ||
      session.requestedMedia !== encodeMedia(media)
    ) {
      throw new RemoteIdempotencyConflictException();
    }
  }

  private isOnline(lastSeenAt: Date | null): boolean {
    if (!lastSeenAt) {
      return false;
    }
    const threshold =
      this.config.get<number>('DEVICE_ONLINE_THRESHOLD_SECONDS') ?? 120;
    return Date.now() - lastSeenAt.getTime() <= threshold * 1_000;
  }

  private leaseOwner(sessionId: string): MediaLeaseOwner {
    return {
      ownerType: 'REMOTE_ASSISTANCE',
      ownerId: sessionId,
      leaseId: sessionId,
    };
  }

  private async ensureReplayLease(
    session: RemoteAssistanceSession,
  ): Promise<void> {
    if (isRemoteTerminal(session.status)) {
      return;
    }
    const owner = this.leaseOwner(session.id);
    const current = await this.leases.current(session.bindingId);
    if (
      session.status === REMOTE_SESSION_STATUS.ringing &&
      current?.ownerType === 'AI_COMPANION'
    ) {
      return;
    }
    if (
      (await this.leases.renew(
        session.bindingId,
        owner,
        REMOTE_MEDIA_LEASE_TTL_SECONDS,
      )) ||
      (await this.leases.acquire(
        session.bindingId,
        owner,
        REMOTE_MEDIA_LEASE_TTL_SECONDS,
      ))
    ) {
      return;
    }
    throw new RemoteDeviceBusyException();
  }

  private async reserveRemoteLeaseForRequest(
    bindingId: string,
    owner: MediaLeaseOwner,
  ): Promise<'REMOTE_RESERVED' | 'AI_HANDOFF_PENDING'> {
    const current = await this.leases.current(bindingId);
    if (current?.ownerType === 'AI_COMPANION') {
      return 'AI_HANDOFF_PENDING';
    }
    if (
      await this.leases.acquire(
        bindingId,
        owner,
        REMOTE_MEDIA_LEASE_TTL_SECONDS,
      )
    ) {
      return 'REMOTE_RESERVED';
    }
    throw new RemoteDeviceBusyException();
  }

  private async claimRemoteLeaseForAcceptance(
    session: RemoteAssistanceSession,
    owner: MediaLeaseOwner,
  ): Promise<{ claimed: boolean; previousAiOwner: MediaLeaseOwner | null }> {
    const current = await this.leases.current(session.bindingId);
    if (current === null) {
      return {
        claimed: await this.leases.acquire(
          session.bindingId,
          owner,
          REMOTE_MEDIA_LEASE_TTL_SECONDS,
        ),
        previousAiOwner: null,
      };
    }
    if (
      current.ownerType === owner.ownerType &&
      current.ownerId === owner.ownerId &&
      current.leaseId === owner.leaseId
    ) {
      return {
        claimed: await this.leases.renew(
          session.bindingId,
          owner,
          REMOTE_MEDIA_LEASE_TTL_SECONDS,
        ),
        previousAiOwner: null,
      };
    }
    if (current.ownerType !== 'AI_COMPANION') {
      return { claimed: false, previousAiOwner: null };
    }
    const activeAi = await this.prisma.companionSession.findFirst({
      where: {
        id: current.ownerId,
        bindingId: session.bindingId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    if (!activeAi) {
      return { claimed: false, previousAiOwner: null };
    }
    return {
      claimed: await this.leases.transfer(
        session.bindingId,
        current,
        owner,
        REMOTE_MEDIA_LEASE_TTL_SECONDS,
      ),
      previousAiOwner: current,
    };
  }

  private async safeRelease(
    bindingId: string,
    owner: MediaLeaseOwner,
  ): Promise<void> {
    try {
      await this.leases.release(bindingId, owner);
    } catch (error) {
      this.logger.warn(
        `Media lease release deferred (${error instanceof Error ? error.name : 'unknown'})`,
      );
    }
  }

  private async cleanupFinishedSession(
    session: RemoteAssistanceSession,
  ): Promise<void> {
    await this.safeRelease(session.bindingId, this.leaseOwner(session.id));
    let participants: Array<Pick<SessionParticipant, 'id' | 'role'>> = [];
    try {
      participants = await this.prisma.remoteSessionParticipant.findMany({
        where: { sessionId: session.id },
        select: { id: true, role: true },
      });
    } catch (error) {
      this.logger.warn(
        `LiveKit participant cleanup lookup deferred (${error instanceof Error ? error.name : 'unknown'})`,
      );
    }
    for (const participant of participants) {
      await this.safeRemoveParticipant(
        session.livekitRoomName,
        this.participantIdentity(session.id, participant),
      );
    }
    await this.safeDeleteRoom(session.livekitRoomName);
  }

  private async safeRemoveParticipant(
    roomName: string,
    identity: string,
  ): Promise<void> {
    try {
      await this.livekit.removeParticipant(roomName, identity);
    } catch (error) {
      this.logger.warn(
        `LiveKit token revocation deferred (${error instanceof Error ? error.name : 'unknown'})`,
      );
    }
  }

  private async safeDeleteRoom(roomName: string): Promise<void> {
    try {
      await this.livekit.deleteRoom(roomName);
    } catch (error) {
      this.logger.warn(
        `LiveKit room cleanup deferred (${error instanceof Error ? error.name : 'unknown'})`,
      );
    }
  }

  private async appendSessionEvent(
    transaction: Prisma.TransactionClient,
    sessionId: string,
    event: {
      eventType: string;
      actorType: string | null;
      actorId: string | null;
      occurredAt: Date;
      metadata?: Prisma.InputJsonObject;
    },
  ): Promise<void> {
    await transaction.remoteSessionEvent.create({
      data: {
        id: ulid(event.occurredAt.getTime()),
        sessionId,
        eventType: event.eventType,
        actorType: event.actorType,
        actorId: event.actorId,
        metadataJson: event.metadata,
        occurredAt: event.occurredAt,
      },
    });
  }

  private async appendOutbox(
    transaction: Prisma.TransactionClient,
    session: Pick<
      RemoteAssistanceSession,
      'id' | 'householdId' | 'recipientId' | 'bindingId'
    >,
    eventType: string,
    occurredAt: Date,
  ): Promise<void> {
    await transaction.outboxEvent.create({
      data: {
        id: ulid(occurredAt.getTime()),
        aggregateType: 'RemoteAssistanceSession',
        aggregateId: session.id,
        eventType,
        payloadJson: {
          sessionId: session.id,
          householdId: session.householdId,
          recipientId: session.recipientId,
          bindingId: session.bindingId,
        },
        occurredAt,
        availableAt: occurredAt,
      },
    });
  }

  private toPolicyView(policy: RemoteAccessPolicy): RemoteAccessPolicyView {
    return {
      id: policy.id,
      householdId: policy.householdId,
      recipientId: policy.recipientId,
      bindingId: policy.bindingId,
      mode: REMOTE_POLICY_MODE.onsite,
      cameraAllowed: policy.cameraAllowed,
      microphoneAllowed: policy.microphoneAllowed,
      sendFamilyAudioAllowed: policy.sendFamilyAudioAllowed,
      countdownSeconds: policy.countdownSeconds,
      status: policy.status,
      validFrom: policy.validFrom.toISOString(),
      validUntil: policy.validUntil?.toISOString() ?? null,
      version: policy.version,
    };
  }

  private toSessionView(session: RemoteAssistanceSession): RemoteSessionView {
    return {
      id: session.id,
      householdId: session.householdId,
      recipientId: session.recipientId,
      bindingId: session.bindingId,
      initiatedByMemberId: session.initiatedByMemberId,
      answerMode: REMOTE_ANSWER_MODE.onsite,
      media: decodeMedia(session.requestedMedia),
      status: session.status,
      requestedAt: session.requestedAt.toISOString(),
      acceptedAt: session.acceptedAt?.toISOString() ?? null,
      connectedAt: session.connectedAt?.toISOString() ?? null,
      endedAt: session.endedAt?.toISOString() ?? null,
      endReason: session.endReason,
      version: session.version,
    };
  }

  private async serializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (attempt === SERIALIZABLE_RETRIES || !isRetryable(error)) {
          throw error;
        }
      }
    }
    throw new RemoteDeviceBusyException();
  }
}

export function encodeMedia(media: RequestedRemoteMedia): string {
  return String(
    (media.receiveDeviceAudio ? 1 : 0) |
      (media.receiveDeviceVideo ? 2 : 0) |
      (media.sendFamilyAudio ? 4 : 0) |
      (media.sendFamilyVideo ? 8 : 0),
  );
}

export function decodeMedia(value: string): RequestedRemoteMedia {
  const mask = Number(value);
  if (!Number.isSafeInteger(mask) || mask < 0 || mask > 15) {
    throw new RemoteMediaInvalidException();
  }
  return {
    receiveDeviceAudio: (mask & 1) !== 0,
    receiveDeviceVideo: (mask & 2) !== 0,
    sendFamilyAudio: (mask & 4) !== 0,
    sendFamilyVideo: (mask & 8) !== 0,
  };
}

function deterministicSessionId(...parts: string[]): string {
  return deterministicScopedId('remote-session', ...parts);
}

function deterministicScopedId(scope: string, ...parts: string[]): string {
  const digest = createHash('sha256')
    .update(`memory-lighthouse:${scope}:v1\0`)
    .update(parts.join('\0'))
    .digest();
  const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let value = 0n;
  for (const byte of digest.subarray(0, 16)) {
    value = (value << 8n) | BigInt(byte);
  }
  let encoded = '';
  for (let index = 0; index < 26; index += 1) {
    encoded = alphabet[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return encoded;
}

function isPrismaConflict(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function isRetryable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2034'
  );
}
