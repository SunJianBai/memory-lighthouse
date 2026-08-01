import { OCCURRENCE_STATUS } from '../care-workflow.constants';
import { InvalidOccurrenceTransitionException } from '../care-workflow.errors';
import { assertOccurrenceTransition } from './occurrence-state-machine';

describe('Occurrence state machine', () => {
  it('accepts the explicit confirmation and escalation paths', () => {
    expect(() =>
      assertOccurrenceTransition(
        OCCURRENCE_STATUS.due,
        OCCURRENCE_STATUS.awaitingConfirmation,
      ),
    ).not.toThrow();
    expect(() =>
      assertOccurrenceTransition(
        OCCURRENCE_STATUS.awaitingConfirmation,
        OCCURRENCE_STATUS.confirmed,
      ),
    ).not.toThrow();
    expect(() =>
      assertOccurrenceTransition(
        OCCURRENCE_STATUS.awaitingConfirmation,
        OCCURRENCE_STATUS.needsFamilyReview,
      ),
    ).not.toThrow();
    expect(() =>
      assertOccurrenceTransition(
        OCCURRENCE_STATUS.needsFamilyReview,
        OCCURRENCE_STATUS.expired,
      ),
    ).not.toThrow();
  });

  it('rejects generic or backwards status changes', () => {
    expect(() =>
      assertOccurrenceTransition(
        OCCURRENCE_STATUS.due,
        OCCURRENCE_STATUS.confirmed,
      ),
    ).toThrow(InvalidOccurrenceTransitionException);
    expect(() =>
      assertOccurrenceTransition(
        OCCURRENCE_STATUS.confirmed,
        OCCURRENCE_STATUS.awaitingConfirmation,
      ),
    ).toThrow(InvalidOccurrenceTransitionException);
  });
});
