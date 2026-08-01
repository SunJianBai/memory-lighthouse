import type { RateLimitStore } from '../rate-limit-store.port';
import type {
  RateLimitBucket,
  RateLimitStoreDecision,
} from '../rate-limit.types';

interface Counter {
  count: number;
  expiresAt: number;
}

export type RateLimitClock = () => number;

export class InMemoryRateLimitStoreAdapter implements RateLimitStore {
  private readonly counters = new Map<string, Counter>();
  private operations = 0;

  constructor(private readonly clock: RateLimitClock = Date.now) {}

  consume(
    buckets: readonly RateLimitBucket[],
  ): Promise<RateLimitStoreDecision> {
    if (buckets.length === 0) {
      return Promise.resolve({
        allowed: true,
        remaining: 0,
        retryAfterMs: 0,
      });
    }

    const now = this.clock();
    let allowed = true;
    let remaining = Number.MAX_SAFE_INTEGER;
    let retryAfterMs = 0;

    for (const bucket of buckets) {
      const previous = this.counters.get(bucket.key);
      const current =
        previous === undefined || previous.expiresAt <= now
          ? { count: 1, expiresAt: now + bucket.windowMs }
          : { count: previous.count + 1, expiresAt: previous.expiresAt };
      this.counters.set(bucket.key, current);

      remaining = Math.min(
        remaining,
        Math.max(0, bucket.limit - current.count),
      );
      if (current.count > bucket.limit) {
        allowed = false;
        retryAfterMs = Math.max(retryAfterMs, current.expiresAt - now);
      }
    }

    this.operations += 1;
    if (this.operations % 1_000 === 0) {
      this.removeExpired(now);
    }

    return Promise.resolve({ allowed, remaining, retryAfterMs });
  }

  private removeExpired(now: number): void {
    for (const [key, counter] of this.counters) {
      if (counter.expiresAt <= now) {
        this.counters.delete(key);
      }
    }
  }
}
