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
// Room creation runs while MySQL holds the remote-session row lock. Keep the
// provider deadline strictly below the explicit transaction timeout so a slow
// CreateRoom call cannot outlive that lock and resurrect a terminal room.
export const LIVEKIT_RPC_TIMEOUT_SECONDS = 3;
export const REMOTE_ROOM_PROVISIONING_TRANSACTION_TIMEOUT_MS = 8_000;
export const REMOTE_TERMINATION_TRANSACTION_TIMEOUT_MS = 15_000;
export const REMOTE_ROOM_PROVISIONING_STALE_SECONDS = 15;
// Keep initial admission short. Self-hosted LiveKit cannot revoke a refreshed
// participant token; explicit room creation, disabled auto-create and terminal
// room deletion prevent such a token from recreating an ended session.
export const REMOTE_JOIN_TICKET_TTL_SECONDS = 60;
// A CreateRoom request that timed out client-side may still finish at the
// provider. Re-delete conservatively through the normal empty-room/token
// window. Core admission safety does not assume this is a provider completion
// bound; the session-wide provisioning owner cannot issue a token on timeout.
export const REMOTE_ROOM_PROVISIONING_FENCE_SECONDS =
  REMOTE_JOIN_TICKET_TTL_SECONDS + LIVEKIT_RPC_TIMEOUT_SECONDS;
