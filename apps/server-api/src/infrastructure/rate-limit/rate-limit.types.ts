export enum RateLimitPolicy {
  AUTH_REGISTER = 'auth-register',
  AUTH_LOGIN = 'auth-login',
  AUTH_REFRESH = 'auth-refresh',
  AUTH_EMAIL_VERIFICATION_REQUEST = 'auth-email-verification-request',
  AUTH_EMAIL_VERIFICATION_CONFIRM = 'auth-email-verification-confirm',
  AUTH_PASSWORD_RESET_REQUEST = 'auth-password-reset-request',
  AUTH_PASSWORD_RESET_CONFIRM = 'auth-password-reset-confirm',
  DEVICE_INSTALLATION_REGISTER = 'device-installation-register',
  DEVICE_ACTIVATION_CREATE = 'device-activation-create',
  DEVICE_ACTIVATION_STATUS = 'device-activation-status',
  DEVICE_ACTIVATION_CLAIM = 'device-activation-claim',
  DEVICE_ACTIVATION_APPROVE = 'device-activation-approve',
  DEVICE_CREDENTIAL_EXCHANGE = 'device-credential-exchange',
  DEVICE_CREDENTIAL_REFRESH = 'device-credential-refresh',
  REMOTE_POLICY_UPDATE = 'remote-policy-update',
  REMOTE_SESSION_REQUEST = 'remote-session-request',
  SENSITIVE_WRITE_REAUTHENTICATION = 'sensitive-write-reauthentication',
}

export type RateLimitDimensionKind =
  | 'ip'
  | 'identifier'
  | 'email'
  | 'username'
  | 'one-time-token'
  | 'refresh-token'
  | 'installation-public-key'
  | 'installation-id'
  | 'public-activation-id'
  | 'challenge-id'
  | 'recipient-id'
  | 'device-credential'
  | 'user-account'
  | 'user-session'
  | 'binding-id';

export interface RateLimitConfig {
  environment: 'development' | 'test' | 'production';
  backend: 'memory' | 'redis';
  keySecret: Buffer;
  redisUrl?: string;
  redisPrefix: string;
  redisConnectTimeoutMs: number;
  trustProxyHops: number;
}

export interface RateLimitBucket {
  key: string;
  limit: number;
  windowMs: number;
}

export interface RateLimitStoreDecision {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitDimension {
  kind: RateLimitDimensionKind;
  value: string;
}
