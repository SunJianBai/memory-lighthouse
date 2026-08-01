export interface RequestedRemoteMedia {
  receiveDeviceAudio: boolean;
  receiveDeviceVideo: boolean;
  sendFamilyAudio: boolean;
  sendFamilyVideo: boolean;
}

export interface RemoteAccessPolicyView {
  id: string;
  householdId: string;
  recipientId: string;
  bindingId: string;
  mode: 'ONSITE_ANSWER';
  cameraAllowed: boolean;
  microphoneAllowed: boolean;
  sendFamilyAudioAllowed: boolean;
  countdownSeconds: number;
  status: string;
  validFrom: string;
  validUntil: string | null;
  version: number;
}

export interface RemoteAvailabilityView {
  bindingId: string;
  online: boolean;
  busy: boolean;
  companionActive: boolean;
  answerMode: 'ONSITE_ANSWER';
  lastSeenAt: string | null;
}

export interface RemoteSessionView {
  id: string;
  householdId: string;
  recipientId: string;
  bindingId: string;
  initiatedByMemberId: string;
  answerMode: 'ONSITE_ANSWER';
  media: RequestedRemoteMedia;
  status: string;
  requestedAt: string;
  acceptedAt: string | null;
  connectedAt: string | null;
  endedAt: string | null;
  endReason: string | null;
  version: number;
}

export interface RemoteJoinTicketView {
  sessionId: string;
  ticketId: string;
  participantId: string;
  participantIdentity: string;
  url: string;
  token: string;
  expiresAt: string;
  media: RequestedRemoteMedia;
  recording: false;
  transcription: false;
}

export interface LiveKitJoinTicketCommand {
  roomName: string;
  identity: string;
  displayName: string;
  ttlSeconds: number;
  publishMicrophone: boolean;
  publishCamera: boolean;
  canSubscribe: boolean;
  metadata: Record<string, string>;
}

export interface VerifiedLiveKitWebhook {
  eventId: string;
  event: string;
  roomName: string | null;
  participantIdentity: string | null;
  participantSid: string | null;
  participantId: string | null;
  participantTicketId: string | null;
  trackSource: 'microphone' | 'camera' | 'unknown' | null;
  occurredAt: Date;
}
