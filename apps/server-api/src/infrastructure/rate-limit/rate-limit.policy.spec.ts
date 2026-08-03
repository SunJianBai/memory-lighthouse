import { RATE_LIMIT_POLICY_DEFINITIONS } from './rate-limit.policy';
import { RateLimitPolicy } from './rate-limit.types';

describe('email verification code rate limit', () => {
  it('limits guesses by email and IP/email pair instead of the submitted code', () => {
    const definitions =
      RATE_LIMIT_POLICY_DEFINITIONS[
        RateLimitPolicy.AUTH_EMAIL_VERIFICATION_CONFIRM
      ];

    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimensions: ['ip'] }),
        expect.objectContaining({ limit: 5, dimensions: ['email'] }),
        expect.objectContaining({
          limit: 5,
          dimensions: ['ip', 'email'],
        }),
      ]),
    );
    expect(definitions).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimensions: ['one-time-token'] }),
      ]),
    );
  });
});

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

describe('sensitive write password reauthentication rate limit', () => {
  it('limits attempts across IP, account, session, and their account/IP pair', () => {
    const definitions =
      RATE_LIMIT_POLICY_DEFINITIONS[
        RateLimitPolicy.SENSITIVE_WRITE_REAUTHENTICATION
      ];

    expect(definitions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimensions: ['ip'] }),
        expect.objectContaining({ dimensions: ['user-account'] }),
        expect.objectContaining({ dimensions: ['user-session'] }),
        expect.objectContaining({
          limit: 5,
          dimensions: ['ip', 'user-account'],
        }),
      ]),
    );
  });
});
