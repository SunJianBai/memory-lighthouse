import { Inject, Injectable } from '@nestjs/common';

import { Prisma } from '../../infrastructure/database/generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { DevicePrincipal } from '../device-activation/device-activation.types';
import { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import {
  HouseholdAccessDeniedException,
  RecipientAccessDeniedException,
} from '../household/household.errors';
import { newUlid } from '../identity/domain/ulid';
import {
  ACTIONABLE_OCCURRENCE_LIMIT,
  ACTIONABLE_OCCURRENCE_LOOKAHEAD_MS,
  CARE_WORKFLOW_CLOCK,
  CARE_WORKFLOW_CONTENT_CIPHER,
  FAMILY_TASK_STATUS,
  OCCURRENCE_STATUS,
  ROUTINE_STATUS,
  ROUTINE_TYPES,
  SERIALIZABLE_RETRY_LIMIT,
  type RoutineType,
} from './care-workflow.constants';
import {
  CareWorkflowVersionConflictException,
  DeviceOccurrenceAccessDeniedException,
  FamilyTaskAssigneeConflictException,
  FamilyTaskClaimConflictException,
  FamilyTaskNotFoundException,
  InvalidMedicationReferenceException,
  InvalidOccurrenceTransitionException,
  InvalidRoutineTypeException,
  InvalidScheduleException,
  OccurrenceNotFoundException,
  RoutineNotFoundException,
} from './care-workflow.errors';
import type {
  CareEventView,
  CareWorkflowPrincipal,
  ClaimFamilyTaskCommand,
  ConfirmOccurrenceCommand,
  CreateRoutineCommand,
  DeviceConfirmOccurrenceCommand,
  DeviceFamilyContactRequestCommand,
  FamilyContactRequestView,
  FamilyTaskView,
  FamilyVerifyOccurrenceCommand,
  FinishFamilyTaskCommand,
  OccurrenceView,
  RoutineScheduleInput,
  RoutineView,
  UpdateRoutineCommand,
} from './care-workflow.types';
import {
  assertTaskCanClaim,
  assertTaskCanFinish,
} from './domain/family-task-state-machine';
import { assertOccurrenceTransition } from './domain/occurrence-state-machine';
import {
  fingerprintCareCommand,
  replayCareCommand,
  saveCareCommand,
} from './domain/care-command-idempotency';
import { localMinuteToUtc, parseIsoDate } from './domain/schedule-time';
import type { CareWorkflowClock } from './ports/care-workflow-clock.port';
import type { CareWorkflowContentCipher } from './ports/content-cipher.port';

type TransactionClient = Prisma.TransactionClient;

interface RoutineRecord {
  id: string;
  householdId: string;
  recipientId: string;
  type: string;
  medicationId: string | null;
  title: string;
  instructionsCiphertext: Uint8Array;
  confirmationQuestionCiphertext: Uint8Array;
  contentNonce: Uint8Array;
  encryptionKeyId: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
  schedules: ScheduleRecord[];
}

interface ScheduleRecord {
  id: string;
  timezone: string;
  localTimeMinutes: number;
  weekdayMask: number;
  startDate: Date;
  endDate: Date | null;
  graceMinutes: number;
  familyNoticeMinutes: number;
  scheduleVersion: number;
  active?: boolean;
}

interface OccurrenceRecord {
  id: string;
  householdId: string;
  recipientId: string;
  routineId: string;
  scheduleId: string;
  scheduledAtUtc: Date;
  scheduledLocalDate: Date;
  status: string;
  confirmationDeadlineAt: Date | null;
  escalationAt: Date | null;
  completedAt: Date | null;
  version: number;
  routine: Pick<
    RoutineRecord,
    | 'title'
    | 'type'
    | 'instructionsCiphertext'
    | 'confirmationQuestionCiphertext'
    | 'contentNonce'
    | 'encryptionKeyId'
  >;
}

interface CareEventRecord {
  id: string;
  householdId: string;
  recipientId: string;
  type: string;
  severity: string;
  sourceType: string;
  sourceId: string | null;
  routineOccurrenceId: string | null;
  titleCiphertext: Uint8Array;
  summaryCiphertext: Uint8Array;
  contentNonce: Uint8Array;
  encryptionKeyId: string;
  payloadJson: Prisma.JsonValue | null;
  occurredAt: Date;
  createdAt: Date;
}

interface FamilyTaskRecord {
  id: string;
  householdId: string;
  recipientId: string;
  sourceEventId: string;
  assigneeMemberId: string | null;
  status: string;
  priority: string;
  dueAt: Date | null;
  resolvedAt: Date | null;
  resolutionCode: string | null;
  resolutionNoteCiphertext: Uint8Array | null;
  resolutionNoteNonce: Uint8Array | null;
  encryptionKeyId: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

type OccurrenceConfirmationAuthority =
  | {
      kind: 'USER';
      principal: CareWorkflowPrincipal;
      householdId: string;
    }
  | {
      kind: 'DEVICE';
      principal: DevicePrincipal;
    };

interface OccurrenceConfirmationActor {
  memberId: string | null;
  bindingId: string | null;
}

const ACTIVE_SCHEDULE_INCLUDE = {
  schedules: { where: { active: true }, orderBy: { scheduleVersion: 'desc' } },
} as const;

@Injectable()
export class CareWorkflowApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: HouseholdAccessPolicy,
    @Inject(CARE_WORKFLOW_CONTENT_CIPHER)
    private readonly cipher: CareWorkflowContentCipher,
    @Inject(CARE_WORKFLOW_CLOCK) private readonly clock: CareWorkflowClock,
  ) {}

  async listRoutines(
    principal: CareWorkflowPrincipal,
    householdId: string,
    recipientId: string,
  ): Promise<RoutineView[]> {
    await this.policy.requireRecipientAction(
      this.prisma,
      principal.userId,
      householdId,
      recipientId,
      'MANAGE_ROUTINE',
    );
    const records = (await this.prisma.routine.findMany({
      where: {
        householdId,
        recipientId,
        status: ROUTINE_STATUS.active,
        deletedAt: null,
      },
      include: ACTIVE_SCHEDULE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    })) as RoutineRecord[];
    return records.map((record) => this.toRoutineView(record));
  }

  async createRoutine(
    principal: CareWorkflowPrincipal,
    householdId: string,
    recipientId: string,
    command: CreateRoutineCommand,
  ): Promise<RoutineView> {
    const type = this.requireRoutineType(command.type);
    const schedule = this.validateSchedule(command.schedule);
    const title = this.requiredText(command.title, 'title');
    const instructions = this.requiredText(
      command.instructions,
      'instructions',
    );
    const confirmationQuestion = this.requiredText(
      command.confirmationQuestion,
      'confirmationQuestion',
    );
    const now = this.clock.now();
    const protectedContent = this.encryptPair(
      instructions,
      confirmationQuestion,
    );

    const created = await this.serializable(async (transaction) => {
      await this.policy.requireRecipientAction(
        transaction,
        principal.userId,
        householdId,
        recipientId,
        'MANAGE_ROUTINE',
      );
      await this.requireMedicationReference(
        transaction,
        householdId,
        recipientId,
        type,
        command.medicationId ?? null,
      );
      const routineId = newUlid(now.getTime());
      const record = (await transaction.routine.create({
        data: {
          id: routineId,
          householdId,
          recipientId,
          type,
          medicationId: command.medicationId ?? null,
          title,
          instructionsCiphertext: protectedContent.first,
          confirmationQuestionCiphertext: protectedContent.second,
          contentNonce: protectedContent.nonce,
          encryptionKeyId: protectedContent.encryptionKeyId,
          status: ROUTINE_STATUS.active,
          schedules: {
            create: {
              id: newUlid(now.getTime()),
              ...schedule,
              scheduleVersion: 1,
              active: true,
            },
          },
        },
        include: ACTIVE_SCHEDULE_INCLUDE,
      })) as unknown as RoutineRecord;
      await this.writeOutbox(transaction, now, {
        aggregateType: 'ROUTINE',
        aggregateId: routineId,
        eventType: 'routine.created',
        payload: { householdId, recipientId, routineId },
      });
      return record;
    });
    return this.toRoutineView(created);
  }

  async updateRoutine(
    principal: CareWorkflowPrincipal,
    householdId: string,
    routineId: string,
    command: UpdateRoutineCommand,
  ): Promise<RoutineView> {
    const now = this.clock.now();
    return this.serializable(async (transaction) => {
      const current = (await transaction.routine.findFirst({
        where: {
          id: routineId,
          householdId,
          status: ROUTINE_STATUS.active,
          deletedAt: null,
        },
        include: ACTIVE_SCHEDULE_INCLUDE,
      })) as RoutineRecord | null;
      if (!current) throw new RoutineNotFoundException();
      await this.policy.requireRecipientAction(
        transaction,
        principal.userId,
        householdId,
        current.recipientId,
        'MANAGE_ROUTINE',
      );
      if (current.version !== command.version) {
        throw new CareWorkflowVersionConflictException();
      }
      const nextType =
        command.type === undefined
          ? this.requireRoutineType(current.type)
          : this.requireRoutineType(command.type);
      const nextMedicationId =
        command.medicationId === undefined
          ? current.medicationId
          : command.medicationId;
      await this.requireMedicationReference(
        transaction,
        householdId,
        current.recipientId,
        nextType,
        nextMedicationId,
      );

      let contentUpdate = {};
      if (
        command.instructions !== undefined ||
        command.confirmationQuestion !== undefined
      ) {
        const old = this.decryptPair(current);
        const protectedContent = this.encryptPair(
          command.instructions === undefined
            ? old.first
            : this.requiredText(command.instructions, 'instructions'),
          command.confirmationQuestion === undefined
            ? old.second
            : this.requiredText(
                command.confirmationQuestion,
                'confirmationQuestion',
              ),
        );
        contentUpdate = {
          instructionsCiphertext: protectedContent.first,
          confirmationQuestionCiphertext: protectedContent.second,
          contentNonce: protectedContent.nonce,
          encryptionKeyId: protectedContent.encryptionKeyId,
        };
      }
      const schedule = command.schedule
        ? this.validateSchedule(command.schedule)
        : null;
      if (schedule) {
        await transaction.routineSchedule.updateMany({
          where: { routineId, active: true },
          data: { active: false },
        });
      }

      const update = await transaction.routine.updateMany({
        where: { id: routineId, householdId, version: command.version },
        data: {
          ...(command.type === undefined ? {} : { type: nextType }),
          ...(command.medicationId === undefined
            ? {}
            : { medicationId: command.medicationId }),
          ...(command.title === undefined
            ? {}
            : { title: this.requiredText(command.title, 'title') }),
          ...contentUpdate,
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) {
        throw new CareWorkflowVersionConflictException();
      }
      if (schedule) {
        const versionAggregate = await transaction.routineSchedule.aggregate({
          where: { routineId },
          _max: { scheduleVersion: true },
        });
        const nextVersion = (versionAggregate._max.scheduleVersion ?? 0) + 1;
        await transaction.routineSchedule.create({
          data: {
            id: newUlid(now.getTime()),
            routineId,
            ...schedule,
            scheduleVersion: nextVersion,
            active: true,
          },
        });
      }
      await this.writeOutbox(transaction, now, {
        aggregateType: 'ROUTINE',
        aggregateId: routineId,
        eventType: 'routine.updated',
        payload: { householdId, recipientId: current.recipientId, routineId },
      });
      const result = (await transaction.routine.findUniqueOrThrow({
        where: { id: routineId },
        include: ACTIVE_SCHEDULE_INCLUDE,
      })) as RoutineRecord;
      return this.toRoutineView(result);
    });
  }

  async deleteRoutine(
    principal: CareWorkflowPrincipal,
    householdId: string,
    routineId: string,
    version: number,
  ): Promise<void> {
    const now = this.clock.now();
    await this.serializable(async (transaction) => {
      const routine = await transaction.routine.findFirst({
        where: {
          id: routineId,
          householdId,
          status: ROUTINE_STATUS.active,
          deletedAt: null,
        },
        select: { recipientId: true, version: true },
      });
      if (!routine) throw new RoutineNotFoundException();
      await this.policy.requireRecipientAction(
        transaction,
        principal.userId,
        householdId,
        routine.recipientId,
        'MANAGE_ROUTINE',
      );
      const updated = await transaction.routine.updateMany({
        where: { id: routineId, householdId, version },
        data: {
          status: ROUTINE_STATUS.deleted,
          deletedAt: now,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new CareWorkflowVersionConflictException();
      }
      await transaction.routineSchedule.updateMany({
        where: { routineId, active: true },
        data: { active: false },
      });
      await this.writeOutbox(transaction, now, {
        aggregateType: 'ROUTINE',
        aggregateId: routineId,
        eventType: 'routine.deleted',
        payload: { householdId, recipientId: routine.recipientId, routineId },
      });
    });
  }

  async listOccurrences(
    principal: CareWorkflowPrincipal,
    householdId: string,
    recipientId: string,
    range?: { from?: Date; to?: Date; status?: string },
  ): Promise<OccurrenceView[]> {
    await this.policy.requireRecipientAction(
      this.prisma,
      principal.userId,
      householdId,
      recipientId,
      'VIEW_EVENTS',
    );
    const records = (await this.prisma.routineOccurrence.findMany({
      where: {
        householdId,
        recipientId,
        ...(range?.status ? { status: range.status } : {}),
        ...(range?.from || range?.to
          ? {
              scheduledAtUtc: {
                ...(range.from ? { gte: range.from } : {}),
                ...(range.to ? { lt: range.to } : {}),
              },
            }
          : {}),
      },
      include: { routine: true },
      orderBy: { scheduledAtUtc: 'desc' },
    })) as OccurrenceRecord[];
    return records.map((record) => this.toOccurrenceView(record));
  }

  async listCurrentOccurrencesForDevice(
    principal: DevicePrincipal,
  ): Promise<OccurrenceView[]> {
    this.assertCompanionCapability(principal);
    const binding = await this.prisma.companionBinding.findFirst({
      where: {
        id: principal.bindingId,
        bindingVersion: principal.bindingVersion,
        deviceId: principal.deviceId,
        householdId: principal.householdId,
        recipientId: principal.recipientId,
        status: 'ACTIVE',
        revokedAt: null,
        device: { status: 'ACTIVE' },
        household: { status: 'ACTIVE' },
        recipient: { status: 'ACTIVE', deletedAt: null },
      },
      select: { id: true },
    });
    if (!binding) {
      throw new DeviceOccurrenceAccessDeniedException();
    }

    const lookaheadEnd = new Date(
      this.clock.now().getTime() + ACTIONABLE_OCCURRENCE_LOOKAHEAD_MS,
    );
    const records = (await this.prisma.routineOccurrence.findMany({
      where: {
        householdId: principal.householdId,
        recipientId: principal.recipientId,
        routine: { status: ROUTINE_STATUS.active, deletedAt: null },
        schedule: { active: true },
        OR: [
          {
            status: {
              in: [
                OCCURRENCE_STATUS.awaitingConfirmation,
                OCCURRENCE_STATUS.needsFamilyReview,
              ],
            },
          },
          {
            status: OCCURRENCE_STATUS.due,
            scheduledAtUtc: { lte: lookaheadEnd },
          },
        ],
      },
      include: { routine: true },
      orderBy: [{ scheduledAtUtc: 'asc' }, { id: 'asc' }],
      take: ACTIONABLE_OCCURRENCE_LIMIT,
    })) as OccurrenceRecord[];
    return records
      .filter(
        (occurrence) =>
          occurrence.status === OCCURRENCE_STATUS.awaitingConfirmation ||
          occurrence.status === OCCURRENCE_STATUS.needsFamilyReview ||
          (occurrence.status === OCCURRENCE_STATUS.due &&
            occurrence.scheduledAtUtc <= lookaheadEnd),
      )
      .map((occurrence) => this.toOccurrenceView(occurrence));
  }

  async confirmOccurrence(
    principal: CareWorkflowPrincipal,
    householdId: string,
    occurrenceId: string,
    command: ConfirmOccurrenceCommand,
  ): Promise<OccurrenceView> {
    return this.confirmOrVerify(
      { kind: 'USER', principal, householdId },
      occurrenceId,
      command,
      false,
      true,
    );
  }

  async confirmOccurrenceByDevice(
    principal: DevicePrincipal,
    occurrenceId: string,
    command: DeviceConfirmOccurrenceCommand,
  ): Promise<OccurrenceView> {
    this.assertCompanionCapability(principal);
    return this.confirmOrVerify(
      { kind: 'DEVICE', principal },
      occurrenceId,
      command,
      false,
      true,
    );
  }

  async requestFamilyContactByDevice(
    principal: DevicePrincipal,
    command: DeviceFamilyContactRequestCommand,
  ): Promise<FamilyContactRequestView> {
    this.assertCompanionCapability(principal);
    const idempotencyKey = this.requiredText(
      command.idempotencyKey,
      'idempotencyKey',
    );
    const occurrenceId = command.occurrenceId?.trim() || null;
    const commandType = 'DEVICE_FAMILY_CONTACT_REQUEST';
    const commandFingerprint = fingerprintCareCommand({
      bindingId: principal.bindingId,
      bindingVersion: principal.bindingVersion,
      deviceId: principal.deviceId,
      occurrenceId,
      recipientId: principal.recipientId,
      source: command.source,
    });
    const dedupeKey = occurrenceId
      ? `family-contact:occurrence:${occurrenceId}`
      : `family-contact:device:${principal.bindingId}:${idempotencyKey}`;

    return this.retrySerializable(async (transaction) => {
      await this.requireActiveCompanionBinding(transaction, principal);
      const replay = await replayCareCommand<FamilyContactRequestView>(
        transaction,
        idempotencyKey,
        commandType,
        commandFingerprint,
        this.cipher,
      );
      if (replay) return replay;

      const existingEvent = await transaction.careEvent.findFirst({
        where: { householdId: principal.householdId, dedupeKey },
        select: { id: true, routineOccurrenceId: true },
      });
      if (existingEvent) {
        const existingTask = (await transaction.familyTask.findUniqueOrThrow({
          where: { sourceEventId: existingEvent.id },
        })) as FamilyTaskRecord;
        return saveCareCommand(
          transaction,
          this.clock.now(),
          idempotencyKey,
          commandType,
          commandFingerprint,
          {
            accepted: true,
            careEventId: existingEvent.id,
            familyTaskId: existingTask.id,
            occurrenceId: existingEvent.routineOccurrenceId,
            taskStatus: existingTask.status,
          },
          this.cipher,
        );
      }

      let occurrence: Pick<
        OccurrenceRecord,
        'id' | 'status' | 'version'
      > | null = null;
      if (occurrenceId) {
        occurrence = await transaction.routineOccurrence.findFirst({
          where: {
            id: occurrenceId,
            householdId: principal.householdId,
            recipientId: principal.recipientId,
            status: {
              in: [
                OCCURRENCE_STATUS.due,
                OCCURRENCE_STATUS.awaitingConfirmation,
                OCCURRENCE_STATUS.needsFamilyReview,
              ],
            },
          },
          select: { id: true, status: true, version: true },
        });
        if (!occurrence) {
          throw new OccurrenceNotFoundException();
        }
        if (occurrence.status !== OCCURRENCE_STATUS.needsFamilyReview) {
          assertOccurrenceTransition(
            occurrence.status,
            OCCURRENCE_STATUS.needsFamilyReview,
          );
          const changed = await transaction.routineOccurrence.updateMany({
            where: {
              id: occurrence.id,
              householdId: principal.householdId,
              recipientId: principal.recipientId,
              status: occurrence.status,
              version: occurrence.version,
            },
            data: {
              status: OCCURRENCE_STATUS.needsFamilyReview,
              version: { increment: 1 },
            },
          });
          if (changed.count !== 1) {
            throw new CareWorkflowVersionConflictException();
          }
        }
      }

      const now = this.clock.now();
      const careEvent = await this.createCareEvent(transaction, now, {
        householdId: principal.householdId,
        recipientId: principal.recipientId,
        occurrenceId: occurrence?.id ?? null,
        sourceId: principal.bindingId,
        type: 'RECIPIENT_REQUESTED_FAMILY_CONTACT',
        severity: 'ATTENTION',
        sourceType: 'COMPANION_DEVICE',
        title: '长者希望联系家人',
        summary:
          '长者通过陪伴设备明确请求家属查看；系统未推断危险、健康状态或日程完成情况。',
        dedupeKey,
        payload: {
          bindingId: principal.bindingId,
          occurrenceId: occurrence?.id ?? null,
          requestSource: command.source,
          inferenceMade: false,
        },
      });
      const task = (await transaction.familyTask.create({
        data: {
          id: newUlid(now.getTime()),
          householdId: principal.householdId,
          recipientId: principal.recipientId,
          sourceEventId: careEvent.id,
          status: FAMILY_TASK_STATUS.open,
          priority: 'NORMAL',
          dueAt: now,
        },
      })) as FamilyTaskRecord;
      await this.writeOutbox(transaction, now, {
        aggregateType: 'CARE_EVENT',
        aggregateId: careEvent.id,
        eventType: 'care-event.family-contact-requested',
        payload: {
          householdId: principal.householdId,
          recipientId: principal.recipientId,
          occurrenceId: occurrence?.id ?? null,
          bindingId: principal.bindingId,
          careEventId: careEvent.id,
          familyTaskId: task.id,
        },
      });
      await this.writeOutbox(transaction, now, {
        aggregateType: 'FAMILY_TASK',
        aggregateId: task.id,
        eventType: 'family-task.opened',
        payload: {
          householdId: principal.householdId,
          recipientId: principal.recipientId,
          occurrenceId: occurrence?.id ?? null,
          careEventId: careEvent.id,
          familyTaskId: task.id,
        },
      });
      return saveCareCommand(
        transaction,
        now,
        idempotencyKey,
        commandType,
        commandFingerprint,
        {
          accepted: true,
          careEventId: careEvent.id,
          familyTaskId: task.id,
          occurrenceId: occurrence?.id ?? null,
          taskStatus: task.status,
        },
        this.cipher,
      );
    });
  }

  async familyVerifyOccurrence(
    principal: CareWorkflowPrincipal,
    householdId: string,
    occurrenceId: string,
    command: FamilyVerifyOccurrenceCommand,
  ): Promise<OccurrenceView> {
    return this.confirmOrVerify(
      { kind: 'USER', principal, householdId },
      occurrenceId,
      command,
      true,
      command.verified,
    );
  }

  async listCareEvents(
    principal: CareWorkflowPrincipal,
    householdId: string,
    recipientId: string,
  ): Promise<CareEventView[]> {
    await this.policy.requireRecipientAction(
      this.prisma,
      principal.userId,
      householdId,
      recipientId,
      'VIEW_EVENTS',
    );
    const events = (await this.prisma.careEvent.findMany({
      where: { householdId, recipientId },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    })) as CareEventRecord[];
    return events.map((event) => this.toCareEventView(event));
  }

  async listFamilyTasks(
    principal: CareWorkflowPrincipal,
    householdId: string,
    query?: { recipientId?: string; status?: string },
  ): Promise<FamilyTaskView[]> {
    await this.policy.requireHouseholdAction(
      this.prisma,
      principal.userId,
      householdId,
      'VIEW_HOUSEHOLD',
    );
    // Household-only queries still authorize against every returned recipient;
    // this prevents a VIEW_EVENTS grant for one recipient leaking another.
    const tasks = (await this.prisma.familyTask.findMany({
      where: {
        householdId,
        ...(query?.recipientId ? { recipientId: query.recipientId } : {}),
        ...(query?.status ? { status: query.status } : {}),
      },
      orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }],
    })) as FamilyTaskRecord[];
    const allowed: FamilyTaskView[] = [];
    for (const task of tasks) {
      try {
        await this.policy.requireRecipientAction(
          this.prisma,
          principal.userId,
          householdId,
          task.recipientId,
          'VIEW_EVENTS',
        );
        allowed.push(this.toFamilyTaskView(task));
      } catch (error) {
        // A household-scoped list is a filtered projection, not an oracle for
        // care recipients to which the member has no Care Authority.
        if (
          !(error instanceof HouseholdAccessDeniedException) &&
          !(error instanceof RecipientAccessDeniedException)
        ) {
          throw error;
        }
      }
    }
    return allowed;
  }

  claimFamilyTask(
    principal: CareWorkflowPrincipal,
    householdId: string,
    taskId: string,
    command: ClaimFamilyTaskCommand,
  ): Promise<FamilyTaskView> {
    return this.actOnFamilyTask(
      principal,
      householdId,
      taskId,
      'CLAIM',
      command,
    );
  }

  resolveFamilyTask(
    principal: CareWorkflowPrincipal,
    householdId: string,
    taskId: string,
    command: FinishFamilyTaskCommand,
  ): Promise<FamilyTaskView> {
    return this.actOnFamilyTask(
      principal,
      householdId,
      taskId,
      'RESOLVE',
      command,
    );
  }

  dismissFamilyTask(
    principal: CareWorkflowPrincipal,
    householdId: string,
    taskId: string,
    command: FinishFamilyTaskCommand,
  ): Promise<FamilyTaskView> {
    return this.actOnFamilyTask(
      principal,
      householdId,
      taskId,
      'DISMISS',
      command,
    );
  }

  private async confirmOrVerify(
    authority: OccurrenceConfirmationAuthority,
    occurrenceId: string,
    command:
      | ConfirmOccurrenceCommand
      | DeviceConfirmOccurrenceCommand
      | FamilyVerifyOccurrenceCommand,
    familyVerification: boolean,
    verified: boolean,
  ): Promise<OccurrenceView> {
    const idempotencyKey = this.requiredText(
      command.idempotencyKey,
      'idempotencyKey',
    );
    const now = this.clock.now();
    const householdId =
      authority.kind === 'DEVICE'
        ? authority.principal.householdId
        : authority.householdId;
    return this.retrySerializable(async (transaction) => {
      const occurrence = (await transaction.routineOccurrence.findFirst({
        where: {
          id: occurrenceId,
          householdId,
          ...(authority.kind === 'DEVICE'
            ? { recipientId: authority.principal.recipientId }
            : {}),
        },
        include: { routine: true },
      })) as OccurrenceRecord | null;
      if (!occurrence) throw new OccurrenceNotFoundException();
      const actor = await this.authorizeOccurrenceConfirmation(
        transaction,
        authority,
        occurrence.recipientId,
      );
      const confirmationType = familyVerification
        ? verified
          ? 'FAMILY_VERIFIED'
          : 'FAMILY_REJECTED'
        : 'RECIPIENT_CONFIRMED';
      const note = command.note?.trim() || null;
      const bindingId = familyVerification
        ? null
        : authority.kind === 'DEVICE'
          ? actor.bindingId
          : (command as ConfirmOccurrenceCommand).bindingId?.trim() || null;
      const utteranceId = familyVerification
        ? null
        : (command as ConfirmOccurrenceCommand).utteranceId?.trim() || null;
      const commandType = familyVerification
        ? 'FAMILY_VERIFY_OCCURRENCE'
        : 'CONFIRM_OCCURRENCE';
      const commandFingerprint = fingerprintCareCommand({
        actorBindingId: actor.bindingId,
        actorMemberId: actor.memberId,
        bindingId,
        confirmationType,
        householdId,
        note,
        occurrenceId,
        source: familyVerification
          ? null
          : (command as ConfirmOccurrenceCommand).source,
        utteranceId,
        verified,
        version: command.version,
      });
      const replay = await replayCareCommand<OccurrenceView>(
        transaction,
        idempotencyKey,
        commandType,
        commandFingerprint,
        this.cipher,
      );
      if (replay) return replay;
      if (authority.kind === 'DEVICE' && utteranceId) {
        const utterance = await transaction.conversationUtterance.findFirst({
          where: {
            id: utteranceId,
            bindingId: authority.principal.bindingId,
            modelSession: {
              companionSession: {
                bindingId: authority.principal.bindingId,
                householdId,
                recipientId: authority.principal.recipientId,
              },
            },
          },
          select: { id: true },
        });
        if (!utterance) {
          throw new DeviceOccurrenceAccessDeniedException();
        }
      }
      if (occurrence.version !== command.version) {
        throw new CareWorkflowVersionConflictException();
      }
      const targetStatus = verified
        ? OCCURRENCE_STATUS.confirmed
        : OCCURRENCE_STATUS.expired;
      assertOccurrenceTransition(occurrence.status, targetStatus);
      if (
        !familyVerification &&
        occurrence.status !== OCCURRENCE_STATUS.awaitingConfirmation
      ) {
        // Explicitly prevent a late self-confirmation from bypassing family
        // review. Once escalated, only family-verify may close the occurrence.
        throw new InvalidOccurrenceTransitionException(
          occurrence.status,
          targetStatus,
        );
      }
      const updated = await transaction.routineOccurrence.updateMany({
        where: {
          id: occurrenceId,
          householdId,
          version: command.version,
          status: occurrence.status,
        },
        data: {
          status: targetStatus,
          completedAt: verified ? now : null,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new CareWorkflowVersionConflictException();
      }
      const encryptedNote = note ? this.cipher.encrypt(note) : null;
      await transaction.routineConfirmation.create({
        data: {
          id: newUlid(now.getTime()),
          occurrenceId,
          confirmationType,
          source: familyVerification
            ? 'FAMILY_MEMBER'
            : (command as ConfirmOccurrenceCommand).source,
          memberId: actor.memberId,
          bindingId,
          utteranceId,
          noteCiphertext: encryptedNote
            ? this.toPrismaBytes(encryptedNote.ciphertext)
            : null,
          noteNonce: encryptedNote
            ? this.toPrismaBytes(encryptedNote.nonce)
            : null,
          encryptionKeyId: encryptedNote?.encryptionKeyId ?? null,
          confirmedAt: now,
          idempotencyKey,
        },
      });

      const event = await this.createCareEvent(transaction, now, {
        householdId,
        recipientId: occurrence.recipientId,
        occurrenceId,
        type: verified ? 'ROUTINE_CONFIRMED' : 'ROUTINE_NOT_CONFIRMED',
        severity: verified ? 'INFO' : 'ATTENTION',
        sourceType: familyVerification ? 'FAMILY' : 'RECIPIENT',
        title: verified ? '日程已确认' : '家属确认未完成',
        summary: verified
          ? '已记录明确确认。此记录不代表医疗判断。'
          : '家属明确核验为未完成。',
        dedupeKey: `occurrence:${occurrenceId}:${confirmationType}`,
        payload: {
          confirmationType,
          ...(actor.memberId ? { actorMemberId: actor.memberId } : {}),
          ...(actor.bindingId ? { actorBindingId: actor.bindingId } : {}),
        },
      });
      // The escalation task points to its own source event, not the new closure
      // event, so find it through the occurrence event when present.
      const openTask = actor.memberId
        ? ((await transaction.familyTask.findFirst({
            where: {
              householdId,
              recipientId: occurrence.recipientId,
              status: {
                in: [FAMILY_TASK_STATUS.open, FAMILY_TASK_STATUS.claimed],
              },
              sourceEvent: { routineOccurrenceId: occurrenceId },
            },
          })) as FamilyTaskRecord | null)
        : null;
      if (openTask && actor.memberId) {
        if (
          openTask.assigneeMemberId &&
          openTask.assigneeMemberId !== actor.memberId
        ) {
          throw new FamilyTaskAssigneeConflictException();
        }
        const closedStatus = verified
          ? FAMILY_TASK_STATUS.resolved
          : FAMILY_TASK_STATUS.dismissed;
        await transaction.familyTask.update({
          where: { id: openTask.id },
          data: {
            status: closedStatus,
            assigneeMemberId: openTask.assigneeMemberId ?? actor.memberId,
            resolvedAt: now,
            resolutionCode: verified
              ? 'FAMILY_VERIFIED_COMPLETE'
              : 'FAMILY_VERIFIED_NOT_COMPLETE',
            version: { increment: 1 },
          },
        });
        await transaction.familyTaskAction.create({
          data: {
            id: newUlid(now.getTime()),
            taskId: openTask.id,
            actorMemberId: actor.memberId,
            action: familyVerification ? 'FAMILY_VERIFY' : 'AUTO_CLOSE',
            fromStatus: openTask.status,
            toStatus: closedStatus,
            occurredAt: now,
            idempotencyKey,
          },
        });
        await this.writeOutbox(transaction, now, {
          aggregateType: 'FAMILY_TASK',
          aggregateId: openTask.id,
          eventType: `family-task.${closedStatus.toLowerCase()}`,
          payload: {
            householdId,
            recipientId: occurrence.recipientId,
            taskId: openTask.id,
            occurrenceId,
          },
        });
      }
      await this.writeOutbox(transaction, now, {
        aggregateType: 'ROUTINE_OCCURRENCE',
        aggregateId: occurrenceId,
        eventType: verified
          ? 'routine-occurrence.confirmed'
          : 'routine-occurrence.expired',
        payload: {
          householdId,
          recipientId: occurrence.recipientId,
          occurrenceId,
          careEventId: event.id,
        },
      });
      const result = (await transaction.routineOccurrence.findUniqueOrThrow({
        where: { id: occurrenceId },
        include: { routine: true },
      })) as OccurrenceRecord;
      return saveCareCommand(
        transaction,
        now,
        idempotencyKey,
        commandType,
        commandFingerprint,
        this.toOccurrenceView(result),
        this.cipher,
      );
    });
  }

  private async authorizeOccurrenceConfirmation(
    transaction: TransactionClient,
    authority: OccurrenceConfirmationAuthority,
    recipientId: string,
  ): Promise<OccurrenceConfirmationActor> {
    if (authority.kind === 'USER') {
      const member = await this.policy.requireRecipientAction(
        transaction,
        authority.principal.userId,
        authority.householdId,
        recipientId,
        'MANAGE_ROUTINE',
      );
      return { memberId: member.id, bindingId: null };
    }

    const principal = authority.principal;
    if (
      recipientId !== principal.recipientId ||
      !principal.capabilities.includes('COMPANION')
    ) {
      throw new DeviceOccurrenceAccessDeniedException();
    }
    await this.requireActiveCompanionBinding(transaction, principal);
    return { memberId: null, bindingId: principal.bindingId };
  }

  private assertCompanionCapability(principal: DevicePrincipal): void {
    if (!principal.capabilities.includes('COMPANION')) {
      throw new DeviceOccurrenceAccessDeniedException();
    }
  }

  private async requireActiveCompanionBinding(
    transaction: TransactionClient,
    principal: DevicePrincipal,
  ): Promise<void> {
    const binding = await transaction.companionBinding.findFirst({
      where: {
        id: principal.bindingId,
        bindingVersion: principal.bindingVersion,
        deviceId: principal.deviceId,
        householdId: principal.householdId,
        recipientId: principal.recipientId,
        status: 'ACTIVE',
        revokedAt: null,
        device: { status: 'ACTIVE' },
        household: { status: 'ACTIVE' },
        recipient: { status: 'ACTIVE', deletedAt: null },
      },
      select: { id: true },
    });
    if (!binding) {
      throw new DeviceOccurrenceAccessDeniedException();
    }
  }

  private async actOnFamilyTask(
    principal: CareWorkflowPrincipal,
    householdId: string,
    taskId: string,
    action: 'CLAIM' | 'RESOLVE' | 'DISMISS',
    command: ClaimFamilyTaskCommand | FinishFamilyTaskCommand,
  ): Promise<FamilyTaskView> {
    const idempotencyKey = this.requiredText(
      command.idempotencyKey,
      'idempotencyKey',
    );
    const now = this.clock.now();
    return this.retrySerializable(async (transaction) => {
      const task = (await transaction.familyTask.findFirst({
        where: { id: taskId, householdId },
      })) as FamilyTaskRecord | null;
      if (!task) throw new FamilyTaskNotFoundException();
      const member = await this.policy.requireRecipientAction(
        transaction,
        principal.userId,
        householdId,
        task.recipientId,
        'VIEW_EVENTS',
      );
      const finish = command as FinishFamilyTaskCommand;
      const note = action === 'CLAIM' ? null : finish.note?.trim() || null;
      const resolutionCode =
        action === 'CLAIM'
          ? null
          : this.requiredText(finish.resolutionCode, 'resolutionCode');
      const commandType = `FAMILY_TASK_${action}`;
      const commandFingerprint = fingerprintCareCommand({
        action,
        actorMemberId: member.id,
        householdId,
        note,
        resolutionCode,
        taskId,
        version: command.version,
      });
      const replay = await replayCareCommand<FamilyTaskView>(
        transaction,
        idempotencyKey,
        commandType,
        commandFingerprint,
        this.cipher,
      );
      if (replay) return replay;
      if (task.version !== command.version) {
        throw action === 'CLAIM'
          ? new FamilyTaskClaimConflictException()
          : new CareWorkflowVersionConflictException();
      }
      if (action === 'CLAIM') {
        assertTaskCanClaim(task.status);
      } else {
        assertTaskCanFinish(task.status, action);
        if (task.assigneeMemberId && task.assigneeMemberId !== member.id) {
          throw new FamilyTaskAssigneeConflictException();
        }
      }
      const toStatus =
        action === 'CLAIM'
          ? FAMILY_TASK_STATUS.claimed
          : action === 'RESOLVE'
            ? FAMILY_TASK_STATUS.resolved
            : FAMILY_TASK_STATUS.dismissed;
      const encryptedNote = note ? this.cipher.encrypt(note) : null;
      const updated = await transaction.familyTask.updateMany({
        where: {
          id: taskId,
          householdId,
          version: command.version,
          status: task.status,
        },
        data: {
          status: toStatus,
          assigneeMemberId: task.assigneeMemberId ?? member.id,
          ...(action === 'CLAIM'
            ? {}
            : {
                resolvedAt: now,
                resolutionCode,
                resolutionNoteCiphertext: encryptedNote
                  ? this.toPrismaBytes(encryptedNote.ciphertext)
                  : null,
                resolutionNoteNonce: encryptedNote
                  ? this.toPrismaBytes(encryptedNote.nonce)
                  : null,
                encryptionKeyId: encryptedNote?.encryptionKeyId ?? null,
              }),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw action === 'CLAIM'
          ? new FamilyTaskClaimConflictException()
          : new CareWorkflowVersionConflictException();
      }
      await transaction.familyTaskAction.create({
        data: {
          id: newUlid(now.getTime()),
          taskId,
          actorMemberId: member.id,
          action,
          fromStatus: task.status,
          toStatus,
          noteCiphertext: encryptedNote
            ? this.toPrismaBytes(encryptedNote.ciphertext)
            : null,
          noteNonce: encryptedNote
            ? this.toPrismaBytes(encryptedNote.nonce)
            : null,
          encryptionKeyId: encryptedNote?.encryptionKeyId ?? null,
          occurredAt: now,
          idempotencyKey,
        },
      });
      await this.writeOutbox(transaction, now, {
        aggregateType: 'FAMILY_TASK',
        aggregateId: taskId,
        eventType: `family-task.${action.toLowerCase()}`,
        payload: {
          householdId,
          recipientId: task.recipientId,
          taskId,
          actorMemberId: member.id,
        },
      });
      const result = (await transaction.familyTask.findUniqueOrThrow({
        where: { id: taskId },
      })) as FamilyTaskRecord;
      return saveCareCommand(
        transaction,
        now,
        idempotencyKey,
        commandType,
        commandFingerprint,
        this.toFamilyTaskView(result),
        this.cipher,
      );
    });
  }

  private async createCareEvent(
    transaction: TransactionClient,
    now: Date,
    command: {
      householdId: string;
      recipientId: string;
      occurrenceId: string | null;
      sourceId?: string | null;
      type: string;
      severity: string;
      sourceType: string;
      title: string;
      summary: string;
      dedupeKey: string;
      payload: Prisma.InputJsonValue;
    },
  ): Promise<CareEventRecord> {
    const protectedContent = this.encryptPair(command.title, command.summary);
    return await transaction.careEvent.create({
      data: {
        id: newUlid(now.getTime()),
        householdId: command.householdId,
        recipientId: command.recipientId,
        type: command.type,
        severity: command.severity,
        sourceType: command.sourceType,
        sourceId: command.sourceId ?? command.occurrenceId,
        routineOccurrenceId: command.occurrenceId,
        titleCiphertext: protectedContent.first,
        summaryCiphertext: protectedContent.second,
        contentNonce: protectedContent.nonce,
        encryptionKeyId: protectedContent.encryptionKeyId,
        dedupeKey: command.dedupeKey,
        payloadJson: command.payload,
        occurredAt: now,
      },
    });
  }

  private validateSchedule(input: RoutineScheduleInput) {
    if (!input.timezone.trim()) {
      throw new InvalidScheduleException('timezone 不能为空');
    }
    if (
      !Number.isInteger(input.weekdayMask) ||
      input.weekdayMask < 1 ||
      input.weekdayMask > 0b1111111
    ) {
      throw new InvalidScheduleException('weekdayMask 必须选择至少一天');
    }
    if (
      !Number.isInteger(input.graceMinutes) ||
      input.graceMinutes < 0 ||
      input.graceMinutes > 1440
    ) {
      throw new InvalidScheduleException('graceMinutes 必须在 0 到 1440 之间');
    }
    if (
      !Number.isInteger(input.familyNoticeMinutes) ||
      input.familyNoticeMinutes < 0 ||
      input.familyNoticeMinutes > 10080
    ) {
      throw new InvalidScheduleException(
        'familyNoticeMinutes 必须在 0 到 10080 之间',
      );
    }
    // This validates both the minute and IANA timezone. A null result can be a
    // legitimate DST gap and therefore does not invalidate the recurring rule.
    localMinuteToUtc(
      { year: 2026, month: 1, day: 15 },
      input.localTimeMinutes,
      input.timezone,
    );
    const startDate = parseIsoDate(input.startDate);
    const endDate = input.endDate ? parseIsoDate(input.endDate) : null;
    if (endDate && endDate < startDate) {
      throw new InvalidScheduleException('endDate 不能早于 startDate');
    }
    return {
      timezone: input.timezone,
      localTimeMinutes: input.localTimeMinutes,
      weekdayMask: input.weekdayMask,
      startDate,
      endDate,
      graceMinutes: input.graceMinutes,
      familyNoticeMinutes: input.familyNoticeMinutes,
    };
  }

  private requireRoutineType(value: string): RoutineType {
    if (!(ROUTINE_TYPES as readonly string[]).includes(value)) {
      throw new InvalidRoutineTypeException();
    }
    return value as RoutineType;
  }

  private async requireMedicationReference(
    transaction: TransactionClient,
    householdId: string,
    recipientId: string,
    type: RoutineType,
    medicationId: string | null,
  ): Promise<void> {
    if (type !== 'MEDICATION') {
      if (medicationId) throw new InvalidMedicationReferenceException();
      return;
    }
    if (!medicationId) return;
    const medication = await transaction.medication.findFirst({
      where: {
        id: medicationId,
        householdId,
        recipientId,
        status: 'ACTIVE',
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!medication) throw new InvalidMedicationReferenceException();
  }

  private requiredText(value: string, field: string): string {
    const normalized = value?.trim();
    if (!normalized) {
      throw new InvalidScheduleException(`${field} 不能为空`);
    }
    return normalized;
  }

  private encryptPair(first: string, second: string) {
    const protectedContent = this.cipher.encrypt(
      JSON.stringify([first, second]),
    );
    const splitAt = Math.ceil(protectedContent.ciphertext.length / 2);
    return {
      first: this.toPrismaBytes(
        protectedContent.ciphertext.subarray(0, splitAt),
      ),
      second: this.toPrismaBytes(protectedContent.ciphertext.subarray(splitAt)),
      nonce: this.toPrismaBytes(protectedContent.nonce),
      encryptionKeyId: protectedContent.encryptionKeyId,
    };
  }

  private decryptPair(record: {
    instructionsCiphertext?: Uint8Array;
    confirmationQuestionCiphertext?: Uint8Array;
    titleCiphertext?: Uint8Array;
    summaryCiphertext?: Uint8Array;
    contentNonce: Uint8Array;
    encryptionKeyId: string;
  }): { first: string; second: string } {
    const first = record.instructionsCiphertext ?? record.titleCiphertext;
    const second =
      record.confirmationQuestionCiphertext ?? record.summaryCiphertext;
    if (!first || !second) throw new Error('Protected content pair is missing');
    const plaintext = this.cipher.decrypt({
      ciphertext: Buffer.concat([Buffer.from(first), Buffer.from(second)]),
      nonce: Buffer.from(record.contentNonce),
      encryptionKeyId: record.encryptionKeyId,
    });
    const parsed: unknown = JSON.parse(plaintext);
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== 'string' ||
      typeof parsed[1] !== 'string'
    ) {
      throw new Error('Protected content pair is invalid');
    }
    return { first: parsed[0], second: parsed[1] };
  }

  private toRoutineView(record: RoutineRecord): RoutineView {
    const content = this.decryptPair(record);
    return {
      id: record.id,
      householdId: record.householdId,
      recipientId: record.recipientId,
      type: this.requireRoutineType(record.type),
      medicationId: record.medicationId,
      title: record.title,
      instructions: content.first,
      confirmationQuestion: content.second,
      // Medication content is always a verbatim family-authored record. No
      // inference about dose, danger, or whether medicine was actually taken.
      contentProvenance: 'FAMILY_ENTERED_VERBATIM',
      status: record.status,
      schedules: record.schedules.map((schedule) => ({
        id: schedule.id,
        timezone: schedule.timezone,
        localTimeMinutes: schedule.localTimeMinutes,
        weekdayMask: schedule.weekdayMask,
        startDate: schedule.startDate.toISOString().slice(0, 10),
        endDate: schedule.endDate?.toISOString().slice(0, 10) ?? null,
        graceMinutes: schedule.graceMinutes,
        familyNoticeMinutes: schedule.familyNoticeMinutes,
        scheduleVersion: schedule.scheduleVersion,
      })),
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      version: record.version,
    };
  }

  private toOccurrenceView(record: OccurrenceRecord): OccurrenceView {
    const content = this.decryptPair(record.routine);
    return {
      id: record.id,
      householdId: record.householdId,
      recipientId: record.recipientId,
      routineId: record.routineId,
      scheduleId: record.scheduleId,
      routineTitle: record.routine.title,
      routineType: record.routine.type,
      instructions: content.first,
      contentProvenance: 'FAMILY_ENTERED_VERBATIM',
      scheduledAtUtc: record.scheduledAtUtc.toISOString(),
      scheduledLocalDate: record.scheduledLocalDate.toISOString().slice(0, 10),
      status: record.status,
      confirmationDeadlineAt:
        record.confirmationDeadlineAt?.toISOString() ?? null,
      escalationAt: record.escalationAt?.toISOString() ?? null,
      completedAt: record.completedAt?.toISOString() ?? null,
      version: record.version,
    };
  }

  private toCareEventView(record: CareEventRecord): CareEventView {
    const content = this.decryptPair(record);
    return {
      id: record.id,
      householdId: record.householdId,
      recipientId: record.recipientId,
      type: record.type,
      severity: record.severity,
      sourceType: record.sourceType,
      sourceId: record.sourceId,
      routineOccurrenceId: record.routineOccurrenceId,
      title: content.first,
      summary: content.second,
      payload: record.payloadJson,
      occurredAt: record.occurredAt.toISOString(),
      createdAt: record.createdAt.toISOString(),
    };
  }

  private toFamilyTaskView(record: FamilyTaskRecord): FamilyTaskView {
    let resolutionNote: string | null = null;
    if (
      record.resolutionNoteCiphertext &&
      record.resolutionNoteNonce &&
      record.encryptionKeyId
    ) {
      resolutionNote = this.cipher.decrypt({
        ciphertext: Buffer.from(record.resolutionNoteCiphertext),
        nonce: Buffer.from(record.resolutionNoteNonce),
        encryptionKeyId: record.encryptionKeyId,
      });
    }
    return {
      id: record.id,
      householdId: record.householdId,
      recipientId: record.recipientId,
      sourceEventId: record.sourceEventId,
      assigneeMemberId: record.assigneeMemberId,
      status: record.status,
      priority: record.priority,
      dueAt: record.dueAt?.toISOString() ?? null,
      resolvedAt: record.resolvedAt?.toISOString() ?? null,
      resolutionCode: record.resolutionCode,
      resolutionNote,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      version: record.version,
    };
  }

  private writeOutbox(
    transaction: TransactionClient,
    now: Date,
    event: {
      aggregateType: string;
      aggregateId: string;
      eventType: string;
      payload: Prisma.InputJsonValue;
    },
  ) {
    return transaction.outboxEvent.create({
      data: {
        id: newUlid(now.getTime()),
        aggregateType: event.aggregateType,
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payloadJson: event.payload,
        occurredAt: now,
        availableAt: now,
      },
    });
  }

  private serializable<T>(
    work: (transaction: TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(work, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
    });
  }

  private async retrySerializable<T>(
    work: (transaction: TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.serializable(work);
      } catch (error) {
        if (
          this.isRetryableConflict(error) &&
          attempt < SERIALIZABLE_RETRY_LIMIT
        ) {
          continue;
        }
        throw error;
      }
    }
    throw new CareWorkflowVersionConflictException();
  }

  private isRetryableConflict(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === 'P2034' || error.code === 'P2002')
    );
  }

  private toPrismaBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(value);
  }
}
