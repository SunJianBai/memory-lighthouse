import type { UserPrincipal } from '../identity/identity.types';
import type { RoutineType } from './care-workflow.constants';

export type CareWorkflowPrincipal = UserPrincipal;

export interface RoutineScheduleInput {
  timezone: string;
  localTimeMinutes: number;
  weekdayMask: number;
  startDate: string;
  endDate?: string | null;
  graceMinutes: number;
  familyNoticeMinutes: number;
}

export interface RoutineScheduleView {
  id: string;
  timezone: string;
  localTimeMinutes: number;
  weekdayMask: number;
  startDate: string;
  endDate: string | null;
  graceMinutes: number;
  familyNoticeMinutes: number;
  scheduleVersion: number;
}

export interface RoutineView {
  id: string;
  householdId: string;
  recipientId: string;
  type: RoutineType;
  medicationId: string | null;
  title: string;
  instructions: string;
  confirmationQuestion: string;
  contentProvenance: 'FAMILY_ENTERED_VERBATIM';
  status: string;
  schedules: RoutineScheduleView[];
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface CreateRoutineCommand {
  type: string;
  medicationId?: string | null;
  title: string;
  instructions: string;
  confirmationQuestion: string;
  schedule: RoutineScheduleInput;
}

export interface UpdateRoutineCommand {
  version: number;
  type?: string;
  medicationId?: string | null;
  title?: string;
  instructions?: string;
  confirmationQuestion?: string;
  schedule?: RoutineScheduleInput;
}

export interface OccurrenceView {
  id: string;
  householdId: string;
  recipientId: string;
  routineId: string;
  scheduleId: string;
  routineTitle: string;
  routineType: string;
  instructions: string;
  contentProvenance: 'FAMILY_ENTERED_VERBATIM';
  scheduledAtUtc: string;
  scheduledLocalDate: string;
  status: string;
  confirmationDeadlineAt: string | null;
  escalationAt: string | null;
  completedAt: string | null;
  version: number;
}

export interface ConfirmOccurrenceCommand {
  version: number;
  idempotencyKey: string;
  source: 'RECIPIENT_BUTTON' | 'RECIPIENT_VOICE';
  note?: string | null;
  bindingId?: string | null;
  utteranceId?: string | null;
}

export type DeviceConfirmOccurrenceCommand = Omit<
  ConfirmOccurrenceCommand,
  'bindingId'
>;

export interface FamilyVerifyOccurrenceCommand {
  version: number;
  idempotencyKey: string;
  verified: boolean;
  note?: string | null;
}

export interface CareEventView {
  id: string;
  householdId: string;
  recipientId: string;
  type: string;
  severity: string;
  sourceType: string;
  sourceId: string | null;
  routineOccurrenceId: string | null;
  title: string;
  summary: string;
  payload: unknown;
  occurredAt: string;
  createdAt: string;
}

export interface FamilyTaskView {
  id: string;
  householdId: string;
  recipientId: string;
  sourceEventId: string;
  assigneeMemberId: string | null;
  status: string;
  priority: string;
  dueAt: string | null;
  resolvedAt: string | null;
  resolutionCode: string | null;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface ClaimFamilyTaskCommand {
  version: number;
}

export interface FinishFamilyTaskCommand {
  version: number;
  resolutionCode: string;
  note?: string | null;
}

export interface GenerateOccurrencesCommand {
  windowStartUtc: Date;
  windowEndUtc: Date;
}

export interface GenerateOccurrencesResult {
  attempted: number;
  created: number;
}

export interface AdvanceOccurrencesCommand {
  now: Date;
  batchSize?: number;
}

export interface AdvanceOccurrencesResult {
  awaitingConfirmation: number;
  needsFamilyReview: number;
  expired: number;
}
