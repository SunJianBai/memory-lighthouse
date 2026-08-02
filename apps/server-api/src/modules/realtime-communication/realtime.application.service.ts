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
import { CompanionMediaControlService } from '../companion-session/companion-media-control.service';
import { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import { IdentityApplicationService } from '../identity/identity.application.service';
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
  REMOTE_ROOM_PROVISIONING_FENCE_SECONDS,
  REMOTE_ROOM_PROVISIONING_STALE_SECONDS,
  REMOTE_ROOM_PROVISIONING_TRANSACTION_TIMEOUT_MS,
  REMOTE_SESSION_STATUS,
  REMOTE_TERMINATION_TRANSACTION_TIMEOUT_MS,
  TERMINAL_REMOTE_STATUSES,
} from './realtime.constants';
import {
  RemoteCallNotAllowedException,
  RemoteConsentRequiredException,
  RemoteDeviceBusyException,
  RemoteDeviceOfflineException,
  RemoteIdempotencyConflictException,
  RemoteIdempotencyKeyException,
  RemoteJoinTicketAlreadyIssuedException,
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
import { RemoteMediaSecurityCoordinator } from './remote-media-security.coordinator';

const SERIALIZABLE_RETRIES = 3;

class RoomProvisioningUncertainError extends Error {
  constructor(readonly originalError: unknown) {
    super('LiveKit room provisioning outcome is uncertain');
    this.name = 'RoomProvisioningUncertainError';
  }
}

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
  currentPassword: string;
}

