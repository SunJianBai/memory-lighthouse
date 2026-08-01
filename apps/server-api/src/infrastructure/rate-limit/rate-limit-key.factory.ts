import { createHmac } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { RATE_LIMIT_CONFIG } from './rate-limit.constants';
import type {
  RateLimitConfig,
  RateLimitDimension,
  RateLimitPolicy,
} from './rate-limit.types';

@Injectable()
export class RateLimitKeyFactory {
  constructor(
    @Inject(RATE_LIMIT_CONFIG) private readonly config: RateLimitConfig,
  ) {}

  create(
    policy: RateLimitPolicy,
    bucketId: string,
    dimensions: readonly RateLimitDimension[],
  ): string {
    const hmac = createHmac('sha256', this.config.keySecret);
    this.addPart(hmac, 'rate-limit-key/v1');
    this.addPart(hmac, policy);
    this.addPart(hmac, bucketId);
    for (const dimension of dimensions) {
      this.addPart(hmac, dimension.kind);
      this.addPart(hmac, dimension.value);
    }
    return `${this.config.redisPrefix}:${policy}:${bucketId}:${hmac.digest('base64url')}`;
  }

  private addPart(hmac: ReturnType<typeof createHmac>, value: string): void {
    const encoded = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(encoded.length);
    hmac.update(length);
    hmac.update(encoded);
  }
}
