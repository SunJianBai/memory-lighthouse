import { Injectable } from '@nestjs/common';
import { ulid } from 'ulid';

import type { Prisma } from '../../infrastructure/database/generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';

type CompanionTerminationClient = Pick<
  Prisma.TransactionClient,
  'companionSession' | 'modelSession' | 'outboxEvent'
>;

export type CompanionConsentScope =
  | 'CAMERA_CAPTURE'
  | 'MICROPHONE_CAPTURE'
  | 'MODEL_PROCESSING'
  | 'MEMORY_STORAGE';

/**
 * Narrow cross-context boundary for Companion lifecycle and media ownership.
 * Realtime Communication never reads or writes Companion Session tables.
 */
@Injectable()
export class CompanionMediaControlService {
  constructor(private readonly prisma: PrismaService) {}

  endForConsentRevocation(
    transaction: CompanionTerminationClient,
    householdId: string,
    recipientId: string,
    scope: CompanionConsentScope,
    occurredAt: Date,
  ): Promise<number> {
    return this.endMatchingActiveSessions(
      transaction,
      {
        householdId,
        recipientId,
        ...(scope === 'CAMERA_CAPTURE' ? { mode: 'AUDIO_VIDEO' } : {}),
      },
      `CONSENT_REVOKED_${scope}`,
      occurredAt,
    );
  }

  endForBindingRevocation(
    transaction: CompanionTerminationClient,
    bindingId: string,
    reason: string,
    occurredAt: Date,
  ): Promise<number> {
    return this.endMatchingActiveSessions(
      transaction,
      { bindingId },
      reason,
      occurredAt,
    );
  }

  private async endMatchingActiveSessions(
    transaction: CompanionTerminationClient,
    where: Prisma.CompanionSessionWhereInput,
    reason: string,
    occurredAt: Date,
  ): Promise<number> {
    const normalizedReason = reason.slice(0, 64);
    const sessions = await transaction.companionSession.findMany({
      where: { ...where, status: 'ACTIVE' },
    });
    let changedCount = 0;
    for (const session of sessions) {
      // Model Session is locked/ended before Companion Session everywhere in
      // this bounded context. Keep that global order for concurrent endings.
      await transaction.modelSession.updateMany({
        where: { companionSessionId: session.id, status: 'ACTIVE' },
        data: {
          status: 'ENDED',
          endedAt: occurredAt,
          endReason: normalizedReason,
        },
      });
      const changed = await transaction.companionSession.updateMany({
        where: { id: session.id, status: 'ACTIVE' },
        data: {
          status: 'ENDED',
          endedAt: occurredAt,
          endReason: normalizedReason,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) continue;
      changedCount += 1;
      await transaction.outboxEvent.create({
        data: {
          id: ulid(occurredAt.getTime()),
          aggregateType: 'CompanionSession',
          aggregateId: session.id,
          eventType: 'CompanionSessionEnded',
          payloadJson: {
            householdId: session.householdId,
            recipientId: session.recipientId,
            bindingId: session.bindingId,
            reason: normalizedReason,
          },
          occurredAt,
          availableAt: occurredAt,
        },
      });
    }
    return changedCount;
  }

  async interruptForRemoteAssistance(
    transaction: Prisma.TransactionClient,
    bindingId: string,
    occurredAt: Date,
  ): Promise<void> {
    await transaction.modelSession.updateMany({
      where: {
        companionSession: { bindingId, status: 'ACTIVE' },
        status: 'ACTIVE',
      },
      data: {
        status: 'ENDED',
        endedAt: occurredAt,
        endReason: 'REMOTE_ASSISTANCE_ACCEPTED',
      },
    });
    await transaction.companionSession.updateMany({
      where: { bindingId, status: 'ACTIVE' },
      data: {
        status: 'ENDED',
        endedAt: occurredAt,
        endReason: 'REMOTE_ASSISTANCE_ACCEPTED',
        version: { increment: 1 },
      },
    });
  }

  async isActiveLeaseOwner(
    bindingId: string,
    companionSessionId: string,
  ): Promise<boolean> {
    const active = await this.prisma.companionSession.findFirst({
      where: {
        id: companionSessionId,
        bindingId,
        status: 'ACTIVE',
      },
      select: { id: true },
    });
    return active !== null;
  }

  listConsentRevokedSessionsForLeaseCleanup(
    householdId: string,
    recipientId: string,
  ): Promise<Array<{ id: string; bindingId: string }>> {
    return this.prisma.companionSession.findMany({
      where: {
        householdId,
        recipientId,
        status: 'ENDED',
        endReason: { startsWith: 'CONSENT_REVOKED_' },
      },
      select: { id: true, bindingId: true },
    });
  }

  listEndedSessionsForBindingLeaseCleanup(
    bindingId: string,
  ): Promise<Array<{ id: string; bindingId: string }>> {
    return this.prisma.companionSession.findMany({
      where: { bindingId, status: 'ENDED' },
      select: { id: true, bindingId: true },
    });
  }
}
