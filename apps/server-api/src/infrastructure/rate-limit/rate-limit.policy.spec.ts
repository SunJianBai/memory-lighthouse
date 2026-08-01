import { RATE_LIMIT_POLICY_DEFINITIONS } from './rate-limit.policy';
import { RateLimitPolicy } from './rate-limit.types';

describe('remote policy update rate limit', () => {
  it('limits password reauthentication across account, session, device, and IP', () => {
    const definitions =
      RATE_LIMIT_POLICY_DEFINITIONS[RateLimitPolicy.REMOTE_POLICY_UPDATE];

    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimensions: ['ip'] }),
        expect.objectContaining({ dimensions: ['user-account'] }),
        expect.objectContaining({ dimensions: ['user-session'] }),
        expect.objectContaining({ dimensions: ['binding-id'] }),
        expect.objectContaining({
          limit: 3,
          dimensions: ['user-account', 'binding-id'],
        }),
      ]),
    );
  });
});

describe('device activation account rate limits', () => {
  it.each([
    RateLimitPolicy.DEVICE_ACTIVATION_CREATE,
    RateLimitPolicy.DEVICE_ACTIVATION_APPROVE,
  ])('includes authenticated account and session buckets for %s', (policy) => {
    expect(RATE_LIMIT_POLICY_DEFINITIONS[policy]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimensions: ['ip'] }),
        expect.objectContaining({ dimensions: ['user-account'] }),
        expect.objectContaining({ dimensions: ['user-session'] }),
      ]),
    );
  });
});
