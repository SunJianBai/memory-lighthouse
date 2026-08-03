import { describe, expect, it } from '@jest/globals';

import type { IdentitySecurityConfig } from '../config/identity-security.config';
import { OpaqueTokenService } from './opaque-token.service';

const config: IdentitySecurityConfig = {
  environment: 'test',
  accessTokenSecret: Buffer.from('a'.repeat(48)),
  adminAccessTokenSecret: Buffer.from('d'.repeat(48)),
  refreshTokenPepper: Buffer.from('b'.repeat(48)),
  oneTimeTokenPepper: Buffer.from('c'.repeat(48)),
  accessTokenTtlSeconds: 900,
  adminAccessTokenTtlSeconds: 600,
  refreshTokenTtlSeconds: 2_592_000,
  emailVerificationTtlSeconds: 600,
  passwordResetTtlSeconds: 1_800,
  accessTokenIssuer: 'issuer',
  accessTokenAudience: 'audience',
  adminAccessTokenIssuer: 'admin-issuer',
  adminAccessTokenAudience: 'admin-audience',
  refreshCookieName: 'refresh',
  refreshCookiePath: '/openBMB/api/v1/auth',
  adminRefreshCookieName: 'admin-refresh',
  adminRefreshCookiePath: '/openBMB/api/v1/admin/auth',
  secureCookies: false,
};

describe('OpaqueTokenService email verification codes', () => {
  const service = new OpaqueTokenService(config);

  it('generates exactly six decimal digits including leading zeroes', () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      expect(service.generateEmailVerificationCode()).toMatch(/^\d{6}$/);
    }
  });

  it('binds the same code to its identity and one-time challenge', () => {
    const first = service.hashEmailVerificationCode(
      'email-1',
      'challenge-1',
      '042731',
    );

    expect(
      service.matchesEmailVerificationCode(
        'email-1',
        'challenge-1',
        '042731',
        first,
      ),
    ).toBe(true);
    expect(
      service.hashEmailVerificationCode('email-2', 'challenge-1', '042731'),
    ).not.toEqual(first);
    expect(
      service.hashEmailVerificationCode('email-1', 'challenge-2', '042731'),
    ).not.toEqual(first);
    expect(
      service.matchesEmailVerificationCode(
        'email-1',
        'challenge-1',
        '042732',
        first,
      ),
    ).toBe(false);
  });
});
