import type { RateLimitDimensionKind } from './rate-limit.types';
import { RateLimitPolicy } from './rate-limit.types';

export interface RateLimitBucketPolicy {
  id: string;
  limit: number;
  windowMs: number;
  dimensions: readonly RateLimitDimensionKind[];
}

const SECOND = 1_000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const RATE_LIMIT_POLICY_DEFINITIONS: Readonly<
  Record<RateLimitPolicy, readonly RateLimitBucketPolicy[]>
> = {
  [RateLimitPolicy.AUTH_REGISTER]: [
    { id: 'ip-burst', limit: 5, windowMs: 10 * MINUTE, dimensions: ['ip'] },
    { id: 'ip-daily', limit: 20, windowMs: DAY, dimensions: ['ip'] },
    { id: 'email', limit: 3, windowMs: DAY, dimensions: ['email'] },
    { id: 'username', limit: 3, windowMs: DAY, dimensions: ['username'] },
  ],
  [RateLimitPolicy.AUTH_LOGIN]: [
    { id: 'ip-burst', limit: 20, windowMs: MINUTE, dimensions: ['ip'] },
    { id: 'ip-hourly', limit: 100, windowMs: HOUR, dimensions: ['ip'] },
    {
      id: 'account',
      limit: 10,
      windowMs: 15 * MINUTE,
      dimensions: ['identifier'],
    },
    {
      id: 'ip-account',
      limit: 5,
      windowMs: 5 * MINUTE,
      dimensions: ['ip', 'identifier'],
    },
  ],
  [RateLimitPolicy.AUTH_REFRESH]: [
    { id: 'ip', limit: 120, windowMs: 15 * MINUTE, dimensions: ['ip'] },
    {
      id: 'credential',
      limit: 30,
      windowMs: 15 * MINUTE,
      dimensions: ['refresh-token'],
    },
  ],
  [RateLimitPolicy.AUTH_EMAIL_VERIFICATION_REQUEST]: [
    { id: 'ip', limit: 20, windowMs: HOUR, dimensions: ['ip'] },
    { id: 'email', limit: 3, windowMs: HOUR, dimensions: ['email'] },
    {
      id: 'account',
      limit: 5,
      windowMs: 15 * MINUTE,
      dimensions: ['user-account'],
    },
    {
      id: 'source-session',
      limit: 5,
      windowMs: 15 * MINUTE,
      dimensions: ['user-session'],
    },
    {
      id: 'ip-account',
      limit: 3,
      windowMs: 15 * MINUTE,
      dimensions: ['ip', 'user-account'],
    },
  ],
  [RateLimitPolicy.AUTH_EMAIL_VERIFICATION_CONFIRM]: [
    { id: 'ip', limit: 20, windowMs: 15 * MINUTE, dimensions: ['ip'] },
    {
      id: 'email',
      limit: 5,
      windowMs: 15 * MINUTE,
      dimensions: ['email'],
    },
    {
      id: 'ip-email',
      limit: 5,
      windowMs: 15 * MINUTE,
      dimensions: ['ip', 'email'],
    },
  ],
  [RateLimitPolicy.AUTH_PASSWORD_RESET_REQUEST]: [
    { id: 'ip', limit: 10, windowMs: HOUR, dimensions: ['ip'] },
    {
      id: 'account',
      limit: 3,
      windowMs: HOUR,
      dimensions: ['identifier'],
    },
    {
      id: 'ip-account',
      limit: 3,
      windowMs: 15 * MINUTE,
      dimensions: ['ip', 'identifier'],
    },
  ],
  [RateLimitPolicy.AUTH_PASSWORD_RESET_CONFIRM]: [
    { id: 'ip', limit: 10, windowMs: 15 * MINUTE, dimensions: ['ip'] },
    {
      id: 'token',
      limit: 5,
      windowMs: HOUR,
      dimensions: ['one-time-token'],
    },
  ],
  [RateLimitPolicy.DEVICE_INSTALLATION_REGISTER]: [
    { id: 'ip', limit: 20, windowMs: HOUR, dimensions: ['ip'] },
    {
      id: 'public-key',
      limit: 5,
      windowMs: DAY,
      dimensions: ['installation-public-key'],
    },
  ],
  [RateLimitPolicy.DEVICE_ACTIVATION_CREATE]: [
    { id: 'ip', limit: 20, windowMs: HOUR, dimensions: ['ip'] },
    {
      id: 'account',
      limit: 10,
      windowMs: HOUR,
      dimensions: ['user-account'],
    },
    {
      id: 'source-session',
      limit: 10,
      windowMs: HOUR,
      dimensions: ['user-session'],
    },
    {
      id: 'recipient',
      limit: 5,
      windowMs: 15 * MINUTE,
      dimensions: ['recipient-id'],
    },
    {
      id: 'account-recipient',
      limit: 5,
      windowMs: HOUR,
      dimensions: ['user-account', 'recipient-id'],
    },
  ],
  [RateLimitPolicy.DEVICE_ACTIVATION_STATUS]: [
    { id: 'ip', limit: 120, windowMs: MINUTE, dimensions: ['ip'] },
    {
      id: 'challenge',
      limit: 90,
      windowMs: MINUTE,
      dimensions: ['challenge-id'],
    },
  ],
  [RateLimitPolicy.DEVICE_ACTIVATION_CLAIM]: [
    { id: 'ip', limit: 20, windowMs: 15 * MINUTE, dimensions: ['ip'] },
    {
      id: 'public-id',
      limit: 5,
      windowMs: 15 * MINUTE,
      dimensions: ['public-activation-id'],
    },
    {
      id: 'installation',
      limit: 5,
      windowMs: 15 * MINUTE,
      dimensions: ['installation-id'],
    },
    {
      id: 'claim-pair',
      limit: 5,
      windowMs: 15 * MINUTE,
      dimensions: ['public-activation-id', 'installation-id'],
    },
  ],
  [RateLimitPolicy.DEVICE_ACTIVATION_APPROVE]: [
    { id: 'ip', limit: 30, windowMs: 15 * MINUTE, dimensions: ['ip'] },
    {
      id: 'account',
      limit: 10,
      windowMs: 15 * MINUTE,
      dimensions: ['user-account'],
    },
    {
      id: 'source-session',
      limit: 10,
      windowMs: 15 * MINUTE,
      dimensions: ['user-session'],
    },
    {
      id: 'challenge',
      limit: 5,
      windowMs: 15 * MINUTE,
      dimensions: ['challenge-id'],
    },
    {
      id: 'account-challenge',
      limit: 3,
      windowMs: 15 * MINUTE,
      dimensions: ['user-account', 'challenge-id'],
    },
  ],
  [RateLimitPolicy.DEVICE_CREDENTIAL_EXCHANGE]: [
    { id: 'ip', limit: 30, windowMs: 15 * MINUTE, dimensions: ['ip'] },
    {
      id: 'challenge',
      limit: 5,
      windowMs: 15 * MINUTE,
      dimensions: ['challenge-id'],
    },
    {
      id: 'installation',
      limit: 10,
      windowMs: 15 * MINUTE,
      dimensions: ['installation-id'],
    },
  ],
  [RateLimitPolicy.DEVICE_CREDENTIAL_REFRESH]: [
    { id: 'ip', limit: 120, windowMs: 15 * MINUTE, dimensions: ['ip'] },
    {
      id: 'credential',
      limit: 30,
      windowMs: 15 * MINUTE,
      dimensions: ['device-credential'],
    },
  ],
  [RateLimitPolicy.REMOTE_POLICY_UPDATE]: [
    { id: 'ip', limit: 20, windowMs: 15 * MINUTE, dimensions: ['ip'] },
    {
      id: 'account',
      limit: 5,
      windowMs: 15 * MINUTE,
      dimensions: ['user-account'],
    },
    {
      id: 'source-session',
      limit: 5,
      windowMs: 15 * MINUTE,
      dimensions: ['user-session'],
    },
    {
      id: 'target-device',
      limit: 5,
      windowMs: 15 * MINUTE,
      dimensions: ['binding-id'],
    },
    {
      id: 'account-device',
      limit: 3,
      windowMs: 15 * MINUTE,
      dimensions: ['user-account', 'binding-id'],
    },
  ],
  [RateLimitPolicy.REMOTE_SESSION_REQUEST]: [
    { id: 'ip', limit: 12, windowMs: MINUTE, dimensions: ['ip'] },
    {
      id: 'account',
      limit: 6,
      windowMs: MINUTE,
      dimensions: ['user-account'],
    },
    {
      id: 'source-session',
      limit: 5,
      windowMs: MINUTE,
      dimensions: ['user-session'],
    },
    {
      id: 'target-device',
      limit: 6,
      windowMs: MINUTE,
      dimensions: ['binding-id'],
    },
    {
      id: 'account-device',
      limit: 3,
      windowMs: MINUTE,
      dimensions: ['user-account', 'binding-id'],
    },
    {
      id: 'ip-device',
      limit: 4,
      windowMs: MINUTE,
      dimensions: ['ip', 'binding-id'],
    },
  ],
  [RateLimitPolicy.SENSITIVE_WRITE_REAUTHENTICATION]: [
    { id: 'ip', limit: 20, windowMs: 15 * MINUTE, dimensions: ['ip'] },
    {
      id: 'account',
      limit: 5,
      windowMs: 15 * MINUTE,
      dimensions: ['user-account'],
    },
    {
      id: 'source-session',
      limit: 5,
      windowMs: 15 * MINUTE,
      dimensions: ['user-session'],
    },
    {
      id: 'ip-account',
      limit: 5,
      windowMs: 15 * MINUTE,
      dimensions: ['ip', 'user-account'],
    },
  ],
};
