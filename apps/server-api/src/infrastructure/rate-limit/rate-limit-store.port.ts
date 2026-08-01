import type {
  RateLimitBucket,
  RateLimitStoreDecision,
} from './rate-limit.types';

export interface RateLimitStore {
  consume(buckets: readonly RateLimitBucket[]): Promise<RateLimitStoreDecision>;
}
