import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';

import { RATE_LIMIT_POLICY_METADATA } from './rate-limit.constants';
import { RateLimitGuard } from './rate-limit.guard';
import type { RateLimitPolicy } from './rate-limit.types';

export function RateLimited(policy: RateLimitPolicy): MethodDecorator {
  return applyDecorators(
    SetMetadata(RATE_LIMIT_POLICY_METADATA, policy),
    UseGuards(RateLimitGuard),
  );
}
