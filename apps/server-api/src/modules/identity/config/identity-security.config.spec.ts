import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { createIdentitySecurityConfig } from './identity-security.config';

describe('createIdentitySecurityConfig', () => {
  it('uses separate user and admin token audiences and cookie scopes', () => {
    const config = createIdentitySecurityConfig(
      new ConfigService({ NODE_ENV: 'test' }),
    );

    expect(config.adminAccessTokenAudience).not.toBe(
      config.accessTokenAudience,
    );
    expect(config.adminAccessTokenIssuer).not.toBe(config.accessTokenIssuer);
    expect(config.adminAccessTokenSecret).not.toEqual(config.accessTokenSecret);
    expect(config.adminRefreshCookieName).not.toBe(config.refreshCookieName);
    expect(config.adminRefreshCookiePath).toBe('/openBMB/api/v1/admin/auth');
    expect(config.refreshCookiePath).toBe('/openBMB/api/v1/auth');
  });

  it('requires an independent admin signing secret in production', () => {
    const values = {
      NODE_ENV: 'production',
      AUTH_ACCESS_TOKEN_SECRET: 'a'.repeat(48),
      AUTH_REFRESH_TOKEN_PEPPER: 'b'.repeat(48),
      AUTH_ONE_TIME_TOKEN_PEPPER: 'c'.repeat(48),
    };

    expect(() =>
      createIdentitySecurityConfig(new ConfigService(values)),
    ).toThrow('AUTH_ADMIN_ACCESS_TOKEN_SECRET');
  });

  it('rejects reuse of the user signing secret for admin tokens', () => {
    expect(() =>
      createIdentitySecurityConfig(
        new ConfigService({
          NODE_ENV: 'test',
          AUTH_ACCESS_TOKEN_SECRET: 'same-secret-value'.repeat(3),
          AUTH_ADMIN_ACCESS_TOKEN_SECRET: 'same-secret-value'.repeat(3),
        }),
      ),
    ).toThrow(
      'AUTH_ADMIN_ACCESS_TOKEN_SECRET must differ from AUTH_ACCESS_TOKEN_SECRET',
    );
  });
});
