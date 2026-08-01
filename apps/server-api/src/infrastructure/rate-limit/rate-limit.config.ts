import { createHash } from 'node:crypto';

import { ConfigService } from '@nestjs/config';

import type { RateLimitConfig } from './rate-limit.types';

const DEVELOPMENT_KEY_CONTEXT =
  'memory-lighthouse/insecure-development-rate-limit-key/v1';
const DEFAULT_REDIS_PREFIX = 'openbmb:rate-limit:v1';

function readInteger(
  config: ConfigService,
  key: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const raw = config.get<string | number>(key);
  const value = raw === undefined || raw === '' ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(
      `${key} must be an integer between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function decodeKeySecret(raw: string): Buffer | undefined {
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    return undefined;
  }
  const decoded = Buffer.from(raw, 'base64url');
  if (decoded.length < 32 || decoded.toString('base64url') !== raw) {
    return undefined;
  }
  return decoded;
}

function readKeySecret(
  config: ConfigService,
  environment: RateLimitConfig['environment'],
): Buffer {
  const raw = config.get<string>('RATE_LIMIT_KEY_SECRET')?.trim();
  if (raw) {
    const decoded = decodeKeySecret(raw);
    if (!decoded) {
      throw new Error(
        'RATE_LIMIT_KEY_SECRET must be canonical base64url containing at least 32 bytes',
      );
    }
    return decoded;
  }

  if (environment === 'production') {
    throw new Error('RATE_LIMIT_KEY_SECRET is required in production');
  }

  return createHash('sha256').update(DEVELOPMENT_KEY_CONTEXT).digest();
}

function readRedisUrl(
  config: ConfigService,
  environment: RateLimitConfig['environment'],
): string | undefined {
  const raw = config.get<string>('REDIS_URL')?.trim();
  if (!raw) {
    if (environment === 'production') {
      throw new Error('REDIS_URL is required in production');
    }
    return undefined;
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL');
  }
  if (
    (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') ||
    !parsed.hostname
  ) {
    throw new Error('REDIS_URL must be a valid redis:// or rediss:// URL');
  }
  if (environment === 'production' && !parsed.password) {
    throw new Error('REDIS_URL must include authentication in production');
  }
  return raw;
}

function readRedisPrefix(
  config: ConfigService,
  environment: RateLimitConfig['environment'],
): string {
  const value =
    config.get<string>('RATE_LIMIT_REDIS_PREFIX')?.trim() ??
    DEFAULT_REDIS_PREFIX;
  if (!/^[A-Za-z0-9:_-]{1,64}$/.test(value)) {
    throw new Error(
      'RATE_LIMIT_REDIS_PREFIX must use 1-64 alphanumeric, colon, underscore, or dash characters',
    );
  }
  if (environment === 'production' && !value.startsWith('openbmb:')) {
    throw new Error(
      'RATE_LIMIT_REDIS_PREFIX must use the production openbmb: ACL namespace',
    );
  }
  return value;
}

export function createRateLimitConfig(config: ConfigService): RateLimitConfig {
  const environment = config.get<RateLimitConfig['environment']>(
    'NODE_ENV',
    'development',
  );
  const redisUrl = readRedisUrl(config, environment);

  return {
    environment,
    backend:
      environment === 'test' || redisUrl === undefined ? 'memory' : 'redis',
    keySecret: readKeySecret(config, environment),
    redisUrl,
    redisPrefix: readRedisPrefix(config, environment),
    redisConnectTimeoutMs: readInteger(
      config,
      'RATE_LIMIT_REDIS_CONNECT_TIMEOUT_MS',
      5_000,
      100,
      30_000,
    ),
    trustProxyHops: readInteger(config, 'RATE_LIMIT_TRUST_PROXY_HOPS', 0, 0, 1),
  };
}
