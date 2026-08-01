import type { Request, Response } from 'express';
import { describe, expect, it, jest } from '@jest/globals';

import type { IdentitySecurityConfig } from '../../identity/config/identity-security.config';
import { InvalidRefreshTokenException } from '../../identity/identity.errors';
import type { AdminSessionTokenResult } from '../../identity/identity.types';
import type { AdminAuthenticationApplicationService } from '../admin-authentication.application.service';
import { AdminAuthController } from './admin-auth.controller';

const config: IdentitySecurityConfig = {
  environment: 'test',
  accessTokenSecret: Buffer.from('a'.repeat(48)),
  adminAccessTokenSecret: Buffer.from('d'.repeat(48)),
  refreshTokenPepper: Buffer.from('b'.repeat(48)),
  oneTimeTokenPepper: Buffer.from('c'.repeat(48)),
  accessTokenTtlSeconds: 900,
  adminAccessTokenTtlSeconds: 600,
  refreshTokenTtlSeconds: 2_592_000,
  emailVerificationTtlSeconds: 86_400,
  passwordResetTtlSeconds: 1_800,
  accessTokenIssuer: 'issuer',
  accessTokenAudience: 'audience',
  adminAccessTokenIssuer: 'admin-issuer',
  adminAccessTokenAudience: 'admin-audience',
  refreshCookieName: 'user-refresh',
  refreshCookiePath: '/openBMB/api/v1/auth',
  adminRefreshCookieName: 'admin-refresh',
  adminRefreshCookiePath: '/openBMB/api/v1/admin/auth',
  secureCookies: false,
};

const session: AdminSessionTokenResult = {
  accessToken: 'admin-access-token',
  accessTokenExpiresAt: '2026-08-01T00:10:00.000Z',
  expiresInSeconds: 600,
  purpose: 'ADMIN_WEB',
  refreshToken: 'raw-admin-refresh-token',
  refreshTokenExpiresAt: '2026-08-20T00:00:00.000Z',
  sessionId: 'admin-session-1',
};

function requestWithCookie(cookie?: string): Request {
  return {
    ip: '127.0.0.1',
    get: jest.fn(() => 'test-admin-agent'),
    headers: cookie ? { cookie } : {},
  } as unknown as Request;
}

describe('AdminAuthController', () => {
  it('sets only the separately named and scoped admin refresh cookie', async () => {
    const authentication = {
      login: jest.fn(async () => session),
    } as unknown as AdminAuthenticationApplicationService;
    const cookie = jest.fn();
    const response = { cookie } as unknown as Response;
    const controller = new AdminAuthController(authentication, config);

    const body = await controller.login(
      { identifier: 'operator', password: 'correct-password' },
      requestWithCookie(),
      response,
    );

    expect(body).not.toHaveProperty('refreshToken');
    expect(body).toMatchObject({
      purpose: 'ADMIN_WEB',
      accessToken: 'admin-access-token',
    });
    expect(cookie).toHaveBeenCalledWith(
      'admin-refresh',
      'raw-admin-refresh-token',
      expect.objectContaining({
        httpOnly: true,
        path: '/openBMB/api/v1/admin/auth',
        sameSite: 'strict',
      }),
    );
  });

  it('reads the admin cookie and ignores an ordinary user refresh cookie', async () => {
    const refresh = jest.fn(async () => session);
    const authentication = {
      refresh,
    } as unknown as AdminAuthenticationApplicationService;
    const response = { cookie: jest.fn() } as unknown as Response;
    const controller = new AdminAuthController(authentication, config);

    await controller.refresh(
      requestWithCookie(
        'user-refresh=ordinary-user-token; admin-refresh=admin-token',
      ),
      response,
    );

    expect(refresh).toHaveBeenCalledWith(
      expect.objectContaining({ refreshToken: 'admin-token' }),
    );
  });

  it('does not accept the user refresh cookie when the admin cookie is absent', async () => {
    const authentication = {
      refresh: jest.fn(),
    } as unknown as AdminAuthenticationApplicationService;
    const controller = new AdminAuthController(authentication, config);

    await expect(
      controller.refresh(
        requestWithCookie('user-refresh=ordinary-user-token'),
        { cookie: jest.fn() } as unknown as Response,
      ),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenException);
  });
});
