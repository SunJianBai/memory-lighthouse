import { createHash } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import {
  ACTIVATION_CHALLENGE_MAX_ATTEMPTS,
  ACTIVATION_CHALLENGE_TTL_SECONDS,
  DEVICE_ACCESS_TOKEN_TTL_SECONDS,
  DEVICE_CREDENTIAL_TTL_SECONDS,
} from './device-activation.constants';

export interface DeviceActivationSecurityConfig {
  activationPepper: Buffer;
  credentialPepper: Buffer;
  accessTokenSecret: Buffer;
  accessTokenTtlSeconds: number;
  environment: 'development' | 'test' | 'production';
  challengeTtlSeconds: number;
  challengeMaxAttempts: number;
  credentialTtlSeconds: number;
}

function readPositiveInteger(
  config: ConfigService,
  key: string,
  fallback: number,
): number {
  const raw = config.get<string | number>(key);
  if (raw === undefined || raw === '') {
    return fallback;
  }

  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${key} must be a positive integer`);
  }
  return value;
}

function decodePepper(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, 'base64url');
  if (decoded.length < 32 || decoded.toString('base64url') !== value) {
    return null;
  }
  return decoded;
}

function readPepper(config: ConfigService, key: string): Buffer {
  const raw = config.get<string>(key)?.trim();
  if (raw) {
    const decoded = decodePepper(raw);
    if (!decoded) {
      throw new Error(
        `${key} must be canonical base64url containing at least 32 bytes`,
      );
    }
    return decoded;
  }

  if (config.get<string>('NODE_ENV') === 'production') {
    throw new Error(`${key} is required in production`);
  }

  // This deterministic value is deliberately limited to local/test builds.
  return createHash('sha256')
    .update('memory-lighthouse/insecure-development-only\0', 'utf8')
    .update(key, 'utf8')
    .digest();
}

export function createDeviceActivationSecurityConfig(
  config: ConfigService,
): DeviceActivationSecurityConfig {
  const environment =
    config.get<'development' | 'test' | 'production'>('NODE_ENV') ??
    'development';
  return {
    activationPepper: readPepper(config, 'DEVICE_ACTIVATION_PEPPER'),
    credentialPepper: readPepper(config, 'DEVICE_CREDENTIAL_PEPPER'),
    accessTokenSecret: readPepper(config, 'DEVICE_ACCESS_TOKEN_SECRET'),
    accessTokenTtlSeconds: readPositiveInteger(
      config,
      'DEVICE_ACCESS_TOKEN_TTL_SECONDS',
      DEVICE_ACCESS_TOKEN_TTL_SECONDS,
    ),
    environment,
    challengeTtlSeconds: readPositiveInteger(
      config,
      'DEVICE_ACTIVATION_CHALLENGE_TTL_SECONDS',
      ACTIVATION_CHALLENGE_TTL_SECONDS,
    ),
    challengeMaxAttempts: readPositiveInteger(
      config,
      'DEVICE_ACTIVATION_MAX_ATTEMPTS',
      ACTIVATION_CHALLENGE_MAX_ATTEMPTS,
    ),
    credentialTtlSeconds: readPositiveInteger(
      config,
      'DEVICE_CREDENTIAL_TTL_SECONDS',
      DEVICE_CREDENTIAL_TTL_SECONDS,
    ),
  };
}
