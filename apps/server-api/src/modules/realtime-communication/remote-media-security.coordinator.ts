import { Inject, Injectable, Logger } from '@nestjs/common';
import { ulid } from 'ulid';

import {
  Prisma,
  type RemoteAssistanceSession,
} from '../../infrastructure/database/generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { CompanionMediaControlService } from '../companion-session/companion-media-control.service';
import {
  OPEN_REMOTE_STATUSES,
  LIVEKIT_PORT,
  MEDIA_LEASE_PORT,
  REMOTE_MEDIA_LEASE_TTL_SECONDS,
  REMOTE_ROOM_PROVISIONING_FENCE_SECONDS,
  REMOTE_SESSION_STATUS,
  TERMINAL_REMOTE_STATUSES,
} from './realtime.constants';
import type { LiveKitPort } from './ports/livekit.port';
import type { MediaLeaseOwner, MediaLeasePort } from './ports/media-lease.port';

type RevocationClient = Prisma.TransactionClient;

@Injectable()
export class RemoteMediaSecurityCoordinator {
  private readonly logger = new Logger(RemoteMediaSecurityCoordinator.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(MEDIA_LEASE_PORT)
    private readonly leases: MediaLeasePort,
    @Inject(LIVEKIT_PORT)
    private readonly livekit: LiveKitPort,
    private readonly companionMedia: CompanionMediaControlService,
  ) {}

  markRecipientRevoked(
    transaction: RevocationClient,
    householdId: string,
    recipientId: string,
    reason: string,
    occurredAt: Date,
  ): Promise<number> {
    return this.markSessionsRevoked(
      transaction,
      { householdId, recipientId },
      reason,
      occurredAt,
    );
  }

  markBindingRevoked(
    transaction: RevocationClient,
    bindingId: string,
    reason: string,
    occurredAt: Date,
  ): Promise<number> {
    return this.markSessionsRevoked(
      transaction,
      { bindingId },
      reason,
      occurredAt,
    );
  }

  markMemberRevoked(
    transaction: RevocationClient,
    householdId: string,
    memberId: string,
    reason: string,
    occurredAt: Date,
  ): Promise<number> {
    return this.markSessionsRevoked(
      transaction,
      { householdId, initiatedByMemberId: memberId },
      reason,
      occurredAt,
    );
  }

  async markCompanionConsentRevoked(
    transaction: RevocationClient,
    householdId: string,
    recipientId: string,
    scope:
      | 'CAMERA_CAPTURE'
      | 'MICROPHONE_CAPTURE'
      | 'MODEL_PROCESSING'
      | 'MEMORY_STORAGE',
    occurredAt: Date,
  ): Promise<number> {
    return this.companionMedia.endForConsentRevocation(
      transaction,
      householdId,
      recipientId,
      scope,
      occurredAt,
    );
  }

  markCompanionBindingRevoked(
    transaction: RevocationClient,
    bindingId: string,
    reason: string,
    occurredAt: Date,
  ): Promise<number> {
    return this.companionMedia.endForBindingRevocation(
      transaction,
      bindingId,
      reason,
      occurredAt,
    );
  }

  async cleanupCompanionLeasesForRecipient(
    householdId: string,
    recipientId: string,
  ): Promise<void> {
    const sessions =
      await this.companionMedia.listConsentRevokedSessionsForLeaseCleanup(
        householdId,
        recipientId,
      );
    for (const session of sessions) {
      await this.safeRelease(session.bindingId, {
        ownerType: 'AI_COMPANION',
        ownerId: session.id,
        leaseId: session.id,
      });
    }
  }

  async cleanupCompanionLeasesForBinding(bindingId: string): Promise<void> {
    const sessions =
      await this.companionMedia.listEndedSessionsForBindingLeaseCleanup(
        bindingId,
      );
    for (const session of sessions) {
      await this.safeRelease(session.bindingId, {
        ownerType: 'AI_COMPANION',
        ownerId: session.id,
        leaseId: session.id,
      });
    }
  }

