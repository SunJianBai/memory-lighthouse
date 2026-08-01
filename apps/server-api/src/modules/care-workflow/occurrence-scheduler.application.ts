import { Inject, Injectable } from '@nestjs/common';

import { Prisma } from '../../infrastructure/database/generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { newUlid } from '../identity/domain/ulid';
import {
  CARE_WORKFLOW_CONTENT_CIPHER,
  FAMILY_TASK_STATUS,
  OCCURRENCE_STATUS,
  ROUTINE_STATUS,
  type OccurrenceStatus,
} from './care-workflow.constants';
import type {
  AdvanceOccurrencesCommand,
  AdvanceOccurrencesResult,
  GenerateOccurrencesCommand,
  GenerateOccurrencesResult,
} from './care-workflow.types';
import { assertOccurrenceTransition } from './domain/occurrence-state-machine';
import {
  generateOccurrenceCandidates,
  type ScheduleDefinition,
} from './domain/schedule-time';
import type { CareWorkflowContentCipher } from './ports/content-cipher.port';

type TransactionClient = Prisma.TransactionClient;

interface SchedulerSchedule extends ScheduleDefinition {
  routineId: string;
  active: boolean;
  routine: {
    householdId: string;
    recipientId: string;
    status: string;
    deletedAt: Date | null;
  };
}

interface AdvanceRecord {
  id: string;
  householdId: string;
  recipientId: string;
  status: string;
  version: number;
  escalationAt: Date | null;
  routine: { status: string; deletedAt: Date | null };
  schedule: { active: boolean };
}

export interface OccurrenceSchedulerApplication {
  generateOccurrences(
    command: GenerateOccurrencesCommand,
  ): Promise<GenerateOccurrencesResult>;
  advanceOccurrences(
    command: AdvanceOccurrencesCommand,
  ): Promise<AdvanceOccurrencesResult>;
}

