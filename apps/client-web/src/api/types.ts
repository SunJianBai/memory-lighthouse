export type IdentityView = {
  type: string;
  value: string;
  verifiedAt: string | null;
  isPrimary: boolean;
};

export type UserView = {
  id: string;
  displayName: string;
  status: string;
  locale: string;
  timezone: string;
  identities: IdentityView[];
  createdAt: string;
};

export type SessionTokenView = {
  accessToken: string;
  accessTokenExpiresAt: string;
  expiresInSeconds: number;
  clientType: "WEB";
  refreshTokenExpiresAt: string;
  sessionId: string;
};

export type SessionView = {
  id: string;
  clientType: string;
  current: boolean;
  issuedAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  userAgent: string | null;
};

export type HouseholdView = {
  id: string;
  name: string;
  timezone: string;
  status: string;
  roleCodes: Array<"OWNER" | "CAREGIVER" | "VIEWER">;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type HouseholdMemberView = {
  id: string;
  householdId: string;
  userId: string;
  displayName: string;
  status: string;
  roleCodes: Array<"OWNER" | "CAREGIVER" | "VIEWER">;
  joinedAt: string | null;
  version: number;
};

export type HouseholdInvitationView = {
  id: string;
  householdId: string;
  targetEmail: string;
  roleCode: "OWNER" | "CAREGIVER" | "VIEWER";
  expiresAt: string;
  createdAt: string;
};

export type CareRecipientView = {
  id: string;
  householdId: string;
  name: string;
  preferredName: string;
  birthDate: string | null;
  timezone: string;
  homeLabel: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type MemoryRevisionView = {
  id: string;
  revisionNo: number;
  content: string;
  source: string;
  changeReason: string | null;
  createdByMemberId: string;
  createdAt: string;
};

export type MemoryView = {
  id: string;
  householdId: string;
  recipientId: string;
  kind: string;
  title: string;
  sensitivity: string;
  verificationStatus: string;
  status: string;
  currentRevision: MemoryRevisionView;
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type RoutineScheduleView = {
  id: string;
  timezone: string;
  localTimeMinutes: number;
  weekdayMask: number;
  startDate: string;
  endDate: string | null;
  graceMinutes: number;
  familyNoticeMinutes: number;
  scheduleVersion: number;
};

export type RoutineView = {
  id: string;
  householdId: string;
  recipientId: string;
  type: string;
  medicationId: string | null;
  title: string;
  instructions: string;
  confirmationQuestion: string;
  contentProvenance: "FAMILY_ENTERED_VERBATIM";
  status: string;
  schedules: RoutineScheduleView[];
  createdAt: string;
  updatedAt: string;
  version: number;
};

export type FamilyTaskView = {
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
};

export type CompanionBindingView = {
  id: string;
  deviceId: string;
  householdId: string;
  recipientId: string;
  displayName: string;
  status: string;
  activatedAt: string;
  revokedAt: string | null;
  bindingVersion: number;
  version: number;
};

export type ActivationPresentation = {
  challengeId: string;
  publicId: string;
  dynamicCode: string;
  qrPayload: string;
  expiresAt: string;
};

export type ConsentScope =
  | "CAMERA_CAPTURE"
  | "MICROPHONE_CAPTURE"
  | "MODEL_PROCESSING"
  | "MODEL_INPUT_TRANSCRIPTION"
  | "REMOTE_ASSISTANCE_AUDIO"
  | "REMOTE_ASSISTANCE_VIDEO"
  | "MEMORY_STORAGE"
  | "CONTENT_INSPECTION";

export type ConsentDocumentVersionView = {
  id: string;
  code: string;
  version: number;
  publishedAt: string;
};

export type ConsentEventView = {
  id: string;
  scope: ConsentScope;
  decision: "GRANTED" | "REVOKED";
  documentVersion: ConsentDocumentVersionView;
  reason: string | null;
  occurredAt: string;
};

export type ConsentStateView = {
  scope: ConsentScope;
  granted: boolean;
  decision: "GRANTED" | "REVOKED" | "NOT_GRANTED";
  lastEvent: ConsentEventView | null;
  version: number;
};

export type RequestedRemoteMedia = {
  receiveDeviceAudio: boolean;
  receiveDeviceVideo: boolean;
  sendFamilyAudio: boolean;
  sendFamilyVideo: false;
};

export type RemoteSessionView = {
  id: string;
  householdId: string;
  recipientId: string;
  bindingId: string;
  answerMode: "ONSITE_ANSWER";
  media: RequestedRemoteMedia;
  status: string;
  requestedAt: string;
  acceptedAt: string | null;
  connectedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  version: number;
};

export type RemoteAvailabilityView = {
  bindingId: string;
  online: boolean;
  busy: boolean;
  answerMode: "ONSITE_ANSWER";
  lastSeenAt: string | null;
};

export type RemoteJoinTicketView = {
  sessionId: string;
  participantId: string;
  participantIdentity: string;
  url: string;
  token: string;
  expiresAt: string;
  media: RequestedRemoteMedia;
  recording: false;
  transcription: false;
};

export type DeviceContextView = {
  deviceId: string;
  bindingId: string;
  householdId: string;
  recipientId: string;
  recipient: { id: string; preferredName: string; timezone: string };
  consent: { capturedAt: string; decisions: Record<string, boolean> };
  model: { provider: string; model: string; realtimeUrl: string };
};

export type CompanionSessionStartView = {
  session: { id: string; mode: "AUDIO" | "AUDIO_VIDEO"; status: string };
  consent: DeviceContextView["consent"];
  careSnapshot: {
    recipient: DeviceContextView["recipient"];
    memories: Array<{
      id: string;
      kind: string;
      title: string;
      content: string;
      sensitivity: string;
      verificationStatus: string;
      revisionNo: number;
    }>;
  };
};

export type ModelConnectionView = {
  session: { id: string; companionSessionId: string; status: string };
  connection: { realtimeUrl: string; model: string };
  prompt: { id: string; code: string; version: number; content: string };
  careSnapshot: CompanionSessionStartView["careSnapshot"];
  consent: DeviceContextView["consent"];
};
