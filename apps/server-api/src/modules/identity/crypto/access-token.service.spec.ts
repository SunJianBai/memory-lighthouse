import type { IdentitySecurityConfig } from '../config/identity-security.config';
import { describe, expect, it } from '@jest/globals';
import type { Clock } from '../ports/clock.port';
import { AccessTokenService } from './access-token.service';

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

describe('AccessTokenService', () => {
  const now = new Date('2026-08-01T00:00:00.000Z');
  const clock: Clock = { now: () => now };

  it('issues a 15 minute, session-bound, environment-bound token', () => {
    const service = new AccessTokenService(config, clock);
    const issued = service.issueUser('user-1', 'session-1');

    expect(issued.expiresAt.toISOString()).toBe('2026-08-01T00:15:00.000Z');
    expect(service.verifyUser(issued.token)).toMatchObject({
      userId: 'user-1',
      sessionId: 'session-1',
      tokenId: issued.tokenId,
    });

    const otherEnvironment = new AccessTokenService(
      { ...config, environment: 'production' },
      clock,
    );
    expect(otherEnvironment.verifyUser(issued.token)).toBeNull();
  });

  it('rejects tampering and expiration', () => {
    const service = new AccessTokenService(config, clock);
    const issued = service.issueUser('user-1', 'session-1');
    const [header, claims, signature] = issued.token.split('.');
    const flippedSignaturePrefix = signature.startsWith('A') ? 'B' : 'A';
    expect(
      service.verifyUser(
        `${header}.${claims}.${flippedSignaturePrefix}${signature.slice(1)}`,
      ),
    ).toBeNull();

    const expiredClock: Clock = {
      now: () => new Date('2026-08-01T00:15:00.000Z'),
    };
    expect(
      new AccessTokenService(config, expiredClock).verifyUser(issued.token),
    ).toBeNull();
  });

  it('keeps user and admin token audiences cryptographically disjoint', () => {
    const service = new AccessTokenService(config, clock);
    const userToken = service.issueUser('operator-1', 'user-session-1');
    const adminToken = service.issueAdmin('operator-1', 'admin-session-1');

    expect(service.verifyUser(userToken.token)).not.toBeNull();
    expect(service.verifyAdmin(adminToken.token)).not.toBeNull();
    expect(service.verifyAdmin(userToken.token)).toBeNull();
    expect(service.verifyUser(adminToken.token)).toBeNull();
    expect(adminToken.expiresAt.toISOString()).toBe('2026-08-01T00:10:00.000Z');
  });

  it('rejects a non-canonical base64url alias of the same signature bytes', () => {
    const service = new AccessTokenService(config, clock);
    const issued = service.issueUser('user-1', 'session-1');
    const [header, claims, signature] = issued.token.split('.');
    const alphabet =
      'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const lastIndex = alphabet.indexOf(signature.at(-1) ?? '');

    // A 32-byte HS256 signature leaves two zero padding bits. Changing only
    // those bits produces different text that permissive decoders map to the
    // same bytes; JWT compact serialization still requires canonical text.
    expect(lastIndex % 4).toBe(0);
    const aliasedSignature = `${signature.slice(0, -1)}${alphabet[lastIndex + 1]}`;

    expect(
      service.verifyUser(`${header}.${claims}.${aliasedSignature}`),
    ).toBeNull();
  });
});
