export type MemoryKind =
  "person" | "medication" | "routine" | "preference" | "place" | "story";

export type AssetKind = "face" | "medicine" | "place" | "document" | "voice";

export type CareEventType =
  | "routine_due"
  | "reminder_spoken"
  | "user_confirmed"
  | "family_acknowledged"
  | "needs_confirmation"
  | "family_contacted"
  | "memory_used"
  | "session_started"
  | "session_ended";

export type CareEventSeverity = "info" | "attention" | "important";
export type CareEventStatus = "open" | "acknowledged" | "resolved";

export type StoredAsset = {
  id: string;
  kind: AssetKind;
  name: string;
  mimeType: string;
  dataUrl: string;
  createdAt: string;
};

export type CareRecipient = {
  id: string;
  name: string;
  preferredName: string;
  birthday: string;
  homeLabel: string;
  avatarAssetId?: string;
  communicationNotes: string;
};

export type TrustedPerson = {
  id: string;
  name: string;
  relationship: string;
  phone: string;
  priority: number;
  faceAssetId?: string;
  canViewEvidence: boolean;
};

export type MedicationMemory = {
  id: string;
  name: string;
  alias: string;
  purpose: string;
  scheduledTimes: string[];
  requirements: string;
  containerLabel: string;
  containerLocation: string;
  imageAssetId?: string;
  active: boolean;
  notes: string;
};

export type RoutineCategory =
  "medication" | "hydration" | "departure" | "daily";

export type Routine = {
  id: string;
  title: string;
  category: RoutineCategory;
  scheduledTime: string;
  weekdays: number[];
  linkedMedicationId?: string;
  instructions: string;
  confirmationQuestion: string;
  graceMinutes: number;
  familyNoticeMinutes: number;
  enabled: boolean;
  occurrenceId?: string;
  occurrenceVersion?: number;
  occurrenceStatus?: string;
  scheduledAtUtc?: string;
};

export type MemoryItem = {
  id: string;
  kind: MemoryKind;
  title: string;
  content: string;
  tags: string[];
  sensitivity: "normal" | "sensitive";
  assetId?: string;
  createdAt: string;
  updatedAt: string;
};

export type CareEvent = {
  id: string;
  type: CareEventType;
  severity: CareEventSeverity;
  status: CareEventStatus;
  title: string;
  summary: string;
  occurredAt: string;
  routineId?: string;
  evidenceAssetId?: string;
  transcript?: string;
  source: "agent" | "user" | "caregiver" | "demo";
};

export type ConsentState = {
  localStorageApproved: boolean;
  cameraApproved: boolean;
  microphoneApproved: boolean;
  sensitiveMemoryApproved: boolean;
  cloudProcessingApproved: boolean;
  acceptedAt?: string;
};

export type ProviderConfig = {
  provider: "local" | "cloud" | "replay";
  localRealtimeWs: string;
  localChatHttp: string;
  cloudRealtimeWs: string;
  cloudBaseUrl: string;
  model: string;
  referenceAudio?: string;
};

export type AppState = {
  schemaVersion: 1;
  initialized: boolean;
  recipient: CareRecipient;
  trustedPeople: TrustedPerson[];
  medications: MedicationMemory[];
  routines: Routine[];
  memories: MemoryItem[];
  assets: StoredAsset[];
  events: CareEvent[];
  consent: ConsentState;
  provider: ProviderConfig;
};

export type AgentPhase =
  | "idle"
  | "observing"
  | "reminding"
  | "awaiting_confirmation"
  | "completed"
  | "needs_attention";

export type AgentState = {
  phase: AgentPhase;
  activeRoutineId?: string;
  reminderCount: number;
  lastTransitionAt: string;
  message: string;
};

export type AgentAction =
  | { type: "SESSION_STARTED"; at: string }
  | { type: "ROUTINE_DUE"; routineId: string; at: string }
  | { type: "REMINDER_DELIVERED"; at: string }
  | { type: "USER_CONFIRMED"; at: string }
  | { type: "CONFIRMATION_TIMEOUT"; at: string }
  | { type: "FAMILY_REQUESTED"; at: string }
  | { type: "FAMILY_ACKNOWLEDGED"; at: string }
  | { type: "SESSION_ENDED"; at: string };
