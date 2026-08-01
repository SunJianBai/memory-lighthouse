export const DEVICE_ACTIVATION_CLOCK = Symbol('DEVICE_ACTIVATION_CLOCK');
export const DEVICE_ACTIVATION_SECURITY_CONFIG = Symbol(
  'DEVICE_ACTIVATION_SECURITY_CONFIG',
);

export const ACTIVATION_CHALLENGE_TTL_SECONDS = 5 * 60;
export const ACTIVATION_CHALLENGE_MAX_ATTEMPTS = 5;
export const DEVICE_CREDENTIAL_TTL_SECONDS = 30 * 24 * 60 * 60;
export const DEVICE_ACCESS_TOKEN_TTL_SECONDS = 10 * 60;

export const CHALLENGE_STATUS = {
  pending: 'PENDING',
  claimed: 'CLAIMED',
  approved: 'APPROVED',
  consumed: 'CONSUMED',
  cancelled: 'CANCELLED',
  expired: 'EXPIRED',
  attemptsExceeded: 'ATTEMPTS_EXCEEDED',
} as const;

export const BINDING_STATUS = {
  active: 'ACTIVE',
  suspended: 'SUSPENDED',
  revoked: 'REVOKED',
} as const;

export const DEVICE_STATUS = {
  registered: 'REGISTERED',
  active: 'ACTIVE',
  revoked: 'REVOKED',
} as const;
