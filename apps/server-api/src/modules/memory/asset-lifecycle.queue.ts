import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { newUlid } from '../identity/domain/ulid';
import {
  ASSET_LIFECYCLE_CONSUMER,
  ASSET_LIFECYCLE_EVENT,
  ASSET_SCAN_STATUS,
  ASSET_STATUS,
  ASSET_UPLOAD_TTL_SECONDS,
} from './memory.constants';

export interface AssetLifecycleJob {
  id: string;
  assetId: string;
  eventType:
    | typeof ASSET_LIFECYCLE_EVENT.scanRequested
    | typeof ASSET_LIFECYCLE_EVENT.deleteRequested;
  attemptCount: number;
}

interface RecoverableAsset {
  id: string;
  status: string;
  scanStatus: string;
  createdAt: Date;
}

@Injectable()
export class AssetLifecycleQueue {
  private readonly leaseOwner = `asset:${process.pid}:${randomUUID()}`;

  constructor(private readonly prisma: PrismaService) {}

  async claim(now: Date, leaseMs: number): Promise<AssetLifecycleJob | null> {
    return this.prisma.$transaction(async (transaction) => {
      const candidate = await transaction.outboxEvent.findFirst({
        where: {
          aggregateType: 'ASSET',
          eventType: {
            in: [
              ASSET_LIFECYCLE_EVENT.scanRequested,
              ASSET_LIFECYCLE_EVENT.deleteRequested,
            ],
          },
          publishedAt: null,
          availableAt: { lte: now },
          OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
        },
        orderBy: [{ availableAt: 'asc' }, { id: 'asc' }],
      });
      if (!candidate) {
        return null;
      }

      const leased = await transaction.outboxEvent.updateMany({
        where: {
          id: candidate.id,
          publishedAt: null,
          attemptCount: candidate.attemptCount,
          availableAt: { lte: now },
          OR: [{ leaseUntil: null }, { leaseUntil: { lte: now } }],
        },
        data: {
          leaseOwner: this.leaseOwner,
          leaseUntil: new Date(now.getTime() + leaseMs),
          attemptCount: { increment: 1 },
        },
      });
      if (leased.count !== 1) {
        return null;
      }
      return {
        id: candidate.id,
        assetId: candidate.aggregateId,
        eventType: candidate.eventType as AssetLifecycleJob['eventType'],
        attemptCount: candidate.attemptCount + 1,
      };
    });
  }

  async acknowledge(job: AssetLifecycleJob, now: Date): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.outboxEvent.updateMany({
        where: {
          id: job.id,
          leaseOwner: this.leaseOwner,
          publishedAt: null,
        },
        data: {
          leaseOwner: null,
          leaseUntil: null,
          publishedAt: now,
          lastError: null,
        },
      });
      if (updated.count !== 1) {
        return;
      }
      await transaction.inboxReceipt.createMany({
        data: [
          {
            consumer: ASSET_LIFECYCLE_CONSUMER,
            eventId: job.id,
            processedAt: now,
          },
        ],
        skipDuplicates: true,
      });
    });
  }

  async retry(
    job: AssetLifecycleJob,
    availableAt: Date,
    failureCode: string,
  ): Promise<void> {
    await this.prisma.outboxEvent.updateMany({
      where: {
        id: job.id,
        leaseOwner: this.leaseOwner,
        publishedAt: null,
      },
      data: {
        leaseOwner: null,
        leaseUntil: null,
        availableAt,
        lastError: failureCode.slice(0, 100),
      },
    });
  }

  /**
   * Cyclic state sweep repairs historical rows and the transaction-boundary
   * case where a work event was lost. Duplicate recovery events are harmless:
   * the asset state transition and S3 DELETE are both idempotent.
   */
  async recoverMissingJobs(
    afterId: string | null,
    limit: number,
    now: Date,
  ): Promise<string | null> {
    const candidates = (await this.prisma.asset.findMany({
      where: {
        ...(afterId ? { id: { gt: afterId } } : {}),
        OR: [
          {
            status: ASSET_STATUS.active,
            scanStatus: {
              in: [ASSET_SCAN_STATUS.pending, ASSET_SCAN_STATUS.failed],
            },
          },
          { status: ASSET_STATUS.pendingDelete },
        ],
      },
      orderBy: { id: 'asc' },
      take: limit,
      select: { id: true, status: true, scanStatus: true, createdAt: true },
    })) as RecoverableAsset[];

    for (const candidate of candidates) {
      await this.ensureJob(candidate, now);
    }
    return candidates.length === limit ? (candidates.at(-1)?.id ?? null) : null;
  }

  private async ensureJob(
    candidate: RecoverableAsset,
    now: Date,
  ): Promise<void> {
    const eventType =
      candidate.status === ASSET_STATUS.pendingDelete
        ? ASSET_LIFECYCLE_EVENT.deleteRequested
        : ASSET_LIFECYCLE_EVENT.scanRequested;
    await this.prisma.$transaction(async (transaction) => {
      const current = await transaction.asset.findUnique({
        where: { id: candidate.id },
        select: { id: true, status: true, scanStatus: true, createdAt: true },
      });
      if (!current) {
        return;
      }
      const stillRecoverable =
        eventType === ASSET_LIFECYCLE_EVENT.deleteRequested
          ? current.status === ASSET_STATUS.pendingDelete
          : current.status === ASSET_STATUS.active &&
            [ASSET_SCAN_STATUS.pending, ASSET_SCAN_STATUS.failed].includes(
              current.scanStatus as 'PENDING' | 'FAILED',
            );
      if (!stillRecoverable) {
        return;
      }
      const existing = await transaction.outboxEvent.findFirst({
        where: {
          aggregateType: 'ASSET',
          aggregateId: current.id,
          eventType,
          publishedAt: null,
        },
        select: { id: true },
      });
      if (existing) {
        return;
      }
      await transaction.outboxEvent.create({
        data: {
          id: newUlid(),
          aggregateType: 'ASSET',
          aggregateId: current.id,
          eventType,
          payloadJson: { assetId: current.id, recovered: true },
          occurredAt: now,
          availableAt:
            eventType === ASSET_LIFECYCLE_EVENT.deleteRequested
              ? this.deletionAvailableAt(current.createdAt, now)
              : now,
        },
      });
    });
  }

  private deletionAvailableAt(createdAt: Date, now: Date): Date {
    const uploadGrantExpiry = new Date(
      createdAt.getTime() + (ASSET_UPLOAD_TTL_SECONDS + 60) * 1_000,
    );
    return uploadGrantExpiry > now ? uploadGrantExpiry : now;
  }
}
