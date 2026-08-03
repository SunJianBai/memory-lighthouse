import type { IdentitySecurityConfig } from './config/identity-security.config';
import { describe, expect, it, jest } from '@jest/globals';
import { AccessTokenService } from './crypto/access-token.service';
import { OpaqueTokenService } from './crypto/opaque-token.service';
import { IdentityApplicationService } from './identity.application.service';
import {
  InvalidAccessTokenException,
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

function makeHarness() {
  const prisma = {
    loginIdentity: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    user: { findUnique: jest.fn(), updateMany: jest.fn() },
    userSession: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    oneTimeToken: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
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

  return {
    service,
    prisma,
    passwordHasher,
    notification,
    opaqueTokens,
    accessTokens,
  };
}

function activePreviousSession(overrides: Record<string, unknown> = {}) {
  return {
    id: '01JSESSION00000000000000000',
    userId: '01JUSER0000000000000000000',
    deviceId: null,
    tokenFamilyId: '01JFAMILY00000000000000000',
    clientType: 'ANDROID',
    purpose: 'USER',
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
  it('does not resolve user and admin access tokens across audiences', async () => {
    const harness = makeHarness();
    const userToken = harness.accessTokens.issueUser(
      'operator-1',
      'user-session-1',
    );
    const adminToken = harness.accessTokens.issueAdmin(
      'operator-1',
      'admin-session-1',
    );

    await expect(
      harness.service.resolveAdminPrincipal(userToken.token),
    ).rejects.toBeInstanceOf(InvalidAccessTokenException);
    await expect(
      harness.service.resolvePrincipal(adminToken.token),
    ).rejects.toBeInstanceOf(InvalidAccessTokenException);
    expect(harness.prisma.userSession.findUnique).not.toHaveBeenCalled();
  });

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

  it('re-authenticates a sensitive action by user id without a missing-user timing shortcut', async () => {
    const valid = makeHarness();
    valid.prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      status: 'ACTIVE',
      deletedAt: null,
      passwordCredential: { passwordHash: Uint8Array.from([7]) },
    });
    valid.passwordHasher.verify.mockResolvedValue(true);

    await expect(
      valid.service.reauthenticateUser('user-1', 'current-password'),
    ).resolves.toBeUndefined();
    expect(valid.passwordHasher.verify.mock.calls).toContainEqual([
      'current-password',
      Uint8Array.from([7]),
    ]);

    const missing = makeHarness();
    missing.prisma.user.findUnique.mockResolvedValue(null);
    missing.passwordHasher.verify.mockResolvedValue(false);
    await expect(
      missing.service.reauthenticateUser('missing', 'current-password'),
    ).rejects.toBeInstanceOf(InvalidCredentialsException);
    expect(missing.passwordHasher.verify.mock.calls).toContainEqual([
      'current-password',
      null,
    ]);
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

  it('checks platform authorization before and after issuing an admin session', async () => {
    const harness = makeHarness();
    harness.prisma.loginIdentity.findUnique.mockResolvedValue({
      userId: 'operator-1',
      user: {
        passwordCredential: { passwordHash: Uint8Array.from([1]) },
        status: 'ACTIVE',
        deletedAt: null,
      },
    });
    harness.passwordHasher.verify.mockResolvedValue(true);
    harness.prisma.userSession.create.mockResolvedValue({
      id: 'admin-session-1',
      userId: 'operator-1',
      clientType: 'ADMIN_WEB',
      purpose: 'ADMIN_WEB',
      tokenFamilyId: 'admin-family-1',
      expiresAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    const authorize = jest.fn(async () => undefined);

    const result = await harness.service.authenticateAdmin(
      {
        identifier: 'operator@example.com',
        password: 'correct-password',
      },
      authorize,
    );

    expect(authorize).toHaveBeenCalledTimes(2);
    expect(authorize).toHaveBeenNthCalledWith(1, 'operator-1');
    expect(authorize).toHaveBeenNthCalledWith(2, 'operator-1');
    expect(harness.prisma.userSession.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userId: 'operator-1',
        clientType: 'ADMIN_WEB',
        purpose: 'ADMIN_WEB',
      }),
    });
    expect(result).toMatchObject({
      purpose: 'ADMIN_WEB',
      sessionId: 'admin-session-1',
      accessToken: expect.any(String),
      refreshToken: expect.any(String),
    });
  });

  it('revokes a newly issued admin session when the role disappears in the post-check', async () => {
    const harness = makeHarness();
    harness.prisma.loginIdentity.findUnique.mockResolvedValue({
      userId: 'operator-1',
      user: {
        passwordCredential: { passwordHash: Uint8Array.from([1]) },
        status: 'ACTIVE',
        deletedAt: null,
      },
    });
    harness.passwordHasher.verify.mockResolvedValue(true);
    harness.prisma.userSession.create.mockResolvedValue({
      id: 'admin-session-1',
      userId: 'operator-1',
      clientType: 'ADMIN_WEB',
      purpose: 'ADMIN_WEB',
      tokenFamilyId: 'admin-family-1',
      expiresAt: new Date('2026-08-20T00:00:00.000Z'),
    });
    harness.prisma.userSession.updateMany.mockResolvedValue({ count: 1 });
    const authorizationLost = new Error('platform role revoked');
    const authorize = jest
      .fn<(userId: string) => Promise<void>>()
      .mockResolvedValueOnce()
      .mockRejectedValueOnce(authorizationLost);

    await expect(
      harness.service.authenticateAdmin(
        {
          identifier: 'operator@example.com',
          password: 'correct-password',
        },
        authorize,
      ),
    ).rejects.toBe(authorizationLost);
    expect(harness.prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'admin-session-1',
        userId: 'operator-1',
        purpose: 'ADMIN_WEB',
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
  });

  it('rejects a user refresh token at the admin boundary without revoking the user family', async () => {
    const harness = makeHarness();
    harness.prisma.userSession.findUnique.mockResolvedValue(
      activePreviousSession({ clientType: 'WEB' }),
    );
    const authorize = jest.fn(async () => undefined);

    await expect(
      harness.service.refreshAdminSession(
        { refreshToken: 'ordinary-user-refresh-token' },
        authorize,
      ),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenException);
    expect(authorize).not.toHaveBeenCalled();
    expect(harness.prisma.userSession.updateMany).not.toHaveBeenCalled();
    expect(harness.prisma.userSession.create).not.toHaveBeenCalled();
  });

  it('rejects an admin refresh token at the user boundary without revoking the admin family', async () => {
    const harness = makeHarness();
    harness.prisma.userSession.findUnique.mockResolvedValue(
      activePreviousSession({
        clientType: 'ADMIN_WEB',
        purpose: 'ADMIN_WEB',
      }),
    );

    await expect(
      harness.service.refreshSession({
        refreshToken: 'admin-refresh-token',
        clientType: 'WEB',
      }),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenException);
    expect(harness.prisma.userSession.updateMany).not.toHaveBeenCalled();
    expect(harness.prisma.userSession.create).not.toHaveBeenCalled();
  });

  it('revokes an admin refresh family when its platform role is no longer current', async () => {
    const harness = makeHarness();
    harness.prisma.userSession.findUnique.mockResolvedValue(
      activePreviousSession({
        clientType: 'ADMIN_WEB',
        purpose: 'ADMIN_WEB',
      }),
    );
    harness.prisma.userSession.updateMany.mockResolvedValue({ count: 1 });
    const authorize = jest.fn(async () => {
      throw new Error('platform role revoked');
    });

    await expect(
      harness.service.refreshAdminSession(
        { refreshToken: 'admin-refresh-token' },
        authorize,
      ),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenException);
    expect(harness.prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: {
        tokenFamilyId: '01JFAMILY00000000000000000',
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
    expect(harness.prisma.userSession.create).not.toHaveBeenCalled();
  });

  it('preserves replay-family revocation for rotated admin refresh tokens', async () => {
    const harness = makeHarness();
    harness.prisma.userSession.findUnique.mockResolvedValue(
      activePreviousSession({
        clientType: 'ADMIN_WEB',
        purpose: 'ADMIN_WEB',
        rotatedAt: new Date('2026-08-01T00:00:01.000Z'),
      }),
    );
    harness.prisma.userSession.updateMany.mockResolvedValue({ count: 2 });
    const authorize = jest.fn(async () => undefined);

    await expect(
      harness.service.refreshAdminSession(
        { refreshToken: 'replayed-admin-refresh-token' },
        authorize,
      ),
    ).rejects.toBeInstanceOf(InvalidRefreshTokenException);
    expect(harness.prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: {
        tokenFamilyId: '01JFAMILY00000000000000000',
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
    expect(authorize).not.toHaveBeenCalled();
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

  it('revokes the Web refresh family before entering device mode', async () => {
    const harness = makeHarness();
    harness.prisma.userSession.findUnique.mockResolvedValue(
      activePreviousSession({ clientType: 'WEB' }),
    );
    harness.prisma.userSession.updateMany.mockResolvedValue({ count: 1 });

    await harness.service.revokeWebSessionByRefreshToken(
      'web-refresh-token-for-device-lock',
    );

    expect(harness.prisma.userSession.updateMany).toHaveBeenCalledWith({
      where: {
        tokenFamilyId: '01JFAMILY00000000000000000',
        revokedAt: null,
      },
      data: { revokedAt: now },
    });
  });

  it('does not let the Web device lock revoke an Android refresh family', async () => {
    const harness = makeHarness();
    harness.prisma.userSession.findUnique.mockResolvedValue(
      activePreviousSession({ clientType: 'ANDROID' }),
    );

    await harness.service.revokeWebSessionByRefreshToken(
      'android-refresh-token-at-web-boundary',
    );

    expect(harness.prisma.userSession.updateMany).not.toHaveBeenCalled();
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
    expect(
      harness.notification.sendEmailVerification.mock.calls[0]?.[0],
    ).toEqual(
      expect.objectContaining({
        email: 'NewAddress@Example.com',
        code: expect.stringMatching(/^\d{6}$/),
      }),
    );
    const persisted = harness.prisma.oneTimeToken.create.mock.calls[0]?.[0] as {
      data: { tokenHash: Uint8Array };
    };
    const deliveredCode =
      harness.notification.sendEmailVerification.mock.calls[0]?.[0].code;
    expect(
      Buffer.from(persisted.data.tokenHash).toString('utf8'),
    ).not.toContain(deliveredCode);
  });

  it('confirms the latest email code once and activates its pending account', async () => {
    const harness = makeHarness();
    harness.prisma.loginIdentity.findUnique.mockResolvedValue({
      id: 'email-1',
      userId: 'user-1',
    });
    harness.prisma.oneTimeToken.findFirst.mockResolvedValue({
      id: 'challenge-1',
      userId: 'user-1',
      purpose: 'EMAIL_VERIFICATION',
      identityId: 'email-1',
      tokenHash: harness.opaqueTokens.hashEmailVerificationCode(
        'email-1',
        'challenge-1',
        '042731',
      ),
      attemptCount: 0,
      consumedAt: null,
      expiresAt: new Date('2026-08-01T00:10:00.000Z'),
    });
    harness.prisma.oneTimeToken.updateMany.mockResolvedValue({ count: 1 });
    harness.prisma.loginIdentity.updateMany.mockResolvedValue({ count: 1 });
    harness.prisma.user.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      harness.service.confirmEmailVerification(
        ' Family@Example.com ',
        '042731',
      ),
    ).resolves.toEqual({ verified: true });
    expect(harness.prisma.oneTimeToken.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: 'challenge-1',
        consumedAt: null,
        attemptCount: { lt: 5 },
      }),
      data: { consumedAt: now },
    });
    expect(harness.prisma.loginIdentity.updateMany).toHaveBeenCalledWith({
      where: { id: 'email-1', userId: 'user-1', type: 'EMAIL' },
      data: { verifiedAt: now },
    });
  });

  it('locks the email challenge after its fifth wrong code', async () => {
    const harness = makeHarness();
    harness.prisma.loginIdentity.findUnique.mockResolvedValue({
      id: 'email-1',
      userId: 'user-1',
    });
    harness.prisma.oneTimeToken.findFirst.mockResolvedValue({
      id: 'challenge-1',
      userId: 'user-1',
      purpose: 'EMAIL_VERIFICATION',
      identityId: 'email-1',
      tokenHash: harness.opaqueTokens.hashEmailVerificationCode(
        'email-1',
        'challenge-1',
        '042731',
      ),
      attemptCount: 4,
      consumedAt: null,
      expiresAt: new Date('2026-08-01T00:10:00.000Z'),
    });
    harness.prisma.oneTimeToken.updateMany.mockResolvedValue({ count: 1 });

    await expect(
      harness.service.confirmEmailVerification('family@example.com', '999999'),
    ).rejects.toBeInstanceOf(InvalidOneTimeTokenException);
    expect(harness.prisma.oneTimeToken.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'challenge-1',
        consumedAt: null,
        attemptCount: 4,
        expiresAt: { gt: now },
      },
      data: { attemptCount: { increment: 1 }, consumedAt: now },
    });
    expect(harness.prisma.loginIdentity.updateMany).not.toHaveBeenCalled();
  });

  it('does not accept an email verification code after it was consumed', async () => {
    const harness = makeHarness();
    harness.prisma.loginIdentity.findUnique.mockResolvedValue({
      id: 'email-1',
      userId: 'user-1',
    });
    harness.prisma.oneTimeToken.findFirst.mockResolvedValue({
      id: 'challenge-1',
      userId: 'user-1',
      purpose: 'EMAIL_VERIFICATION',
      identityId: 'email-1',
      tokenHash: harness.opaqueTokens.hashEmailVerificationCode(
        'email-1',
        'challenge-1',
        '042731',
      ),
      attemptCount: 0,
      consumedAt: now,
      expiresAt: new Date('2026-08-01T00:10:00.000Z'),
    });

    await expect(
      harness.service.confirmEmailVerification('family@example.com', '042731'),
    ).rejects.toBeInstanceOf(InvalidOneTimeTokenException);
    expect(harness.prisma.loginIdentity.updateMany).not.toHaveBeenCalled();
  });

  it('rejects an email verification code at its exact expiry time', async () => {
    const harness = makeHarness();
    harness.prisma.loginIdentity.findUnique.mockResolvedValue({
      id: 'email-1',
      userId: 'user-1',
    });
    harness.prisma.oneTimeToken.findFirst.mockResolvedValue({
      id: 'challenge-1',
      userId: 'user-1',
      purpose: 'EMAIL_VERIFICATION',
      identityId: 'email-1',
      tokenHash: harness.opaqueTokens.hashEmailVerificationCode(
        'email-1',
        'challenge-1',
        '042731',
      ),
      attemptCount: 0,
      consumedAt: null,
      expiresAt: now,
    });

    await expect(
      harness.service.confirmEmailVerification('family@example.com', '042731'),
    ).rejects.toBeInstanceOf(InvalidOneTimeTokenException);
    expect(harness.prisma.loginIdentity.updateMany).not.toHaveBeenCalled();
  });
});
