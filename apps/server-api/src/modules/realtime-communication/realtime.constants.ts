export const MEDIA_LEASE_PORT = Symbol('MEDIA_LEASE_PORT');
export const LIVEKIT_PORT = Symbol('LIVEKIT_PORT');

export const REMOTE_SESSION_STATUS = {
  ringing: 'RINGING',
  accepted: 'ACCEPTED',
  connecting: 'CONNECTING',
  active: 'ACTIVE',
  ending: 'ENDING',
  ended: 'ENDED',
  declined: 'DECLINED',
  cancelled: 'CANCELLED',
  expired: 'EXPIRED',
  failed: 'FAILED',
  revoked: 'REVOKED',
} as const;

export const TERMINAL_REMOTE_STATUSES = [
  REMOTE_SESSION_STATUS.ended,
  REMOTE_SESSION_STATUS.declined,
  REMOTE_SESSION_STATUS.cancelled,
  REMOTE_SESSION_STATUS.expired,
  REMOTE_SESSION_STATUS.failed,
  REMOTE_SESSION_STATUS.revoked,
] as const;

export const OPEN_REMOTE_STATUSES = [
  REMOTE_SESSION_STATUS.ringing,
  REMOTE_SESSION_STATUS.accepted,
  REMOTE_SESSION_STATUS.connecting,
  REMOTE_SESSION_STATUS.active,
  REMOTE_SESSION_STATUS.ending,
] as const;

export const REMOTE_ANSWER_MODE = {
  onsite: 'ONSITE_ANSWER',
} as const;

export const REMOTE_POLICY_MODE = {
  onsite: 'ONSITE_ANSWER',
} as const;

export const REMOTE_MEDIA_LEASE_TTL_SECONDS = 90;
export const REMOTE_RING_TIMEOUT_SECONDS = 60;
export const REMOTE_CONNECT_TIMEOUT_SECONDS = 180;
// Self-hosted LiveKit join tokens cannot be centrally revoked before a
// participant exists. Keep the replay window to the lower end of the
// documented 1-2 minute range and revoke joined identities on termination.
export const REMOTE_JOIN_TICKET_TTL_SECONDS = 60;
