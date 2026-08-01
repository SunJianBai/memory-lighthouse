import { describe, expect, it } from '@jest/globals';
import type { Request } from 'express';

import { RateLimitUnavailableException } from './rate-limit.errors';
import { RateLimitApplicationService } from './rate-limit.application.service';
import { RateLimitKeyFactory } from './rate-limit-key.factory';
import { RateLimitRequestSubjectFactory } from './rate-limit-request-subject.factory';
import type { RateLimitStore } from './rate-limit-store.port';
import type {
  RateLimitBucket,
  RateLimitConfig,
  RateLimitStoreDecision,
} from './rate-limit.types';
import { RateLimitPolicy } from './rate-limit.types';

const config: RateLimitConfig = {
  environment: 'test',
  backend: 'memory',
  keySecret: Buffer.alloc(32, 9),
  redisPrefix: 'test:rl',
  redisConnectTimeoutMs: 1_000,
  trustProxyHops: 1,
};

class CapturingStore implements RateLimitStore {
  calls: RateLimitBucket[][] = [];

  constructor(
    private readonly result: RateLimitStoreDecision = {
      allowed: true,
      remaining: 4,
      retryAfterMs: 0,
    },
  ) {}

  consume(
    buckets: readonly RateLimitBucket[],
  ): Promise<RateLimitStoreDecision> {
    this.calls.push([...buckets]);
    return Promise.resolve(this.result);
  }
}

function loginRequest(identifier: string): Request {
  return {
    body: { identifier },
    params: {},
    headers: { 'x-forwarded-for': '198.51.100.23' },
    socket: { remoteAddress: '127.0.0.1' },
  } as unknown as Request;
}

function createService(store: RateLimitStore): RateLimitApplicationService {
  return new RateLimitApplicationService(
    store,
    new RateLimitKeyFactory(config),
    new RateLimitRequestSubjectFactory(config),
  );
}

describe('RateLimitApplicationService', () => {
  it('normalizes subjects and never exposes raw accounts or IPs in store keys', async () => {
    const store = new CapturingStore();
    const service = createService(store);

    await service.consume(
      RateLimitPolicy.AUTH_LOGIN,
      loginRequest(' Family@Example.COM '),
    );
    await service.consume(
      RateLimitPolicy.AUTH_LOGIN,
      loginRequest('family@example.com'),
    );

    expect(store.calls).toHaveLength(2);
    expect(store.calls[0]).toHaveLength(4);
    expect(store.calls[0]?.map((bucket) => bucket.key)).toEqual(
      store.calls[1]?.map((bucket) => bucket.key),
    );
    for (const bucket of store.calls.flat()) {
      expect(bucket.key).not.toContain('family@example.com');
      expect(bucket.key).not.toContain('198.51.100.23');
      expect(bucket.key).toMatch(/:[A-Za-z0-9_-]{43}$/);
    }
  });

  it('returns a rounded retry interval from the strictest exceeded bucket', async () => {
    const service = createService(
      new CapturingStore({
        allowed: false,
        remaining: 0,
        retryAfterMs: 1_001,
      }),
    );

    await expect(
      service.consume(
        RateLimitPolicy.AUTH_PASSWORD_RESET_REQUEST,
        loginRequest('family@example.com'),
      ),
    ).resolves.toEqual({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 2,
    });
  });

  it('fails closed without leaking adapter errors', async () => {
    const store: RateLimitStore = {
      consume: () => Promise.reject(new Error('redis://user:secret@host')),
    };

    await expect(
      createService(store).consume(
        RateLimitPolicy.AUTH_LOGIN,
        loginRequest('family@example.com'),
      ),
    ).rejects.toBeInstanceOf(RateLimitUnavailableException);
  });
});
