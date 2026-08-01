import type { OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createClient } from 'redis';

import type { RateLimitStore } from '../rate-limit-store.port';
import type {
  RateLimitBucket,
  RateLimitStoreDecision,
} from '../rate-limit.types';

const CONSUME_SCRIPT = `
local allowed = 1
local max_retry = 0
local min_remaining = 2147483647

for index, key in ipairs(KEYS) do
  local offset = (index - 1) * 2
  local limit = tonumber(ARGV[offset + 1])
  local window_ms = tonumber(ARGV[offset + 2])
  local count = redis.call('INCR', key)

  if count == 1 then
    redis.call('PEXPIRE', key, window_ms)
  end

  local ttl = redis.call('PTTL', key)
  if ttl < 0 then
    redis.call('PEXPIRE', key, window_ms)
    ttl = window_ms
  end

  local bucket_remaining = limit - count
  if bucket_remaining < 0 then
    bucket_remaining = 0
  end
  if bucket_remaining < min_remaining then
    min_remaining = bucket_remaining
  end

  if count > limit then
    allowed = 0
    if ttl > max_retry then
      max_retry = ttl
    end
  end
end

return {allowed, max_retry, min_remaining}
`;

type RedisClient = ReturnType<typeof createClient>;

export class RedisRateLimitStoreAdapter
  implements RateLimitStore, OnModuleInit, OnModuleDestroy
{
  private readonly client: RedisClient;

  constructor(url: string, connectTimeoutMs: number) {
    this.client = createClient({
      url,
      socket: {
        connectTimeout: connectTimeoutMs,
        reconnectStrategy: false,
      },
    });
    this.client.on('error', () => {
      // Operational errors are intentionally not logged with connection data.
      // The caller fails closed if a consume operation cannot reach Redis.
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.client.connect();
    } catch {
      throw new Error('Rate limit Redis connection failed');
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.isOpen) {
      await this.client.close();
    }
  }

  async consume(
    buckets: readonly RateLimitBucket[],
  ): Promise<RateLimitStoreDecision> {
    if (buckets.length === 0) {
      return { allowed: true, remaining: 0, retryAfterMs: 0 };
    }

    const result = await this.client.eval(CONSUME_SCRIPT, {
      keys: buckets.map((bucket) => bucket.key),
      arguments: buckets.flatMap((bucket) => [
        bucket.limit.toString(10),
        bucket.windowMs.toString(10),
      ]),
    });
    if (
      !Array.isArray(result) ||
      result.length !== 3 ||
      !result.every((value) => typeof value === 'number')
    ) {
      throw new Error('Rate limit Redis returned an invalid response');
    }

    const [allowed, retryAfterMs, remaining] = result;
    return {
      allowed: allowed === 1,
      retryAfterMs,
      remaining,
    };
  }
}
