import type {
  CompanionMode,
  ModelEventType,
  UtteranceSource,
  UtteranceSpeaker,
} from './companion-session.constants';
import type { DevicePrincipal } from '../device-activation/device-activation.types';

export interface ConsentSnapshot {
  capturedAt: string;
  decisions: Record<string, boolean>;
}

export interface CareMemorySnapshot {
  id: string;
  kind: string;
  title: string;
  content: string;
  sensitivity: string;
  verificationStatus: string;
  revisionNo: number;
}

export interface CareRoutineOccurrenceSnapshot {
  id: string;
  routineId: string;
  routineTitle: string;
  routineType: string;
  instructions: string;
  confirmationQuestion?: string;
  scheduledAtUtc: string;
  status: string;
  confirmationDeadlineAt: string | null;
  escalationAt: string | null;
  version: number;
}

export interface CareSnapshot {
  schemaVersion: 1;
  recipient: {
    id: string;
    preferredName: string;
    timezone: string;
  };
  memories: CareMemorySnapshot[];
  occurrences: CareRoutineOccurrenceSnapshot[];
}

export interface DeviceContextView {
  deviceId: string;
  bindingId: string;
  householdId: string;
  recipientId: string;
  recipient: CareSnapshot['recipient'];
  consent: ConsentSnapshot;
  careSnapshot: CareSnapshot;
  model: {
    provider: string;
    model: string;
    realtimeUrl: string;
  };
}

export interface CompanionSessionView {
  id: string;
  householdId: string;
  recipientId: string;
  bindingId: string;
  mode: CompanionMode;
  status: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  traceId: string;
  version: number;
}

export interface CompanionSessionStartView {
  session: CompanionSessionView;
  consent: ConsentSnapshot;
  careSnapshot: CareSnapshot;
}

export interface ModelSessionView {
  id: string;
  companionSessionId: string;
  provider: string;
  model: string;
  status: string;
  startedAt: string;
  firstResponseAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  errorCode: string | null;
}

export interface ModelConnectionView {
  session: ModelSessionView;
  connection: {
    realtimeUrl: string;
    model: string;
  };
  prompt: {
    id: string;
    code: string;
    version: number;
    content: string;
  };
  careSnapshot: CareSnapshot;
  consent: ConsentSnapshot;
}

export interface UtteranceView {
  id: string;
  modelSessionId: string;
  sequenceNo: number;
  speaker: UtteranceSpeaker;
  source: UtteranceSource;
  providerEventId: string;
  startOffsetMs: number | null;
  endOffsetMs: number | null;
  isFinal: boolean;
  language: string | null;
  confidence: number | null;
  charCount: number | null;
  createdAt: string;
}

export interface StartCompanionSessionCommand {
  principal: DevicePrincipal;
  mode: CompanionMode;
  idempotencyKey: string;
  traceId: string;
}

export interface StartModelSessionCommand {
  principal: DevicePrincipal;
  companionSessionId: string;
  idempotencyKey: string;
}

export interface AppendUtteranceCommand {
  principal: DevicePrincipal;
  modelSessionId: string;
  sequenceNo: number;
  speaker: UtteranceSpeaker;
  source: UtteranceSource;
  providerEventId: string;
  rawText?: string;
  startOffsetMs?: number;
  endOffsetMs?: number;
  isFinal: boolean;
  language?: string;
  confidence?: number;
}

export interface AppendModelEventCommand {
  principal: DevicePrincipal;
  modelSessionId: string;
  eventType: ModelEventType;
  metrics?: Record<string, number>;
  errorCode?: string;
  occurredAt?: Date;
}
