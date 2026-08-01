import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { createRateLimitConfig } from './rate-limit.config';

const KEY_SECRET = Buffer.alloc(32, 7).toString('base64url');

describe('createRateLimitConfig', () => {
  it('requires Redis and an independent HMAC key in production', () => {
    expect(() =>
      createRateLimitConfig(
        new ConfigService({
          NODE_ENV: 'production',
          RATE_LIMIT_KEY_SECRET: KEY_SECRET,
        }),
      ),
    ).toThrow('REDIS_URL is required in production');

    expect(() =>
      createRateLimitConfig(
        new ConfigService({
          NODE_ENV: 'production',
          REDIS_URL: 'redis://openbmb:password@127.0.0.1:6379/0',
        }),
      ),
    ).toThrow('RATE_LIMIT_KEY_SECRET is required in production');
  });

  it('rejects an unauthenticated production Redis URL', () => {
    expect(() =>
      createRateLimitConfig(
        new ConfigService({
          NODE_ENV: 'production',
          REDIS_URL: 'redis://127.0.0.1:6379/0',
          RATE_LIMIT_KEY_SECRET: KEY_SECRET,
        }),
      ),
    ).toThrow('REDIS_URL must include authentication in production');
  });

  it('keeps production keys inside the application Redis ACL namespace', () => {
    expect(() =>
      createRateLimitConfig(
        new ConfigService({
          NODE_ENV: 'production',
          REDIS_URL: 'redis://openbmb:password@127.0.0.1:6379/0',
          RATE_LIMIT_KEY_SECRET: KEY_SECRET,
          RATE_LIMIT_REDIS_PREFIX: 'outside:rate-limit',
        }),
      ),
    ).toThrow('production openbmb: ACL namespace');
  });

  it('always selects the deterministic memory adapter in tests', () => {
    const config = createRateLimitConfig(
      new ConfigService({
        NODE_ENV: 'test',
        REDIS_URL: 'redis://openbmb:password@127.0.0.1:6379/0',
      }),
    );

    expect(config.backend).toBe('memory');
    expect(config.keySecret).toHaveLength(32);
    expect(config.trustProxyHops).toBe(0);
  });
});