  async hasPendingCleanup(
    client: Pick<Prisma.TransactionClient, 'remoteAssistanceSession'>,
    bindingId: string,
  ): Promise<boolean> {
    return Boolean(
      await client.remoteAssistanceSession.findFirst({
        where: {
          bindingId,
          status: { in: [...TERMINAL_REMOTE_STATUSES] },
          roomCleanupStatus: 'PENDING',
        },
        select: { id: true },
      }),
    );
  }

  async hasRemoteMediaBarrier(
    client: Pick<Prisma.TransactionClient, 'remoteAssistanceSession'>,
    bindingId: string,
  ): Promise<boolean> {
    return Boolean(
      await client.remoteAssistanceSession.findFirst({
        where: {
          bindingId,
          OR: [
            { status: { in: [...OPEN_REMOTE_STATUSES] } },
            {
              status: { in: [...TERMINAL_REMOTE_STATUSES] },
              roomCleanupStatus: 'PENDING',
            },
          ],
        },
        select: { id: true },
      }),
    );
  }

  cleanupPendingForRecipient(
    householdId: string,
    recipientId: string,
  ): Promise<void> {
    return this.cleanupPending({ householdId, recipientId });
  }

  cleanupPendingForBinding(bindingId: string): Promise<void> {
    return this.cleanupPending({ bindingId });
  }

  cleanupPendingForMember(
    householdId: string,
    memberId: string,
  ): Promise<void> {
    return this.cleanupPending({
      householdId,
      initiatedByMemberId: memberId,
    });
  }

  async cleanupSession(session: RemoteAssistanceSession): Promise<boolean> {
    if (session.roomCleanupStatus === 'COMPLETED') {
      // COMPLETED is final. The session-wide provisioning-owner invariant
      // guarantees that an in-flight first CreateRoom never coexists with an
      // issued token, while roomProvisionedAt prevents every later ticket from
      // launching another CreateRoom. Re-opening a completed checkpoint after
      // an unrelated provider read failure would create a fail-open gap if the
      // database write also failed and its bounded Redis lease later expired.
      await this.safeRelease(session.bindingId, this.leaseOwner(session.id));
      return true;
    }

    let deleted = await this.safeDeleteRoom(session.livekitRoomName);
    if (!deleted) {
      await this.ensureQuarantineLease(session);
      const participants = await this.safeParticipants(session.id);
      for (const participant of participants) {
        await this.safeRemoveParticipant(
          session.livekitRoomName,
          `${participant.role === 'FAMILY' ? 'family' : 'device'}_${session.id}_${participant.id}`,
        );
      }
      deleted = await this.safeDeleteRoom(session.livekitRoomName);
    }

    if (!deleted) {
      await this.ensureQuarantineLease(session);
      return false;
    }

    if (this.cleanupFenceActive(session, new Date())) {
      // A timed-out first CreateRoom may still materialize as an empty orphan
      // after this successful delete. Keep the operational checkpoint pending
      // and let the 15-second runner re-delete during the conservative window.
      // Token safety itself comes from the unique provisioning owner, which
      // cannot commit ROOM_READY or mint after a timed-out provider call.
      await this.ensureQuarantineLease(session);
      return false;
    }

    try {
      await this.prisma.remoteAssistanceSession.updateMany({
        where: {
          id: session.id,
          roomCleanupStatus: 'PENDING',
          roomCleanupNotBefore: session.roomCleanupNotBefore,
        },
        data: {
          roomCleanupStatus: 'COMPLETED',
          roomCleanupCompletedAt: new Date(),
          roomCleanupNotBefore: null,
        },
      });
      const persisted = await this.prisma.remoteAssistanceSession.findUnique({
        where: { id: session.id },
        select: { roomCleanupStatus: true, roomCleanupNotBefore: true },
      });
      if (
        persisted?.roomCleanupStatus !== 'COMPLETED' ||
        persisted.roomCleanupNotBefore !== null
      ) {
        await this.ensureQuarantineLease(session);
        return false;
      }
    } catch (error) {
      this.logger.warn(
        `Room cleanup checkpoint deferred (${this.errorName(error)})`,
      );
      await this.ensureQuarantineLease(session);
      return false;
    }

    // The durable checkpoint is written only after LiveKit confirms deletion.
    // Compare-and-delete cannot release a newer owner if a race occurred.
    await this.safeRelease(session.bindingId, this.leaseOwner(session.id));
    return true;
  }