@Injectable()
export class PrismaOccurrenceScheduler implements OccurrenceSchedulerApplication {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CARE_WORKFLOW_CONTENT_CIPHER)
    private readonly cipher: CareWorkflowContentCipher,
  ) {}

  async generateOccurrences(
    command: GenerateOccurrencesCommand,
  ): Promise<GenerateOccurrencesResult> {
    const schedules = (await this.prisma.routineSchedule.findMany({
      where: {
        active: true,
        routine: { status: ROUTINE_STATUS.active, deletedAt: null },
      },
      include: {
        routine: {
          select: {
            householdId: true,
            recipientId: true,
            status: true,
            deletedAt: true,
          },
        },
      },
    })) as SchedulerSchedule[];
    const rows = schedules.flatMap((schedule) =>
      generateOccurrenceCandidates(
        schedule,
        command.windowStartUtc,
        command.windowEndUtc,
      ).map((candidate) => ({
        id: candidate.id,
        householdId: schedule.routine.householdId,
        recipientId: schedule.routine.recipientId,
        routineId: schedule.routineId,
        scheduleId: schedule.id,
        scheduledAtUtc: candidate.scheduledAtUtc,
        scheduledLocalDate: candidate.scheduledLocalDate,
        status: OCCURRENCE_STATUS.due,
        confirmationDeadlineAt: candidate.confirmationDeadlineAt,
        escalationAt: candidate.escalationAt,
      })),
    );
    if (rows.length === 0) return { attempted: 0, created: 0 };
    const created = await this.prisma.routineOccurrence.createMany({
      data: rows,
      // UNIQUE(schedule_id, scheduled_at_utc) is the final idempotency guard.
      skipDuplicates: true,
    });
    return { attempted: rows.length, created: created.count };
  }

  async advanceOccurrences(
    command: AdvanceOccurrencesCommand,
  ): Promise<AdvanceOccurrencesResult> {
    const batchSize = Math.min(Math.max(command.batchSize ?? 100, 1), 500);
    const candidates = await this.prisma.routineOccurrence.findMany({
      where: {
        status: {
          in: [OCCURRENCE_STATUS.due, OCCURRENCE_STATUS.awaitingConfirmation],
        },
        OR: [
          {
            status: OCCURRENCE_STATUS.due,
            scheduledAtUtc: { lte: command.now },
          },
          {
            status: OCCURRENCE_STATUS.awaitingConfirmation,
            escalationAt: { lte: command.now },
          },
          { schedule: { active: false } },
          {
            routine: {
              OR: [
                { status: { not: ROUTINE_STATUS.active } },
                { deletedAt: { not: null } },
              ],
            },
          },
        ],
      },
      select: { id: true },
      orderBy: { scheduledAtUtc: 'asc' },
      take: batchSize,
    });
    const result: AdvanceOccurrencesResult = {
      awaitingConfirmation: 0,
      needsFamilyReview: 0,
      expired: 0,
    };
    for (const candidate of candidates) {
      const changed = await this.advanceOne(candidate.id, command.now);
      if (changed) result[changed] += 1;
    }
    return result;
  }

  private async advanceOne(
    occurrenceId: string,
    now: Date,
  ): Promise<keyof AdvanceOccurrencesResult | null> {
    return this.prisma.$transaction(
      async (transaction) => {
        const occurrence = (await transaction.routineOccurrence.findUnique({
          where: { id: occurrenceId },
          include: {
            routine: { select: { status: true, deletedAt: true } },
            schedule: { select: { active: true } },
          },
        })) as AdvanceRecord | null;
        if (!occurrence) return null;
        const active =
          occurrence.routine.status === ROUTINE_STATUS.active &&
          !occurrence.routine.deletedAt &&
          occurrence.schedule.active;
        if (!active) {
          if (
            occurrence.status !== OCCURRENCE_STATUS.due &&
            occurrence.status !== OCCURRENCE_STATUS.awaitingConfirmation
          ) {
            return null;
          }
          const changed = await this.changeStatus(
            transaction,
            occurrence,
            OCCURRENCE_STATUS.expired,
          );
          if (!changed) return null;
          await this.writeOutbox(
            transaction,
            occurrence,
            now,
            'routine-occurrence.expired',
          );
          return 'expired';
        }
        if (occurrence.status === OCCURRENCE_STATUS.due) {
          const changed = await this.changeStatus(
            transaction,
            occurrence,
            OCCURRENCE_STATUS.awaitingConfirmation,
          );
          if (!changed) return null;
          await this.writeOutbox(
            transaction,
            occurrence,
            now,
            'routine-occurrence.awaiting-confirmation',
          );
          return 'awaitingConfirmation';
        }
        if (
          occurrence.status === OCCURRENCE_STATUS.awaitingConfirmation &&
          occurrence.escalationAt &&
          occurrence.escalationAt <= now
        ) {
          const changed = await this.changeStatus(
            transaction,
            occurrence,
            OCCURRENCE_STATUS.needsFamilyReview,
          );
          if (!changed) return null;
          const eventId = newUlid(now.getTime());
          const protectedContent = this.encryptPair(
            '日程需要家属核验',
            '在家属设定的确认时限内没有收到明确确认，请家属核验。此事件不推断服药或其他行为是否完成。',
          );
          await transaction.careEvent.create({
            data: {
              id: eventId,
              householdId: occurrence.householdId,
              recipientId: occurrence.recipientId,
              type: 'ROUTINE_CONFIRMATION_MISSING',
              severity: 'ATTENTION',
              sourceType: 'ROUTINE_SCHEDULER',
              sourceId: occurrence.id,
              routineOccurrenceId: occurrence.id,
              titleCiphertext: protectedContent.first,
              summaryCiphertext: protectedContent.second,
              contentNonce: protectedContent.nonce,
              encryptionKeyId: protectedContent.encryptionKeyId,
              dedupeKey: `occurrence:${occurrence.id}:needs-family-review`,
              payloadJson: {
                occurrenceId: occurrence.id,
                inferenceMade: false,
              },
              occurredAt: now,
            },
          });
          const taskId = newUlid(now.getTime());
          await transaction.familyTask.create({
            data: {
              id: taskId,
              householdId: occurrence.householdId,
              recipientId: occurrence.recipientId,
              sourceEventId: eventId,
              status: FAMILY_TASK_STATUS.open,
              priority: 'NORMAL',
              dueAt: now,
            },
          });
          await transaction.outboxEvent.createMany({
            data: [
              {
                id: newUlid(now.getTime()),
                aggregateType: 'ROUTINE_OCCURRENCE',
                aggregateId: occurrence.id,
                eventType: 'routine-occurrence.needs-family-review',
                payloadJson: {
                  householdId: occurrence.householdId,
                  recipientId: occurrence.recipientId,
                  occurrenceId: occurrence.id,
                  careEventId: eventId,
                  familyTaskId: taskId,
                },
                occurredAt: now,
                availableAt: now,
              },
              {
                id: newUlid(now.getTime()),
                aggregateType: 'FAMILY_TASK',
                aggregateId: taskId,
                eventType: 'family-task.opened',
                payloadJson: {
                  householdId: occurrence.householdId,
                  recipientId: occurrence.recipientId,
                  occurrenceId: occurrence.id,
                  careEventId: eventId,
                  familyTaskId: taskId,
                },
                occurredAt: now,
                availableAt: now,
              },
            ],
          });
          return 'needsFamilyReview';
        }
        return null;
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  }

  private async changeStatus(
    transaction: TransactionClient,
    occurrence: AdvanceRecord,
    target: OccurrenceStatus,
  ): Promise<boolean> {
    assertOccurrenceTransition(occurrence.status, target);
    const changed = await transaction.routineOccurrence.updateMany({
      where: {
        id: occurrence.id,
        status: occurrence.status,
        version: occurrence.version,
      },
      data: {
        status: target,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) {
      // Another worker won the optimistic race. The transaction intentionally
      // performs no side effects in that case.
      return false;
    }
    return true;
  }

  private writeOutbox(
    transaction: TransactionClient,
    occurrence: AdvanceRecord,
    now: Date,
    eventType: string,
  ) {
    return transaction.outboxEvent.create({
      data: {
        id: newUlid(now.getTime()),
        aggregateType: 'ROUTINE_OCCURRENCE',
        aggregateId: occurrence.id,
        eventType,
        payloadJson: {
          householdId: occurrence.householdId,
          recipientId: occurrence.recipientId,
          occurrenceId: occurrence.id,
        },
        occurredAt: now,
        availableAt: now,
      },
    });
  }

  private encryptPair(first: string, second: string) {
    const encrypted = this.cipher.encrypt(JSON.stringify([first, second]));
    const splitAt = Math.ceil(encrypted.ciphertext.length / 2);
    return {
      first: Uint8Array.from(encrypted.ciphertext.subarray(0, splitAt)),
      second: Uint8Array.from(encrypted.ciphertext.subarray(splitAt)),
      nonce: Uint8Array.from(encrypted.nonce),
      encryptionKeyId: encrypted.encryptionKeyId,
    };
  }
}
