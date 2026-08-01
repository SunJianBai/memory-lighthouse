import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { RATE_LIMIT_STORE } from './rate-limit.constants';
import { RateLimitUnavailableException } from './rate-limit.errors';
import { RateLimitKeyFactory } from './rate-limit-key.factory';
import { RATE_LIMIT_POLICY_DEFINITIONS } from './rate-limit.policy';
import { RateLimitRequestSubjectFactory } from './rate-limit-request-subject.factory';
import type { RateLimitStore } from './rate-limit-store.port';
import type {
  RateLimitBucket,
  RateLimitDecision,
  RateLimitPolicy,
} from './rate-limit.types';

@Injectable()
export class RateLimitApplicationService {
  constructor(
    @Inject(RATE_LIMIT_STORE) private readonly store: RateLimitStore,
    private readonly keys: RateLimitKeyFactory,
    private readonly subjects: RateLimitRequestSubjectFactory,
  ) {}

  async consume(
    policy: RateLimitPolicy,
    request: Request,
  ): Promise<RateLimitDecision> {
    const buckets: RateLimitBucket[] = [];
    for (const definition of RATE_LIMIT_POLICY_DEFINITIONS[policy]) {
      const dimensions = this.subjects.resolve(request, definition.dimensions);
      if (!dimensions) {
        continue;
      }
      buckets.push({
        key: this.keys.create(policy, definition.id, dimensions),
        limit: definition.limit,
        windowMs: definition.windowMs,
      });
    }

    let result;
    try {
      result = await this.store.consume(buckets);
    } catch {
      // Sensitive endpoints fail closed if the distributed store is unavailable.
      throw new RateLimitUnavailableException();
    }

    return {
      allowed: result.allowed,
      remaining: result.remaining,
      retryAfterSeconds: result.allowed
        ? 0
        : Math.max(1, Math.ceil(result.retryAfterMs / 1_000)),
    };
  }
}