@Injectable()
export class RealtimeCommunicationApplicationService {
  private readonly logger = new Logger(
    RealtimeCommunicationApplicationService.name,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly householdAccess: HouseholdAccessPolicy,
    private readonly identity: IdentityApplicationService,
    private readonly companionMedia: CompanionMediaControlService,
    private readonly config: ConfigService,
    @Inject(MEDIA_LEASE_PORT) private readonly leases: MediaLeasePort,
    @Inject(LIVEKIT_PORT) private readonly livekit: LiveKitPort,
    private readonly mediaSecurity: RemoteMediaSecurityCoordinator,
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
    const [currentLease, openSession, cleanupPending] = await Promise.all([
      this.leases.current(bindingId),
      this.prisma.remoteAssistanceSession.findFirst({
        where: {
          bindingId,
          status: { in: [...OPEN_REMOTE_STATUSES] },
        },
        select: { id: true },
      }),
      this.mediaSecurity.hasPendingCleanup(this.prisma, bindingId),
    ]);
    return {
      bindingId,
      online: this.isOnline(binding.device.lastSeenAt),
      // MySQL is the durable source of lifecycle state. Redis is the fast
      // mutual-exclusion path. Reporting either as busy avoids advertising an
      // immediately unusable device while a lost-lease session is reconciled.
      // An AI lease is intentionally callable: RINGING leaves companionship
      // running and onsite acceptance performs the authoritative handoff.
      busy:
        (currentLease !== null && currentLease.ownerType !== 'AI_COMPANION') ||
        openSession !== null ||
        cleanupPending,
      companionActive: currentLease?.ownerType === 'AI_COMPANION',
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
    await this.identity.reauthenticateUser(
      command.principal.userId,
      command.currentPassword,
    );
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
    const now = new Date();
    const updated = await this.serializable(async (transaction) => {
      await this.householdAccess.requireRecipientAction(
        transaction,
        command.principal.userId,
        command.householdId,
        binding.recipientId,
        'MANAGE_RECIPIENT',
      );
      const result = await transaction.remoteAccessPolicy.updateMany({
        where: {
          id: policy.id,
          householdId: command.householdId,
          bindingId: command.bindingId,
          version: command.version,
          status: 'ACTIVE',
        },
        data: {
          // This release deliberately exposes only onsite answer. There is no
          // silent/admin mode and no family-controlled localConfirmedAt.
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
      const current = await transaction.remoteAccessPolicy.findUnique({
        where: { id: policy.id },
      });
      if (!current) {
        throw new RemoteCallNotAllowedException();
      }
      // Any policy edit invalidates the authorization snapshot for existing
      // rooms. Mark those sessions terminal in the same commit so a crash
      // cannot leave admitted media under the previous policy.
      await this.mediaSecurity.markBindingRevoked(
        transaction,
        binding.id,
        'REMOTE_POLICY_CHANGED',
        now,
      );
      return current;
    });
    await this.mediaSecurity.cleanupPendingForBinding(binding.id);
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
      return this.toSessionView(await this.ensureReplayLease(replay));
    }

    if (await this.mediaSecurity.hasPendingCleanup(this.prisma, binding.id)) {
      throw new RemoteDeviceBusyException();
    }

    const leaseOwner = this.leaseOwner(sessionId);
    const reservation = await this.reserveRemoteLeaseForRequest(
      binding.id,
      leaseOwner,
    );
    const now = new Date();
    try {
      if (reservation === 'REMOTE_RESERVED') {
        // Only a caller that actually owns the Redis lease may reconcile a
        // stale durable session. AI_HANDOFF_PENDING deliberately leaves the
        // companion owner in place while the first onsite call rings.
        await this.reconcileDisplacedSessions(binding.id, sessionId);
      }
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
        if (
          await this.mediaSecurity.hasPendingCleanup(transaction, binding.id)
        ) {
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
      if (
        reservation === 'REMOTE_RESERVED' &&
        isRemoteTerminal(created.status)
      ) {
        await this.safeRelease(binding.id, leaseOwner);
        await this.cleanupFinishedSession(created);
      }
      return this.toSessionView(created);
    } catch (error) {
      if (reservation === 'REMOTE_RESERVED') {
        await this.releaseProvisionalRemoteLeaseIfUnowned(
          binding.id,
          sessionId,
        );
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
    const isAcceptedReplay = [
      REMOTE_SESSION_STATUS.accepted,
      REMOTE_SESSION_STATUS.connecting,
      REMOTE_SESSION_STATUS.active,
    ].includes(session.status as never);
    if (!isAcceptedReplay) {
      assertRemoteTransition(session.status, REMOTE_SESSION_STATUS.accepted);
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
    if (isAcceptedReplay) {
      const owner = this.leaseOwner(session.id);
      if (
        !(await this.leases.renew(
          session.bindingId,
          owner,
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
      const confirmed = await this.prisma.remoteAssistanceSession.findUnique({
        where: { id: session.id },
      });
      if (!confirmed) {
        await this.safeRelease(session.bindingId, owner);
        throw new RemoteSessionNotFoundException();
      }
      if (
        [
          REMOTE_SESSION_STATUS.accepted,
          REMOTE_SESSION_STATUS.connecting,
          REMOTE_SESSION_STATUS.active,
        ].includes(confirmed.status as never)
      ) {
        return this.toSessionView(confirmed);
      }
      if (isRemoteTerminal(confirmed.status)) {
        await this.cleanupFinishedSession(confirmed);
      }
      throw new RemoteSessionStateException([
        REMOTE_SESSION_STATUS.accepted,
        REMOTE_SESSION_STATUS.connecting,
        REMOTE_SESSION_STATUS.active,
      ]);
    }
    const owner = this.leaseOwner(session.id);
    const handoff = await this.claimRemoteLeaseForAcceptance(session, owner);
    if (!handoff.claimed) {
      // An AI start may have acquired its provisional lease but not committed
      // the durable CompanionSession yet. Preserve the ringing call and let a
      // short client retry observe either the committed AI owner (transfer) or
      // the rolled-back lease (acquire); never terminalize a valid call from
      // this transient cross-store window.
      throw new RemoteDeviceBusyException();
    }
    const now = new Date();
    let updated: RemoteAssistanceSession | null;
    try {
      updated = await this.serializable(async (transaction) => {
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
        await this.companionMedia.interruptForRemoteAssistance(
          transaction,
          session.bindingId,
          now,
        );
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
      if (error instanceof RemoteSessionStateException) {
        try {
          const acceptedReplay =
            await this.prisma.remoteAssistanceSession.findUnique({
              where: { id: session.id },
            });
          if (
            acceptedReplay &&
            [
              REMOTE_SESSION_STATUS.accepted,
              REMOTE_SESSION_STATUS.connecting,
              REMOTE_SESSION_STATUS.active,
            ].includes(acceptedReplay.status as never)
          ) {
            // The same device can deliver an answer through both the page and
            // native call surface. A concurrent database-CAS winner owns the
            // deterministic remote lease, so this delivery is an idempotent
            // replay rather than a failed answer.
            return this.toSessionView(acceptedReplay);
          }
        } catch (lookupError) {
          this.logger.warn(
            `Concurrent acceptance replay lookup deferred (${lookupError instanceof Error ? lookupError.name : 'unknown'})`,
          );
        }
      }
      const acceptanceLeaseReleased =
        await this.releaseAcceptanceLeaseIfUnowned(session, owner);
      if (acceptanceLeaseReleased && handoff.previousAiOwner) {
        await this.restoreAiLeaseIfStillActive(
          session.bindingId,
          handoff.previousAiOwner,
        );
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
      where: {
        OR: [
          { status: { in: [...OPEN_REMOTE_STATUSES] } },
          {
            status: { in: [...TERMINAL_REMOTE_STATUSES] },
            roomCleanupStatus: 'PENDING',
          },
        ],
      },
      orderBy: { requestedAt: 'asc' },
    });
    let expired = 0;
    let failed = 0;
    for (const session of sessions) {
      if (isRemoteTerminal(session.status)) {
        await this.cleanupFinishedSession(session);
        continue;
      }
      const staleProvisioningBefore = new Date(
        now.getTime() - REMOTE_ROOM_PROVISIONING_STALE_SECONDS * 1_000,
      );
      await this.releaseStaleUnmintedJoinTicketReservations(
        session.id,
        staleProvisioningBefore,
      );
      const provisioningRecovery = await this.finishSession(session, {
        targetStatus: REMOTE_SESSION_STATUS.failed,
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'ROOM_PROVISIONING_STALLED',
        roomCleanupNotBefore: new Date(
          now.getTime() + REMOTE_ROOM_PROVISIONING_FENCE_SECONDS * 1_000,
        ),
        onlyIfStaleProvisioningBefore: staleProvisioningBefore,
      });
      if (isRemoteTerminal(provisioningRecovery.status)) {
        if (
          provisioningRecovery.status === REMOTE_SESSION_STATUS.failed &&
          provisioningRecovery.endReason === 'ROOM_PROVISIONING_STALLED'
        ) {
          failed += 1;
        }
        continue;
      }
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

    const ticketId = ulid();
    const ticketIssuedAt = new Date();
    const reserved = await this.prisma.remoteSessionParticipant.updateMany({
      where: { id: row.id, joinTicketStatus: null },
      data: {
        joinTicketId: ticketId,
        joinTicketStatus: 'ISSUING',
        joinTicketIssuedAt: ticketIssuedAt,
      },
    });
    if (reserved.count !== 1) {
      throw new RemoteJoinTicketAlreadyIssuedException();
    }

    const family = participant.role === 'FAMILY';
    const identity = this.participantIdentity(session.id, row);
    let ticket: Awaited<ReturnType<LiveKitPort['issueJoinTicket']>>;
    try {
      await this.requirePersistedSessionMayMintJoinTicket(session.id);
    } catch (error) {
      await this.releaseUnmintedJoinTicketReservation(row.id, ticketId);
      throw error;
    }
    try {
      await this.ensureRoomWhileSessionOpen(session.id, row.id, ticketId);
    } catch (error) {
      if (error instanceof RoomProvisioningUncertainError) {
        // FAILED + durable cleanup fence + revocation of every participant
        // ticket are committed by finishSession as one locked transaction.
        // A stale PROVISIONING row also lets the expiry runner recover a process
        // crash that occurs before this compensation starts.
        await this.finishSession(session, {
          targetStatus: REMOTE_SESSION_STATUS.failed,
          actorType: 'SYSTEM',
          actorId: null,
          reason: 'MEDIA_PROVIDER_UNAVAILABLE',
          roomCleanupNotBefore: new Date(
            Date.now() + REMOTE_ROOM_PROVISIONING_FENCE_SECONDS * 1_000,
          ),
        });
        throw error.originalError;
      }
      if (error instanceof RemoteSessionStateException) {
        await this.revokeReservedJoinTicket(row.id, ticketId);
        await this.finishSession(session, {
          targetStatus: REMOTE_SESSION_STATUS.failed,
          actorType: 'SYSTEM',
          actorId: null,
          reason: 'JOIN_AUTHORITY_LOST',
        });
      } else {
        await this.releaseUnmintedJoinTicketReservation(row.id, ticketId);
      }
      throw error;
    }
    try {
      // Room creation is an external call and can race with hang-up or
      // revocation. Re-read durable state before minting and remove a room
      // that lost that race, so a terminal session cannot recreate media.
      await this.requirePersistedSessionMayMintJoinTicket(session.id);
    } catch (error) {
      if (
        error instanceof RemoteSessionStateException ||
        error instanceof RemoteCallNotAllowedException
      ) {
        await this.revokeReservedJoinTicket(row.id, ticketId);
        // The durable read conclusively says this session may no longer own a
        // room. Drive it through the unified terminal cleanup instead of
        // deleting a shared room from a transient database-error path.
        try {
          await this.finishSession(session, {
            targetStatus: REMOTE_SESSION_STATUS.failed,
            actorType: 'SYSTEM',
            actorId: null,
            reason: 'JOIN_AUTHORITY_LOST',
          });
        } catch (cleanupError) {
          this.logger.warn(
            `Invalid join provisioning cleanup deferred (${cleanupError instanceof Error ? cleanupError.name : 'unknown'})`,
          );
        }
      } else if (error instanceof RemoteSessionNotFoundException) {
        await this.revokeReservedJoinTicket(row.id, ticketId);
        await this.safeDeleteRoom(session.livekitRoomName);
      } else {
        // No JWT has been minted yet. Roll back only this participant's
        // reservation so a transient database read cannot strand the open
        // two-party call or consume its one-time admission forever.
        await this.releaseUnmintedJoinTicketReservation(row.id, ticketId);
      }
      throw error;
    }
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
          ticketId,
          role: participant.role,
          recording: 'false',
          transcription: 'false',
        },
      });
    } catch (error) {
      await this.revokeReservedJoinTicket(row.id, ticketId);
      await this.finishSession(session, {
        targetStatus: REMOTE_SESSION_STATUS.failed,
        actorType: 'SYSTEM',
        actorId: null,
        reason: 'MEDIA_PROVIDER_UNAVAILABLE',
      });
      throw error;
    }
    const issued = await this.prisma.remoteSessionParticipant.updateMany({
      where: {
        id: row.id,
        joinTicketId: ticketId,
        joinTicketStatus: 'ROOM_READY',
      },
      data: {
        joinTicketStatus: 'ISSUED',
        joinTicketIssuedAt: new Date(),
        joinTicketExpiresAt: ticket.expiresAt,
      },
    });
    if (issued.count !== 1) {
      await this.revokeReservedJoinTicket(row.id, ticketId);
      // The JWT is returned only after this durable transition succeeds, so a
      // losing pre-delivery attempt cannot have admitted a client. Do not
      // remove the deterministic participant identity here: a stale
      // ROOM_READY reservation may already have been safely reset and reused
      // by a newer attempt in the same still-open room.
      throw new RemoteSessionStateException([
        REMOTE_SESSION_STATUS.connecting,
        REMOTE_SESSION_STATUS.active,
      ]);
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
      await this.revokeReservedJoinTicket(row.id, ticketId);
      if (!(await this.safeDeleteRoom(session.livekitRoomName))) {
        await this.safeRemoveParticipant(session.livekitRoomName, identity);
      }
      throw new RemoteSessionStateException([
        REMOTE_SESSION_STATUS.connecting,
        REMOTE_SESSION_STATUS.active,
      ]);
    }
    return {
      sessionId: session.id,
      ticketId,
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

  private async revokeReservedJoinTicket(
    participantId: string,
    ticketId: string,
  ): Promise<void> {
    await this.prisma.remoteSessionParticipant.updateMany({
      where: {
        id: participantId,
        joinTicketId: ticketId,
        joinTicketStatus: {
          in: ['ISSUING', 'PROVISIONING', 'ROOM_READY', 'ISSUED'],
        },
      },
      data: {
        joinTicketStatus: 'REVOKED',
        joinTicketRevokedAt: new Date(),
      },
    });
  }

  private async releaseUnmintedJoinTicketReservation(
    participantId: string,
    ticketId: string,
  ): Promise<void> {
    await this.prisma.remoteSessionParticipant.updateMany({
      where: {
        id: participantId,
        joinTicketId: ticketId,
        joinTicketStatus: {
          in: ['ISSUING', 'PROVISIONING', 'ROOM_READY'],
        },
      },
      data: {
        joinTicketId: null,
        joinTicketStatus: null,
        joinTicketIssuedAt: null,
        joinTicketExpiresAt: null,
      },
    });
  }

  private async ensureRoomWhileSessionOpen(
    sessionId: string,
    participantId: string,
    ticketId: string,
  ): Promise<void> {
    let provisioningStarted = false;
    try {
      const claim = await this.serializable(
        async (transaction) => {
          await this.lockRemoteSession(transaction, sessionId);
          const current = await transaction.remoteAssistanceSession.findUnique({
            where: { id: sessionId },
          });
          if (
            !current ||
            ![
              REMOTE_SESSION_STATUS.accepted,
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

          // Lock the session before choosing a room-provisioning owner. Only
          // one participant may enter PROVISIONING; every other ticket stays
          // ISSUING and fails transiently. This prevents two first-ticket
          // requests from launching provider calls whose late completions
          // could straddle terminal cleanup.
          if (current.roomProvisionedAt) {
            const ready = await transaction.remoteSessionParticipant.updateMany(
              {
                where: {
                  id: participantId,
                  sessionId,
                  joinTicketId: ticketId,
                  joinTicketStatus: 'ISSUING',
                },
                data: {
                  joinTicketStatus: 'ROOM_READY',
                  joinTicketIssuedAt: new Date(),
                },
              },
            );
            if (ready.count !== 1) {
              throw new RemoteSessionStateException([
                REMOTE_SESSION_STATUS.accepted,
                REMOTE_SESSION_STATUS.connecting,
                REMOTE_SESSION_STATUS.active,
              ]);
            }
            return {
              shouldProvision: false,
              roomName: current.livekitRoomName,
            };
          }
          const owner = await transaction.remoteSessionParticipant.findFirst({
            where: { sessionId, joinTicketStatus: 'PROVISIONING' },
            select: { id: true },
          });
          if (owner && owner.id !== participantId) {
            throw new RemoteDeviceBusyException();
          }
          if (!owner) {
            const reserved =
              await transaction.remoteSessionParticipant.updateMany({
                where: {
                  id: participantId,
                  sessionId,
                  joinTicketId: ticketId,
                  joinTicketStatus: 'ISSUING',
                },
                data: {
                  joinTicketStatus: 'PROVISIONING',
                  // This column is the durable age marker for every
                  // pre-delivery saga state. Refresh it at each boundary.
                  joinTicketIssuedAt: new Date(),
                },
              });
            if (reserved.count !== 1) {
              throw new RemoteSessionStateException([
                REMOTE_SESSION_STATUS.accepted,
                REMOTE_SESSION_STATUS.connecting,
                REMOTE_SESSION_STATUS.active,
              ]);
            }
          }
          return { shouldProvision: true, roomName: current.livekitRoomName };
        },
        { timeout: REMOTE_ROOM_PROVISIONING_TRANSACTION_TIMEOUT_MS },
      );
      if (!claim.shouldProvision) {
        return;
      }

      provisioningStarted = true;
      await this.livekit.ensureRoom(claim.roomName);

      await this.serializable(
        async (transaction) => {
          await this.lockRemoteSession(transaction, sessionId);
          const current = await transaction.remoteAssistanceSession.findUnique({
            where: { id: sessionId },
          });
          if (
            !current ||
            ![
              REMOTE_SESSION_STATUS.accepted,
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
          const ready = await transaction.remoteSessionParticipant.updateMany({
            where: {
              id: participantId,
              sessionId,
              joinTicketId: ticketId,
              joinTicketStatus: 'PROVISIONING',
            },
            data: {
              joinTicketStatus: 'ROOM_READY',
              joinTicketIssuedAt: new Date(),
            },
          });
          if (ready.count !== 1) {
            throw new RemoteSessionStateException([
              REMOTE_SESSION_STATUS.accepted,
              REMOTE_SESSION_STATUS.connecting,
              REMOTE_SESSION_STATUS.active,
            ]);
          }
          const confirmed =
            await transaction.remoteAssistanceSession.updateMany({
              where: {
                id: current.id,
                status: current.status,
                version: current.version,
                roomProvisionedAt: null,
              },
              data: {
                roomProvisionedAt: new Date(),
                version: { increment: 1 },
              },
            });
          if (confirmed.count !== 1) {
            throw new RemoteSessionStateException([
              REMOTE_SESSION_STATUS.accepted,
              REMOTE_SESSION_STATUS.connecting,
              REMOTE_SESSION_STATUS.active,
            ]);
          }
        },
        { timeout: REMOTE_ROOM_PROVISIONING_TRANSACTION_TIMEOUT_MS },
      );
    } catch (error) {
      if (provisioningStarted) {
        throw new RoomProvisioningUncertainError(error);
      }
      throw error;
    }
  }

  private async requirePersistedSessionMayMintJoinTicket(
    sessionId: string,
  ): Promise<void> {
    const current = await this.prisma.remoteAssistanceSession.findUnique({
      where: { id: sessionId },
      select: {
        status: true,
        answerMode: true,
        acceptedAt: true,
      },
    });
    if (!current) {
      throw new RemoteSessionNotFoundException();
    }
    if (
      ![
        REMOTE_SESSION_STATUS.accepted,
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
    if (
      current.answerMode !== REMOTE_ANSWER_MODE.onsite ||
      !current.acceptedAt
    ) {
      throw new RemoteCallNotAllowedException();
    }
  }

  private async applyLiveKitEvent(
    session: SessionWithParticipants,
    event: VerifiedLiveKitWebhook,
  ): Promise<void> {
    const participant = event.participantIdentity
      ? this.findParticipantByIdentity(session, event.participantIdentity)
      : null;
    if (event.event === 'participant_joined') {
      if (
        !participant ||
        !event.participantIdentity ||
        !this.webhookMatchesIssuedTicket(participant, event)
      ) {
        if (event.participantIdentity) {
          await this.safeRemoveParticipant(
            session.livekitRoomName,
            event.participantIdentity,
          );
        }
        return;
      }

      let admitted = this.isOriginalConsumedJoin(participant, event);
      if (!admitted && participant.joinTicketStatus === 'ISSUED') {
        const consumed = await this.prisma.remoteSessionParticipant.updateMany({
          where: {
            id: participant.id,
            joinedAt: null,
            leftAt: null,
            joinTicketId: event.participantTicketId!,
            joinTicketStatus: 'ISSUED',
            joinTicketExpiresAt: { gte: event.occurredAt },
            OR: [
              { livekitParticipantSid: null },
              { livekitParticipantSid: event.participantSid },
            ],
          },
          data: {
            joinedAt: event.occurredAt,
            joinTicketStatus: 'CONSUMED',
            joinTicketConsumedAt: event.occurredAt,
            joinTicketConsumedEventId: event.eventId,
            livekitParticipantSid: event.participantSid,
          },
        });
        admitted = consumed.count === 1;
        if (!admitted) {
          // Concurrent delivery of the same signed webhook can lose the
          // ISSUED -> CONSUMED compare-and-swap. Re-read to distinguish that
          // harmless retry from a second physical connection using the JWT.
          const current = await this.prisma.remoteSessionParticipant.findUnique(
            {
              where: { id: participant.id },
            },
          );
          admitted = Boolean(
            current && this.isOriginalConsumedJoin(current, event),
          );
        }
      }
      if (!admitted) {
        await this.safeRemoveParticipant(
          session.livekitRoomName,
          event.participantIdentity,
        );
        return;
      }
    } else if (event.event === 'track_published' && participant) {
      if (
        !(await this.reserveOrMatchParticipantConnection(participant, event))
      ) {
        if (event.participantIdentity) {
          await this.safeRemoveParticipant(
            session.livekitRoomName,
            event.participantIdentity,
          );
        }
        return;
      }
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
      if (
        !(await this.reserveOrMatchParticipantConnection(participant, event))
      ) {
        if (event.participantIdentity) {
          await this.safeRemoveParticipant(
            session.livekitRoomName,
            event.participantIdentity,
          );
        }
        return;
      }
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
    } else if (
      ['participant_left', 'participant_connection_aborted'].includes(
        event.event,
      ) &&
      participant
    ) {
      // A rejected replay has the same identity but a different SID. Its
      // subsequent leave webhook must not terminate the legitimate call.
      if (
        !(await this.reserveOrMatchParticipantConnection(participant, event))
      ) {
        return;
      }
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

  private webhookMatchesIssuedTicket(
    participant: SessionParticipant,
    event: VerifiedLiveKitWebhook,
  ): boolean {
    return Boolean(
      event.eventId &&
      event.participantSid &&
      event.participantId === participant.id &&
      event.participantTicketId &&
      event.participantTicketId === participant.joinTicketId,
    );
  }

  private isOriginalConsumedJoin(
    participant: SessionParticipant,
    event: VerifiedLiveKitWebhook,
  ): boolean {
    return Boolean(
      this.webhookMatchesIssuedTicket(participant, event) &&
      participant.joinTicketStatus === 'CONSUMED' &&
      participant.joinedAt &&
      !participant.leftAt &&
      participant.joinTicketConsumedEventId === event.eventId &&
      participant.livekitParticipantSid === event.participantSid,
    );
  }

  private isEventFromAdmittedConnection(
    participant: SessionParticipant,
    event: VerifiedLiveKitWebhook,
  ): boolean {
    return Boolean(
      this.webhookMatchesIssuedTicket(participant, event) &&
      participant.joinTicketStatus === 'CONSUMED' &&
      participant.joinedAt &&
      !participant.leftAt &&
      participant.livekitParticipantSid === event.participantSid,
    );
  }

  private async reserveOrMatchParticipantConnection(
    participant: SessionParticipant,
    event: VerifiedLiveKitWebhook,
  ): Promise<boolean> {
    if (this.isEventFromAdmittedConnection(participant, event)) {
      return true;
    }
    if (!this.webhookMatchesIssuedTicket(participant, event)) {
      return false;
    }
    if (this.isEventFromReservedConnection(participant, event)) {
      return true;
    }
    if (
      participant.joinTicketStatus !== 'ISSUED' ||
      participant.joinedAt ||
      participant.leftAt ||
      participant.livekitParticipantSid ||
      !participant.joinTicketExpiresAt ||
      participant.joinTicketExpiresAt < event.occurredAt
    ) {
      return false;
    }

    const reserved = await this.prisma.remoteSessionParticipant.updateMany({
      where: {
        id: participant.id,
        joinedAt: null,
        leftAt: null,
        joinTicketId: event.participantTicketId!,
        joinTicketStatus: 'ISSUED',
        joinTicketExpiresAt: { gte: event.occurredAt },
        livekitParticipantSid: null,
      },
      data: { livekitParticipantSid: event.participantSid },
    });
    if (reserved.count === 1) {
      return true;
    }

    const current = await this.prisma.remoteSessionParticipant.findUnique({
      where: { id: participant.id },
    });
    return Boolean(
      current &&
      (this.isEventFromReservedConnection(current, event) ||
        this.isEventFromAdmittedConnection(current, event)),
    );
  }

  private isEventFromReservedConnection(
    participant: SessionParticipant,
    event: VerifiedLiveKitWebhook,
  ): boolean {
    return Boolean(
      this.webhookMatchesIssuedTicket(participant, event) &&
      participant.joinTicketStatus === 'ISSUED' &&
      !participant.joinedAt &&
      !participant.leftAt &&
      participant.joinTicketExpiresAt &&
      participant.joinTicketExpiresAt >= event.occurredAt &&
      participant.livekitParticipantSid === event.participantSid,
    );
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
      roomCleanupNotBefore?: Date;
      onlyIfStaleProvisioningBefore?: Date;
      onlyIfCurrentStatusIn?: readonly string[];
      onlyIfRequestedAtOrBefore?: Date;
      onlyIfAcceptedOrRequestedAtOrBefore?: Date;
    },
  ): Promise<RemoteSessionView> {
    const now = new Date();
    const ended = await this.serializable(
      async (transaction) => {
        // Use an explicit exclusive lock: a plain MySQL SERIALIZABLE SELECT is
        // only a shared next-key read and cannot linearize two lock-upgrading
        // claim/termination transactions.
        await this.lockRemoteSession(transaction, session.id);
        const current = await transaction.remoteAssistanceSession.findUnique({
          where: { id: session.id },
        });
        if (!current) {
          throw new RemoteSessionNotFoundException();
        }
        if (
          command.onlyIfCurrentStatusIn &&
          !command.onlyIfCurrentStatusIn.includes(current.status)
        ) {
          return current;
        }
        if (
          command.onlyIfRequestedAtOrBefore &&
          current.requestedAt > command.onlyIfRequestedAtOrBefore
        ) {
          return current;
        }
        if (
          command.onlyIfAcceptedOrRequestedAtOrBefore &&
          (current.acceptedAt ?? current.requestedAt) >
            command.onlyIfAcceptedOrRequestedAtOrBefore
        ) {
          return current;
        }
        const roomProvisioning =
          await transaction.remoteSessionParticipant.findFirst({
            where: {
              sessionId: current.id,
              joinTicketStatus: 'PROVISIONING',
              ...(command.onlyIfStaleProvisioningBefore
                ? {
                    joinTicketIssuedAt: {
                      lte: command.onlyIfStaleProvisioningBefore,
                    },
                  }
                : {}),
            },
            select: { id: true },
          });
        // The stale observation and the terminal transition must share these
        // locks. A normal provisioning request that reaches ROOM_READY first
        // wins; the runner then performs a no-op instead of killing a healthy
        // call based on an earlier, non-locking read.
        if (command.onlyIfStaleProvisioningBefore && !roomProvisioning) {
          return current;
        }
        const requestedCleanupNotBefore = roomProvisioning
          ? new Date(
              now.getTime() + REMOTE_ROOM_PROVISIONING_FENCE_SECONDS * 1_000,
            )
          : command.roomCleanupNotBefore;
        const cleanupNotBefore = requestedCleanupNotBefore
          ? current.roomCleanupNotBefore &&
            current.roomCleanupNotBefore > requestedCleanupNotBefore
            ? current.roomCleanupNotBefore
            : requestedCleanupNotBefore
          : current.roomCleanupNotBefore;
        if (isRemoteTerminal(current.status)) {
          if (!requestedCleanupNotBefore) {
            return current;
          }
          const fenced = await transaction.remoteAssistanceSession.updateMany({
            where: { id: current.id, version: current.version },
            data: {
              roomCleanupStatus: 'PENDING',
              roomCleanupCompletedAt: null,
              roomCleanupNotBefore: cleanupNotBefore,
              version: { increment: 1 },
            },
          });
          if (fenced.count !== 1) {
            throw new RemoteSessionStateException([current.status]);
          }
          await transaction.remoteSessionParticipant.updateMany({
            where: {
              sessionId: current.id,
              joinTicketStatus: {
                in: [
                  'ISSUING',
                  'PROVISIONING',
                  'ROOM_READY',
                  'ISSUED',
                  'CONSUMED',
                ],
              },
            },
            data: {
              joinTicketStatus: 'REVOKED',
              joinTicketRevokedAt: now,
            },
          });
          const persisted =
            await transaction.remoteAssistanceSession.findUnique({
              where: { id: current.id },
            });
          if (!persisted) {
            throw new RemoteSessionNotFoundException();
          }
          return persisted;
        }
        const target = this.resolveTerminalTarget(
          current.status,
          command.targetStatus,
        );
        assertRemoteTransition(current.status, target);
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
            ...(requestedCleanupNotBefore
              ? {
                  roomCleanupStatus: 'PENDING',
                  roomCleanupCompletedAt: null,
                  roomCleanupNotBefore: cleanupNotBefore,
                }
              : {}),
            version: { increment: 1 },
          },
        });
        if (changed.count !== 1) {
          // A changed row while we hold its SERIALIZABLE lock indicates an
          // invariant/storage violation; never guess at a terminal result.
          throw new RemoteSessionStateException([current.status]);
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
        await transaction.remoteSessionParticipant.updateMany({
          where: {
            sessionId: current.id,
            joinTicketStatus: {
              in: [
                'ISSUING',
                'PROVISIONING',
                'ROOM_READY',
                'ISSUED',
                'CONSUMED',
              ],
            },
          },
          data: {
            joinTicketStatus: 'REVOKED',
            joinTicketRevokedAt: now,
          },
        });
        const persisted = await transaction.remoteAssistanceSession.findUnique({
          where: { id: current.id },
        });
        if (!persisted) {
          throw new RemoteSessionNotFoundException();
        }
        return persisted;
      },
      { timeout: REMOTE_TERMINATION_TRANSACTION_TIMEOUT_MS },
    );
    if (isRemoteTerminal(ended.status)) {
      await this.cleanupFinishedSession(ended);
    }
    return this.toSessionView(ended);
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
    try {
      await this.requireCurrentSessionEligibilityOrRevoke(session);
    } catch (error) {
      if (
        error instanceof ForbiddenException ||
        error instanceof RemoteMediaInvalidException
      ) {
        return null;
      }
      throw error;
    }
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
          onlyIfCurrentStatusIn: [REMOTE_SESSION_STATUS.ringing],
          onlyIfRequestedAtOrBefore: new Date(
            now.getTime() - ringTimeoutSeconds * 1_000,
          ),
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
        onlyIfCurrentStatusIn: [
          REMOTE_SESSION_STATUS.accepted,
          REMOTE_SESSION_STATUS.connecting,
        ],
        onlyIfAcceptedOrRequestedAtOrBefore: new Date(
          now.getTime() - connectTimeoutSeconds * 1_000,
        ),
      });
      return result.status === REMOTE_SESSION_STATUS.failed
        ? REMOTE_SESSION_STATUS.failed
        : null;
    }

    const expected = this.leaseOwner(session.id);
    let current = await this.leases.current(session.bindingId);
    if (
      session.status === REMOTE_SESSION_STATUS.ringing &&
      current?.ownerType === 'AI_COMPANION'
    ) {
      return null;
    }
    if (session.status === REMOTE_SESSION_STATUS.ringing && current === null) {
      if (
        await this.leases.acquire(
          session.bindingId,
          expected,
          REMOTE_MEDIA_LEASE_TTL_SECONDS,
        )
      ) {
        return null;
      }
      // The initial empty read and failed acquire are not one atomic
      // observation. Another request may have restored the AI owner or the
      // expected remote owner between them; re-read before terminalizing.
      current = await this.leases.current(session.bindingId);
      if (current?.ownerType === 'AI_COMPANION') {
        return null;
      }
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

  private async releaseStaleUnmintedJoinTicketReservations(
    sessionId: string,
    staleBefore: Date,
  ): Promise<void> {
    // Neither ISSUING nor ROOM_READY can have returned a JWT to a client. A
    // compare-and-set reset therefore makes process-crash recovery retryable;
    // a live request that advances first wins the same status predicate.
    await this.prisma.remoteSessionParticipant.updateMany({
      where: {
        sessionId,
        joinTicketStatus: { in: ['ISSUING', 'ROOM_READY'] },
        joinTicketIssuedAt: { lte: staleBefore },
      },
      data: {
        joinTicketId: null,
        joinTicketStatus: null,
        joinTicketIssuedAt: null,
        joinTicketExpiresAt: null,
      },
    });
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
  ): Promise<RemoteAssistanceSession> {
    const currentSession = await this.prisma.remoteAssistanceSession.findUnique(
      {
        where: { id: session.id },
      },
    );
    if (!currentSession) {
      throw new RemoteSessionNotFoundException();
    }
    if (isRemoteTerminal(currentSession.status)) {
      await this.cleanupFinishedSession(currentSession);
      return currentSession;
    }
    const owner = this.leaseOwner(currentSession.id);
    const current = await this.leases.current(currentSession.bindingId);
    if (
      currentSession.status === REMOTE_SESSION_STATUS.ringing &&
      current?.ownerType === 'AI_COMPANION'
    ) {
      return this.confirmReplayStillOpen(currentSession, owner, false);
    }
    const claimed =
      (await this.leases.renew(
        currentSession.bindingId,
        owner,
        REMOTE_MEDIA_LEASE_TTL_SECONDS,
      )) ||
      (await this.leases.acquire(
        currentSession.bindingId,
        owner,
        REMOTE_MEDIA_LEASE_TTL_SECONDS,
      ));
    if (!claimed) {
      throw new RemoteDeviceBusyException();
    }
    return this.confirmReplayStillOpen(currentSession, owner, true);
  }

  private async confirmReplayStillOpen(
    session: RemoteAssistanceSession,
    owner: MediaLeaseOwner,
    releaseIfTerminal: boolean,
  ): Promise<RemoteAssistanceSession> {
    const confirmed = await this.prisma.remoteAssistanceSession.findUnique({
      where: { id: session.id },
    });
    if (!confirmed) {
      if (releaseIfTerminal) {
        await this.safeRelease(session.bindingId, owner);
      }
      throw new RemoteSessionNotFoundException();
    }
    if (isRemoteTerminal(confirmed.status)) {
      if (releaseIfTerminal) {
        await this.safeRelease(session.bindingId, owner);
      }
      await this.cleanupFinishedSession(confirmed);
    }
    return confirmed;
  }

  private async reserveRemoteLeaseForRequest(
    bindingId: string,
    owner: MediaLeaseOwner,
  ): Promise<'REMOTE_RESERVED' | 'AI_HANDOFF_PENDING'> {
    const current = await this.leases.current(bindingId);
    if (current?.ownerType === 'AI_COMPANION') {
      if (
        !(await this.companionMedia.isActiveLeaseOwner(
          bindingId,
          current.ownerId,
        ))
      ) {
        // The AI lease is provisional (or stale) and cannot yet authorize a
        // durable ringing call. A retry after its bounded transaction window
        // will either see a committed AI session or an available lease.
        throw new RemoteDeviceBusyException();
      }
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
    for (let attempt = 1; attempt <= SERIALIZABLE_RETRIES; attempt += 1) {
      const current = await this.leases.current(session.bindingId);
      if (current === null) {
        if (
          await this.leases.acquire(
            session.bindingId,
            owner,
            REMOTE_MEDIA_LEASE_TTL_SECONDS,
          )
        ) {
          return { claimed: true, previousAiOwner: null };
        }
        // Empty-read + failed-acquire is not atomic. Re-read on the next
        // iteration so a concurrent AI or same-remote winner is classified.
        continue;
      }
      if (
        current.ownerType === owner.ownerType &&
        current.ownerId === owner.ownerId &&
        current.leaseId === owner.leaseId
      ) {
        if (
          await this.leases.renew(
            session.bindingId,
            owner,
            REMOTE_MEDIA_LEASE_TTL_SECONDS,
          )
        ) {
          return { claimed: true, previousAiOwner: null };
        }
        continue;
      }
      if (current.ownerType !== 'AI_COMPANION') {
        return { claimed: false, previousAiOwner: null };
      }
      if (
        !(await this.companionMedia.isActiveLeaseOwner(
          session.bindingId,
          current.ownerId,
        ))
      ) {
        return { claimed: false, previousAiOwner: null };
      }
      if (
        await this.leases.transfer(
          session.bindingId,
          current,
          owner,
          REMOTE_MEDIA_LEASE_TTL_SECONDS,
        )
      ) {
        return { claimed: true, previousAiOwner: current };
      }
    }
    return { claimed: false, previousAiOwner: null };
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

  private async releaseAcceptanceLeaseIfUnowned(
    session: RemoteAssistanceSession,
    owner: MediaLeaseOwner,
  ): Promise<boolean> {
    try {
      const current = await this.prisma.remoteAssistanceSession.findUnique({
        where: { id: session.id },
      });
      if (
        current &&
        [
          REMOTE_SESSION_STATUS.accepted,
          REMOTE_SESSION_STATUS.connecting,
          REMOTE_SESSION_STATUS.active,
          REMOTE_SESSION_STATUS.ending,
        ].includes(current.status as never)
      ) {
        // A concurrent accept won the database CAS and now owns this same
        // deterministic lease. The losing request must not release it.
        return false;
      }
      if (current && isRemoteTerminal(current.status)) {
        return this.mediaSecurity.cleanupSession(current);
      }
      if (current?.status === REMOTE_SESSION_STATUS.ringing) {
        // Another acceptance transaction may already have claimed this same
        // deterministic owner but not committed its database CAS yet. Keep
        // the bounded lease; releasing it here can strand that winner.
        return false;
      }
      await this.safeRelease(session.bindingId, owner);
      return true;
    } catch (error) {
      // Preserve the bounded lease when durable ownership is uncertain. A
      // blind release can disconnect a concurrently accepted call.
      this.logger.warn(
        `Acceptance lease ownership check deferred (${error instanceof Error ? error.name : 'unknown'})`,
      );
      return false;
    }
  }

  private async restoreAiLeaseIfStillActive(
    bindingId: string,
    owner: MediaLeaseOwner,
  ): Promise<void> {
    try {
      if (
        !(await this.companionMedia.isActiveLeaseOwner(
          bindingId,
          owner.ownerId,
        ))
      ) {
        return;
      }
      if (
        !(await this.leases.acquire(
          bindingId,
          owner,
          REMOTE_MEDIA_LEASE_TTL_SECONDS,
        ))
      ) {
        return;
      }
      if (
        !(await this.companionMedia.isActiveLeaseOwner(
          bindingId,
          owner.ownerId,
        ))
      ) {
        // The AI session ended between the pre-check and Redis acquire.
        // Compare-delete prevents this compensation from leaving a stale
        // owner that blocks the next legitimate media session.
        await this.safeRelease(bindingId, owner);
      }
    } catch (restoreError) {
      this.logger.warn(
        `AI media lease restore deferred (${restoreError instanceof Error ? restoreError.name : 'unknown'})`,
      );
    }
  }

  private async releaseProvisionalRemoteLeaseIfUnowned(
    bindingId: string,
    sessionId: string,
  ): Promise<void> {
    try {
      const persisted = await this.prisma.remoteAssistanceSession.findFirst({
        where: {
          id: sessionId,
          bindingId,
          status: { in: [...OPEN_REMOTE_STATUSES] },
        },
        select: { id: true },
      });
      if (persisted) {
        return;
      }
    } catch (error) {
      this.logger.warn(
        `Remote provisional lease ownership check deferred (${error instanceof Error ? error.name : 'unknown'})`,
      );
      return;
    }
    // A same-id SERIALIZABLE winner can still be uncommitted and therefore
    // invisible to this autocommit read. Both requests share the deterministic
    // Redis owner, so releasing on "no row" could strand the winner after it
    // commits. Preserve the bounded 90-second lease fail-closed.
  }

  private async cleanupFinishedSession(
    session: RemoteAssistanceSession,
  ): Promise<void> {
    await this.mediaSecurity.cleanupSession(session);
  }

  private async safeRemoveParticipant(
    roomName: string,
    identity: string,
  ): Promise<void> {
    try {
      await this.livekit.removeParticipant(roomName, identity);
    } catch (error) {
      this.logger.warn(
        `LiveKit participant removal deferred (${error instanceof Error ? error.name : 'unknown'})`,
      );
    }
  }

  private async safeDeleteRoom(roomName: string): Promise<boolean> {
    try {
      await this.livekit.deleteRoom(roomName);
      return true;
    } catch (error) {
      this.logger.warn(
        `LiveKit room cleanup deferred (${error instanceof Error ? error.name : 'unknown'})`,
      );
      return false;
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
    options: { timeout?: number } = {},
  ): Promise<T> {
    for (let attempt = 1; attempt <= SERIALIZABLE_RETRIES; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          ...options,
        });
      } catch (error) {
        if (attempt === SERIALIZABLE_RETRIES || !isRetryable(error)) {
          throw error;
        }
      }
    }
    throw new RemoteDeviceBusyException();
  }

  private async lockRemoteSession(
    transaction: Prisma.TransactionClient,
    sessionId: string,
  ): Promise<void> {
    const rows = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT \`id\`
      FROM \`remote_assistance_sessions\`
      WHERE \`id\` = ${sessionId}
      FOR UPDATE
    `);
    if (rows.length !== 1) {
      throw new RemoteSessionNotFoundException();
    }
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
