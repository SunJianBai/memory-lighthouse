import type { Request, Response } from 'express';
import { describe, expect, it, jest } from '@jest/globals';

import type { IdentitySecurityConfig } from '../config/identity-security.config';
import type { IdentityApplicationService } from '../identity.application.service';
import type { SessionTokenResult } from '../identity.types';
import { AuthController } from './auth.controller';
import { ClientTypeDto } from './identity.dto';

jest.mock('../identity.application.service', () => ({
  IdentityApplicationService: class IdentityApplicationService {},
}));

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
  refreshCookieName: 'refresh',
  refreshCookiePath: '/openBMB/api/v1/auth',
  adminRefreshCookieName: 'admin-refresh',
  adminRefreshCookiePath: '/openBMB/api/v1/admin/auth',
  secureCookies: false,
};

function session(clientType: 'WEB' | 'ANDROID'): SessionTokenResult {
  return {
    accessToken: 'access-token',
    accessTokenExpiresAt: '2026-08-01T00:15:00.000Z',
    expiresInSeconds: 900,
    refreshToken: 'raw-refresh-token-must-not-leak-on-web',
    refreshTokenExpiresAt: '2026-08-20T00:00:00.000Z',
    sessionId: 'session-1',
    clientType,
  };
}

describe('AuthController refresh transport', () => {
  const request = {
    ip: '127.0.0.1',
    get: jest.fn(() => 'test-agent'),
    headers: {},
  } as unknown as Request;

  it('puts the Web refresh token only in a scoped HttpOnly cookie', async () => {
    const identity = {
      registerUser: jest.fn(() => Promise.resolve(session('WEB'))),
    } as unknown as IdentityApplicationService;
    const cookie = jest.fn();
    const response = {
      cookie,
    } as unknown as Response;
    const controller = new AuthController(identity, config);

    const body = await controller.register(
      {
        email: 'family@example.com',
        password: 'a-long-password',
        clientType: ClientTypeDto.WEB,
      },
      request,
      response,
    );

    expect(body).not.toHaveProperty('refreshToken');
    expect(cookie).toHaveBeenCalledWith(
      'refresh',
      'raw-refresh-token-must-not-leak-on-web',
      expect.objectContaining({
        httpOnly: true,
        path: '/openBMB/api/v1/auth',
        sameSite: 'strict',
      }),
    );
  });

  it('returns the opaque refresh token to the Android client body', async () => {
    const identity = {
      registerUser: jest.fn(() => Promise.resolve(session('ANDROID'))),
    } as unknown as IdentityApplicationService;
    const cookie = jest.fn();
    const response = { cookie } as unknown as Response;
    const controller = new AuthController(identity, config);

    const body = await controller.register(
      {
        username: 'family-user',
        password: 'a-long-password',
        clientType: ClientTypeDto.ANDROID,
      },
      request,
      response,
    );

    expect(body.refreshToken).toBe('raw-refresh-token-must-not-leak-on-web');
    expect(cookie).not.toHaveBeenCalled();
  });

  it('revokes and clears a stale Web refresh cookie before device mode', async () => {
    const revokeWebSessionByRefreshToken = jest.fn(() => Promise.resolve());
    const identity = {
      revokeWebSessionByRefreshToken,
    } as unknown as IdentityApplicationService;
    const clearCookie = jest.fn();
    const response = { clearCookie } as unknown as Response;
    const requestWithCookie = {
      ...request,
      headers: { cookie: 'refresh=stale-web-refresh-token' },
    } as unknown as Request;
    const controller = new AuthController(identity, config);

    await expect(
      controller.lockDeviceMode(requestWithCookie, response),
    ).resolves.toEqual({ locked: true });
    expect(revokeWebSessionByRefreshToken).toHaveBeenCalledWith(
      'stale-web-refresh-token',
    );
    expect(clearCookie).toHaveBeenCalledWith(
      'refresh',
      expect.objectContaining({
        httpOnly: true,
        path: '/openBMB/api/v1/auth',
        sameSite: 'strict',
      }),
    );
  });
});
