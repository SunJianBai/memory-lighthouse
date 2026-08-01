import { describe, expect, it } from '@jest/globals';

import { InMemoryRateLimitStoreAdapter } from './in-memory-rate-limit-store.adapter';

describe('InMemoryRateLimitStoreAdapter', () => {
  it('enforces every dimension atomically and resets after its own window', async () => {
    let now = 1_000;
    const store = new InMemoryRateLimitStoreAdapter(() => now);
    const buckets = [
      { key: 'ip-hash', limit: 2, windowMs: 10_000 },
      { key: 'account-hash', limit: 3, windowMs: 20_000 },
    ];

    expect(await store.consume(buckets)).toEqual({
      allowed: true,
      remaining: 1,
      retryAfterMs: 0,
    });
    expect((await store.consume(buckets)).allowed).toBe(true);
    expect(await store.consume(buckets)).toEqual({
      allowed: false,
      remaining: 0,
      retryAfterMs: 10_000,
    });

    now += 10_001;
    const afterIpReset = await store.consume(buckets);
    expect(afterIpReset.allowed).toBe(false);
    expect(afterIpReset.retryAfterMs).toBe(9_999);

    now += 10_000;
    expect((await store.consume(buckets)).allowed).toBe(true);
  });

  it('is a no-op for an empty policy', async () => {
    const store = new InMemoryRateLimitStoreAdapter(() => 0);
    await expect(store.consume([])).resolves.toEqual({
      allowed: true,
      remaining: 0,
      retryAfterMs: 0,
    });
  });
});
