import { GUARDS_METADATA } from '@nestjs/common/constants';

import { RATE_LIMIT_POLICY_METADATA } from '../../../infrastructure/rate-limit/rate-limit.constants';
import { RateLimitGuard } from '../../../infrastructure/rate-limit/rate-limit.guard';
import { RateLimitPolicy } from '../../../infrastructure/rate-limit/rate-limit.types';
import { AuthController } from './auth.controller';
import { UserAccessGuard } from './user-access.guard';

describe('email verification request rate limit contract', () => {
  const handler = Object.getOwnPropertyDescriptor(
    AuthController.prototype,
    'requestEmailVerification',
  )?.value as object;

  it('authenticates the request before consuming account and session buckets', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toEqual([
      UserAccessGuard,
      RateLimitGuard,
    ]);
    expect(Reflect.getMetadata(RATE_LIMIT_POLICY_METADATA, handler)).toBe(
      RateLimitPolicy.AUTH_EMAIL_VERIFICATION_REQUEST,
    );
  });
});
