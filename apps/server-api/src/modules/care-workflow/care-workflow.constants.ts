export const CARE_WORKFLOW_CLOCK = Symbol('CARE_WORKFLOW_CLOCK');
export const CARE_WORKFLOW_CONTENT_CIPHER = Symbol(
  'CARE_WORKFLOW_CONTENT_CIPHER',
);
export const OCCURRENCE_SCHEDULER = Symbol('OCCURRENCE_SCHEDULER');

export const ROUTINE_STATUS = {
  active: 'ACTIVE',
  deleted: 'DELETED',
} as const;

export const OCCURRENCE_STATUS = {
  due: 'DUE',
  awaitingConfirmation: 'AWAITING_CONFIRMATION',
  confirmed: 'CONFIRMED',
  needsFamilyReview: 'NEEDS_FAMILY_REVIEW',
  expired: 'EXPIRED',
} as const;

export type OccurrenceStatus =
  (typeof OCCURRENCE_STATUS)[keyof typeof OCCURRENCE_STATUS];

export const FAMILY_TASK_STATUS = {
  open: 'OPEN',
  claimed: 'CLAIMED',
  resolved: 'RESOLVED',
  dismissed: 'DISMISSED',
} as const;

export const ROUTINE_TYPES = [
  'MEDICATION',
  'MEAL',
  'HYDRATION',
  'ACTIVITY',
  'APPOINTMENT',
  'OTHER',
] as const;

export type RoutineType = (typeof ROUTINE_TYPES)[number];

/** Bit 0 is Sunday and bit 6 is Saturday, matching Date#getUTCDay. */
export const EVERY_DAY_WEEKDAY_MASK = 0b1111111;

export const SERIALIZABLE_RETRY_LIMIT = 3;
export const CARE_WORKFLOW_ENCRYPTION_KEY_ID = 'care-workflow-v1';
export const ACTIONABLE_OCCURRENCE_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
export const ACTIONABLE_OCCURRENCE_LIMIT = 32;
