import {
  OCCURRENCE_STATUS,
  type OccurrenceStatus,
} from '../care-workflow.constants';
import { InvalidOccurrenceTransitionException } from '../care-workflow.errors';

const ALLOWED_TRANSITIONS: Readonly<
  Record<OccurrenceStatus, OccurrenceStatus[]>
> = {
  [OCCURRENCE_STATUS.due]: [
    OCCURRENCE_STATUS.awaitingConfirmation,
    OCCURRENCE_STATUS.expired,
  ],
  [OCCURRENCE_STATUS.awaitingConfirmation]: [
    OCCURRENCE_STATUS.confirmed,
    OCCURRENCE_STATUS.needsFamilyReview,
    OCCURRENCE_STATUS.expired,
  ],
  [OCCURRENCE_STATUS.needsFamilyReview]: [
    OCCURRENCE_STATUS.confirmed,
    OCCURRENCE_STATUS.expired,
  ],
  [OCCURRENCE_STATUS.confirmed]: [],
  [OCCURRENCE_STATUS.expired]: [],
};

export function requireOccurrenceStatus(value: string): OccurrenceStatus {
  if (Object.values<string>(OCCURRENCE_STATUS).includes(value)) {
    return value as OccurrenceStatus;
  }
  throw new InvalidOccurrenceTransitionException(value, 'UNKNOWN');
}

export function assertOccurrenceTransition(
  from: string,
  to: OccurrenceStatus,
): void {
  const current = requireOccurrenceStatus(from);
  if (!ALLOWED_TRANSITIONS[current].includes(to)) {
    throw new InvalidOccurrenceTransitionException(current, to);
  }
}
