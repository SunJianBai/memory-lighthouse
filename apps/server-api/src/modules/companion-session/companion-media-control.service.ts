import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../infrastructure/database/generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';

/**
 * Narrow cross-context boundary for transferring camera/microphone ownership.
 * Realtime Communication never writes Companion Session tables directly.
 */
@Injectable()
export class CompanionMediaControlService {
  constructor(private readonly prisma: PrismaService) {}

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
}