  private async markSessionsRevoked(
    transaction: RevocationClient,
    where: Prisma.RemoteAssistanceSessionWhereInput,
    reason: string,
    occurredAt: Date,
  ): Promise<number> {
    const sessions = await transaction.remoteAssistanceSession.findMany({
      where: { ...where, status: { in: [...OPEN_REMOTE_STATUSES] } },
    });
    let changedCount = 0;
    for (const session of sessions) {
      await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT \`id\`
        FROM \`remote_assistance_sessions\`
        WHERE \`id\` = ${session.id}
        FOR UPDATE
      `);
      const roomProvisioning =
        await transaction.remoteSessionParticipant.findFirst({
          where: {
            sessionId: session.id,
            joinTicketStatus: 'PROVISIONING',
          },
          select: { id: true },
        });
      const provisioningFence = roomProvisioning
        ? new Date(
            occurredAt.getTime() +
              REMOTE_ROOM_PROVISIONING_FENCE_SECONDS * 1_000,
          )
        : null;
      const changed = await transaction.remoteAssistanceSession.updateMany({
        where: {
          id: session.id,
          status: { in: [...OPEN_REMOTE_STATUSES] },
        },
        data: {
          status: REMOTE_SESSION_STATUS.revoked,
          endedAt: occurredAt,
          endedByType: 'SYSTEM',
          endedById: null,
          endReason: reason.slice(0, 64),
          roomCleanupStatus: 'PENDING',
          roomCleanupCompletedAt: null,
          ...(provisioningFence
            ? {
                roomCleanupNotBefore:
                  session.roomCleanupNotBefore &&
                  session.roomCleanupNotBefore > provisioningFence
                    ? session.roomCleanupNotBefore
                    : provisioningFence,
              }
            : {}),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) continue;
      changedCount += 1;
      await transaction.remoteSessionParticipant.updateMany({
        where: {
          sessionId: session.id,
          joinTicketStatus: {
            in: ['ISSUING', 'PROVISIONING', 'ROOM_READY', 'ISSUED', 'CONSUMED'],
          },
        },
        data: {
          joinTicketStatus: 'REVOKED',
          joinTicketRevokedAt: occurredAt,
        },
      });
      await transaction.remoteSessionEvent.create({
        data: {
          id: ulid(occurredAt.getTime()),
          sessionId: session.id,
          eventType: REMOTE_SESSION_STATUS.revoked,
          actorType: 'SYSTEM',
          actorId: null,
          metadataJson: { reason: reason.slice(0, 64) },
          occurredAt,
        },
      });
      await transaction.outboxEvent.create({
        data: {
          id: ulid(occurredAt.getTime()),
          aggregateType: 'RemoteAssistanceSession',
          aggregateId: session.id,
          eventType: 'remote-session.ended',
          payloadJson: {
            householdId: session.householdId,
            recipientId: session.recipientId,
            bindingId: session.bindingId,
            status: REMOTE_SESSION_STATUS.revoked,
          },
          occurredAt,
          availableAt: occurredAt,
        },
      });
    }
    return changedCount;
  }

  private async cleanupPending(
    where: Prisma.RemoteAssistanceSessionWhereInput,
  ): Promise<void> {
    const sessions = await this.prisma.remoteAssistanceSession.findMany({
      where: {
        ...where,
        status: { in: [...TERMINAL_REMOTE_STATUSES] },
        roomCleanupStatus: 'PENDING',
      },
      orderBy: { endedAt: 'asc' },
    });
    for (const session of sessions) {
      await this.cleanupSession(session);
    }
  }

  private async ensureQuarantineLease(
    session: RemoteAssistanceSession,
    releaseIfCheckpointCompleted = true,
  ): Promise<void> {
    const expected = this.leaseOwner(session.id);
    try {
      const current = await this.leases.current(session.bindingId);
      if (!current) {
        const acquired = await this.leases.acquire(
          session.bindingId,
          expected,
          REMOTE_MEDIA_LEASE_TTL_SECONDS,
        );
        if (acquired && releaseIfCheckpointCompleted) {
          await this.releaseQuarantineIfCheckpointCompleted(session, expected);
        }
        return;
      }
      if (
        current.ownerType === expected.ownerType &&
        current.ownerId === expected.ownerId &&
        current.leaseId === expected.leaseId
      ) {
        const renewed = await this.leases.renew(
          session.bindingId,
          expected,
          REMOTE_MEDIA_LEASE_TTL_SECONDS,
        );
        if (renewed && releaseIfCheckpointCompleted) {
          await this.releaseQuarantineIfCheckpointCompleted(session, expected);
        }
        return;
      }
      this.logger.error(
        `Pending LiveKit cleanup is quarantined by MySQL but binding ${session.bindingId} already has a different Redis owner`,
      );
    } catch (error) {
      this.logger.error(
        `Unable to renew pending room quarantine (${this.errorName(error)})`,
      );
    }
  }

  private cleanupFenceActive(
    session: RemoteAssistanceSession,
    now: Date,
  ): boolean {
    return Boolean(
      session.roomCleanupNotBefore && session.roomCleanupNotBefore > now,
    );
  }

  private async releaseQuarantineIfCheckpointCompleted(
    session: RemoteAssistanceSession,
    expected: MediaLeaseOwner,
  ): Promise<void> {
    try {
      const current = await this.prisma.remoteAssistanceSession.findUnique({
        where: { id: session.id },
        select: { status: true, roomCleanupStatus: true },
      });
      if (
        current &&
        TERMINAL_REMOTE_STATUSES.includes(current.status as never) &&
        current.roomCleanupStatus === 'PENDING'
      ) {
        return;
      }
      // Another cleanup worker completed the durable checkpoint after our
      // empty Redis read. Remove only the owner we just installed/renewed.
      await this.safeRelease(session.bindingId, expected);
    } catch (error) {
      // Database uncertainty keeps the bounded quarantine lease fail-closed.
      this.logger.warn(
        `Quarantine checkpoint confirmation deferred (${this.errorName(error)})`,
      );
    }
  }

  private async safeParticipants(
    sessionId: string,
  ): Promise<Array<{ id: string; role: string }>> {
    try {
      return await this.prisma.remoteSessionParticipant.findMany({
        where: { sessionId },
        select: { id: true, role: true },
      });
    } catch (error) {
      this.logger.warn(
        `LiveKit participant cleanup lookup deferred (${this.errorName(error)})`,
      );
      return [];
    }
  }

  private async safeDeleteRoom(roomName: string): Promise<boolean> {
    try {
      await this.livekit.deleteRoom(roomName);
      return true;
    } catch (error) {
      this.logger.warn(
        `LiveKit room cleanup deferred (${this.errorName(error)})`,
      );
      return false;
    }
  }

  private async safeRemoveParticipant(
    roomName: string,
    identity: string,
  ): Promise<void> {
    try {
      await this.livekit.removeParticipant(roomName, identity);
    } catch (error) {
      this.logger.warn(
        `LiveKit participant removal deferred (${this.errorName(error)})`,
      );
    }
  }

  private async safeRelease(
    bindingId: string,
    owner: MediaLeaseOwner,
  ): Promise<void> {
    try {
      await this.leases.release(bindingId, owner);
    } catch (error) {
      this.logger.warn(
        `Media lease release deferred (${this.errorName(error)})`,
      );
    }
  }

  private leaseOwner(sessionId: string): MediaLeaseOwner {
    return {
      ownerType: 'REMOTE_ASSISTANCE',
      ownerId: sessionId,
      leaseId: sessionId,
    };
  }

  private errorName(error: unknown): string {
    return error instanceof Error ? error.name : 'unknown';
  }
}
