import type {
  ConsentScope,
  PersistedConsentDecision,
} from './consent.constants';

export interface ConsentDocumentVersionView {
  id: string;
  code: string;
  version: number;
  publishedAt: string;
}

export interface ConsentEventView {
  id: string;
  householdId: string;
  recipientId: string;
  scope: ConsentScope;
  decision: PersistedConsentDecision;
  documentVersion: ConsentDocumentVersionView;
  decidedByMemberId: string;
  reason: string | null;
  supersedesEventId: string | null;
  occurredAt: string;
}

export interface ConsentStateView {
  scope: ConsentScope;
  granted: boolean;
  decision: PersistedConsentDecision | 'NOT_GRANTED';
  lastEvent: ConsentEventView | null;
  version: number;
}

export interface ConsentEventPage {
  items: ConsentEventView[];
  nextCursor: string | null;
}

export interface DecideConsentCommand {
  userId: string;
  householdId: string;
  recipientId: string;
  scope: string;
  documentVersionId: string;
  reason?: string;
  idempotencyKey: string;
}

export interface ListConsentEventsQuery {
  userId: string;
  householdId: string;
  recipientId: string;
  cursor?: string;
  limit?: number;
}
