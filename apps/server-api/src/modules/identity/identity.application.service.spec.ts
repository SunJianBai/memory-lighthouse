import type { IdentitySecurityConfig } from './config/identity-security.config';
import { describe, expect, it, jest } from '@jest/globals';
import { AccessTokenService } from './crypto/access-token.service';
import { OpaqueTokenService } from './crypto/opaque-token.service';
import { IdentityApplicationService } from './identity.application.service';
import {
  InvalidCredentialsException,
  InvalidOneTimeTokenException,
  InvalidRefreshTokenException,
  RegistrationUnavailableException,
} from './identity.errors';
import type { Clock } from './ports/clock.port';
import type { NotificationPort } from './ports/notification.port';
import type { PasswordHasherPort } from './ports/password-hasher.port';

// Prisma 7's generated NodeNext client imports emitted `.js` specifiers. The
// service is replaced here because these tests exercise the application
// boundary with an in-memory transaction double, not the database Adapter.
jest.mock('../../infrastructure/database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const now = new Date('2026-08-01T00:00:00.000Z');
const config: IdentitySecurityConfig = {
  environment: 'test',
  accessTokenSecret: Buffer.from('a'.repeat(48)),
  refreshTokenPepper: Buffer.from('b'.repeat(48)),
  oneTimeTokenPepper: Buffer.from('c'.repeat(48)),
  accessTokenTtlSeconds: 900,
  refreshTokenTtlSeconds: 2_592_000,
  emailVerificationTtlSeconds: 86_400,
  passwordResetTtlSeconds: 1_800,
  accessTokenIssuer: 'issuer',
  accessTokenAudience: 'audience',
  refreshCookieName: 'refresh',
  refreshCookiePath: '/openBMB/api/v1/auth',
  secureCookies: false,
};

function makeHarness() {
  const prisma = {
    loginIdentity: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    user: { findUnique: jest.fn() },
    userSession: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    oneTimeToken: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    passwordCredential: { upsert: jest.fn() },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (work: (transaction: typeof prisma) => Promise<unknown>) =>
      work(prisma),
  );
  const passwordHasher: jest.Mocked<PasswordHasherPort> = {
    hash: jest.fn(() => Promise.resolve(Uint8Array.from([1, 2, 3]))),
    verify: jest.fn(),
  };
  const notification: jest.Mocked<NotificationPort> = {
    sendEmailVerification: jest.fn(),
    sendPasswordReset: jest.fn(),
  };
  const clock: Clock = { now: () => now };
  const opaqueTokens = new OpaqueTokenService(config);
  const accessTokens = new AccessTokenService(config, clock);
  const service = new IdentityApplicationService(
    prisma as never,
    passwordHasher,
    notification,
    clock,
    config,
    opaqueTokens,
    accessTokens,
  );

  return { service, prisma, passwordHasher, notification, opaqueTokens };
}

function activePreviousSession(overrides: Record<string, unknown> = {}) {
  return {
    id: '01JSESSION00000000000000000',
    userId: '01JUSER0000000000000000000',
    deviceId: null,
    tokenFamilyId: '01JFAMILY00000000000000000',
    clientType: 'ANDROID',
    issuedAt: now,
    expiresAt: new Date('2026-08-20T00:00:00.000Z'),
    lastUsedAt: null,
    rotatedAt: null,
    revokedAt: null,
    replacedBySessionId: null,
    ipHash: null,
    userAgent: 'Android',
    user: {
      status: 'ACTIVE',
      deletedAt: null,
    },
    ...overrides,
  };
}

describe('IdentityApplicationService security paths', () => {
  it('returns the same public error for a missing account and a wrong password', async () => {
    const missing = makeHarness();
    missing.prisma.loginIdentity.findUnique.mockResolvedValue(null);
    missing.passwordHasher.verify.mockResolvedValue(false);

    const missingError = await missing.service
      .authenticate({
        identifier: 'nobody@example.com',
        password: 'incorrect-password',
        clientType: 'WEB',
      })
      .catch((error: unknown) => error);
    expect(missing.passwordHasher.verify.mock.calls).toContainEqual([
      'incorrect-password',
      null,
    ]);

    const wrong = makeHarness();
    wrong.prisma.loginIdentity.findUnique.mockResolvedValue({
      userId: 'user-1',
      user: {
        passwordCredential: { passwordHash: Uint8Array.from([1]) },
        status: 'ACTIVE',
        deletedAt: null,
      },
    });
    wrong.passwordHasher.verify.mockResolvedValue(false);
    const wrongError = await wrong.service
      .authenticate({
        identifier: 'known@example.com',
        password: 'incorrect-password',
        clientType: 'WEB',
      })
      .catch((error: unknown) => error);

    expect(missingError).toBeInstanceOf(InvalidCredentialsException);
    expect(wrongError).toBeInstanceOf(InvalidCredentialsException);
    expect((missingError as InvalidCredentialsException).getResponse()).toEqual(
      (wrongError as InvalidCredentialsException).getResponse(),
    );
  });

  it('does not reveal which registration identity violated a unique constraint', async () => {
    const harness = makeHarness();
    harness.prisma.$transaction.mockRejectedValue({
      code: 'P2002',
      meta: { target: ['normalized_value'] },
    });

    const error = await harness.service
      .registerUser({
        email: 'private@example.com',
        username: 'PrivateName',
        password: 'a-long-password',
        clientType: 'WEB',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RegistrationUnavailableException);
    const response = JSON.stringify(
      (error as RegistrationUnavailableException).getResponse(),
    );
    expect(response).not.toContain('private@example.com');
    expect(response).not.toContain('PrivateName');
    expect(response).not.toContain('email');
    expect(response).not.toContain('username');
  });

  it('revokes the whole family when a rotated refresh token is replayed', async () => {
    const harness = makeHarness();
    harness.prisma.userSession.findUnique.mockResolvedValue(
      activePreviousSession({
        rotatedAt: new Date('2026-08-01T00:00:01.000Z'),
      }),
    );
    harness.prisma.userSession.updateMany.mockResolvedValue({ count: 2 });

    await expect(
      harness.service.refreshSession({
        refreshToken: 'old-opaque-refresh-token-that-was-rotated',
        clientType: 'ANDROID',
      }),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenException);
    expect(harness.prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: {
        tokenFamilyId: '01JFAMILY00000000000000000',
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
  });

  it('treats a concurrent refresh claim loss as replay and revokes the family', async () => {
    const harness = makeHarness();
    harness.prisma.userSession.findUnique.mockResolvedValue(
      activePreviousSession(),
    );
    harness.prisma.userSession.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 2 });

    await expect(
      harness.service.refreshSession({
        refreshToken: 'concurrently-used-refresh-token-value',
        clientType: 'ANDROID',
      }),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenException);
    expect(harness.prisma.userSession.updateMany).toHaveBeenCalledTimes(2);
    expect(harness.prisma.userSession.create).not.toHaveBeenCalled();
  });

  it('consumes a reset token, changes the password, and revokes every session atomically', async () => {
    const harness = makeHarness();
    harness.prisma.oneTimeToken.findUnique.mockResolvedValue({
      id: 'token-1',
      userId: 'user-1',
      identityId: 'email-1',
      purpose: 'PASSWORD_RESET',
      consumedAt: null,
      expiresAt: new Date('2026-08-01T00:10:00.000Z'),
    });
    harness.prisma.oneTimeToken.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 });
    harness.prisma.passwordCredential.upsert.mockResolvedValue({});
    harness.prisma.userSession.updateMany.mockResolvedValue({ count: 3 });

    await expect(
      harness.service.completePasswordReset(
        'valid-reset-token-with-sufficient-entropy',
        'replacement-password',
      ),
    ).resolves.toEqual({ completed: true });
    expect(harness.prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', revokedAt: null },
      data: { revokedAt: now },
    });
  });

  it('lets a username-only account attach an email without returning the raw verification token', async () => {
    const harness = makeHarness();
    harness.prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      status: 'ACTIVE',
      deletedAt: null,
    });
    harness.prisma.loginIdentity.findUnique.mockResolvedValue(null);
    harness.prisma.loginIdentity.create.mockResolvedValue({
      id: 'email-1',
      userId: 'user-1',
      value: 'NewAddress@Example.com',
      verifiedAt: null,
    });
    harness.prisma.oneTimeToken.updateMany.mockResolvedValue({ count: 0 });
    harness.prisma.oneTimeToken.create.mockResolvedValue({});
    harness.notification.sendEmailVerification.mockResolvedValue();

    const result = await harness.service.requestEmailVerification(
      'user-1',
      ' NewAddress@Example.com ',
    );

    expect(result).toEqual({ accepted: true });
    expect(result).not.toHaveProperty('token');
    expect(harness.prisma.loginIdentity.create.mock.calls[0]?.[0]).toEqual({
      data: expect.objectContaining({
        userId: 'user-1',
        type: 'EMAIL',
        value: 'NewAddress@Example.com',
        normalizedValue: 'newaddress@example.com',
        verifiedAt: null,
      }),
    });
    expect(harness.notification.sendEmailVerification.mock.calls).toHaveLength(
      1,
    );
  });

  it('rejects an already-consumed one-time token', async () => {
    const harness = makeHarness();
    harness.prisma.oneTimeToken.findUnique.mockResolvedValue({
      id: 'token-1',
      purpose: 'EMAIL_VERIFICATION',
      identityId: 'email-1',
      consumedAt: now,
      expiresAt: new Date('2026-08-01T00:10:00.000Z'),
    });
    harness.prisma.oneTimeToken.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      harness.service.confirmEmailVerification(
        'already-consumed-token-with-sufficient-entropy',
      ),
    ).rejects.toBeInstanceOf(InvalidOneTimeTokenException);
  });
});
