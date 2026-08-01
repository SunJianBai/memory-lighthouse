import {
  Logger,
  BadRequestException,
  Inject,
  Injectable,
} from '@nestjs/common';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import type { Prisma } from '../../infrastructure/database/generated/prisma/client';
import type { IdentitySecurityConfig } from './config/identity-security.config';
import { AccessTokenService } from './crypto/access-token.service';
import { OpaqueTokenService } from './crypto/opaque-token.service';
import {
  ACTIVE_USER_STATUSES,
  ADMIN_SESSION_PURPOSE,
  EMAIL_IDENTITY,
  EMAIL_VERIFICATION_PURPOSE,
  IDENTITY_CLOCK,
  IDENTITY_SECURITY_CONFIG,
  NOTIFICATION_PORT,
  PASSWORD_HASHER_PORT,
  PASSWORD_RESET_PURPOSE,
  USERNAME_IDENTITY,
  USER_SESSION_PURPOSE,
} from './identity.constants';
import {
  InvalidAccessTokenException,
  InvalidCredentialsException,
  InvalidOneTimeTokenException,
  InvalidRefreshTokenException,
  RegistrationUnavailableException,
} from './identity.errors';
import {
  normalizeEmail,
  normalizeLoginIdentifier,
  normalizeUsername,
  type NormalizedIdentity,
} from './domain/identity-normalization';
import { newUlid } from './domain/ulid';
import type { Clock } from './ports/clock.port';
import type { NotificationPort } from './ports/notification.port';
import type { PasswordHasherPort } from './ports/password-hasher.port';
import type {
  AcceptedResult,
  AdminPrincipal,
  AdminSessionTokenResult,
  RequestMetadata,
  SessionAuthorizationCheck,
  SessionTokenResult,
  SessionPurpose,
  SessionView,
  UserClientType,
  UserPrincipal,
  UserView,
} from './identity.types';

export interface RegisterUserCommand extends RequestMetadata {
  email?: string;
  username?: string;
  password: string;
  displayName?: string;
  clientType: UserClientType;
}

export interface AuthenticateCommand extends RequestMetadata {
  identifier: string;
  password: string;
  clientType: UserClientType;
}

export interface RefreshSessionCommand extends RequestMetadata {
  refreshToken: string;
  clientType: UserClientType;
}

export interface AuthenticateAdminCommand extends RequestMetadata {
  identifier: string;
  password: string;
}

export interface RefreshAdminSessionCommand extends RequestMetadata {
  refreshToken: string;
}

interface CreatedSession {
  id: string;
  userId: string;
  clientType: string;
  purpose: string;
  tokenFamilyId: string;
  expiresAt: Date;
}

interface RotatedSession {
  session: CreatedSession;
  rawRefreshToken: string;
}

interface IssuedOneTimeToken {
  rawToken: string;
  expiresAt: Date;
}

interface IdentityRecordView {
  type: string;
  value: string;
  verifiedAt: Date | null;
  isPrimary: boolean;
}

interface UserRecordView {
  id: string;
  displayName: string;
  status: string;
  locale: string;
  timezone: string;
  createdAt: Date;
  loginIdentities: IdentityRecordView[];
}

class RefreshReplayDetected extends Error {
  constructor(readonly familyId: string) {
    super('Refresh token replay detected');
  }
}

@Injectable()
export class IdentityApplicationService {
  private readonly logger = new Logger(IdentityApplicationService.name);

  constructor(
    private readonly prisma: PrismaService,
    @Inject(PASSWORD_HASHER_PORT)
    private readonly passwordHasher: PasswordHasherPort,
    @Inject(NOTIFICATION_PORT)
    private readonly notification: NotificationPort,
    @Inject(IDENTITY_CLOCK) private readonly clock: Clock,
    @Inject(IDENTITY_SECURITY_CONFIG)
    private readonly config: IdentitySecurityConfig,
    private readonly opaqueTokens: OpaqueTokenService,
    private readonly accessTokens: AccessTokenService,
  ) {}

  async registerUser(
    command: RegisterUserCommand,
  ): Promise<SessionTokenResult> {
    this.assertPasswordInput(command.password);
    const email = command.email ? normalizeEmail(command.email) : undefined;
    const username = command.username
      ? normalizeUsername(command.username)
      : undefined;

    if (!email && !username) {
      throw new BadRequestException({
        code: 'IDENTITY_REQUIRED',
        message: '邮箱和用户名至少填写一项',
      });
    }

    const displayName = this.resolveDisplayName(
      command.displayName,
      username,
      email,
    );
    const passwordHash = await this.passwordHasher.hash(command.password);
    const now = this.clock.now();

    let created:
      | {
          session: CreatedSession;
          rawRefreshToken: string;
          emailVerification?: IssuedOneTimeToken;
        }
      | undefined;

    try {
      created = await this.prisma.$transaction(async (transaction) => {
        const userId = newUlid(now.getTime());
        await transaction.user.create({
          data: {
            id: userId,
            displayName,
            status: email ? 'PENDING_VERIFICATION' : 'ACTIVE',
          },
        });

        if (email) {
          await transaction.loginIdentity.create({
            data: {
              id: newUlid(now.getTime()),
              userId,
              type: EMAIL_IDENTITY,
              value: email.value,
              normalizedValue: email.normalizedValue,
              verifiedAt: null,
              isPrimary: true,
            },
          });
        }

        if (username) {
          await transaction.loginIdentity.create({
            data: {
              id: newUlid(now.getTime()),
              userId,
              type: USERNAME_IDENTITY,
              value: username.value,
              normalizedValue: username.normalizedValue,
              verifiedAt: now,
              isPrimary: !email,
            },
          });
        }

        await transaction.passwordCredential.create({
          data: {
            userId,
            passwordHash,
            algorithm: 'ARGON2ID',
            paramsVersion: 1,
            changedAt: now,
          },
        });

        const emailVerification = email
          ? await this.issueOneTimeToken(
              transaction,
              userId,
              await this.findIdentityId(
                transaction,
                EMAIL_IDENTITY,
                email.normalizedValue,
              ),
              EMAIL_VERIFICATION_PURPOSE,
              this.config.emailVerificationTtlSeconds,
              now,
            )
          : undefined;
        const session = await this.createSession(
          transaction,
          userId,
          command.clientType,
          USER_SESSION_PURPOSE,
          command,
          now,
        );

        return { ...session, emailVerification };
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new RegistrationUnavailableException();
      }
      throw error;
    }

    if (email && created.emailVerification) {
      await this.deliverQuietly(() =>
        this.notification.sendEmailVerification({
          email: email.value,
          token: created.emailVerification!.rawToken,
          expiresAt: created.emailVerification!.expiresAt,
        }),
      );
    }

    return this.toSessionToken(created.session, created.rawRefreshToken);
  }

  async authenticate(
    command: AuthenticateCommand,
  ): Promise<SessionTokenResult> {
    const userId = await this.authenticateCredentials(
      command.identifier,
      command.password,
    );

    const now = this.clock.now();
    const created = await this.prisma.$transaction((transaction) =>
      this.createSession(
        transaction,
        userId,
        command.clientType,
        USER_SESSION_PURPOSE,
        command,
        now,
      ),
    );

    return this.toSessionToken(created.session, created.rawRefreshToken);
  }

  async authenticateAdmin(
    command: AuthenticateAdminCommand,
    authorize: SessionAuthorizationCheck,
  ): Promise<AdminSessionTokenResult> {
    const userId = await this.authenticateCredentials(
      command.identifier,
      command.password,
    );

    await authorize(userId);
    const now = this.clock.now();
    const created = await this.prisma.$transaction((transaction) =>
      this.createSession(
        transaction,
        userId,
        'ADMIN_WEB',
        ADMIN_SESSION_PURPOSE,
        command,
        now,
      ),
    );
    const result = this.toAdminSessionToken(
      created.session,
      created.rawRefreshToken,
    );

    try {
      await authorize(userId);
    } catch (error) {
      await this.revokeAdminSession(userId, created.session.id);
      throw error;
    }

    return result;
  }

  async refreshSession(
    command: RefreshSessionCommand,
  ): Promise<SessionTokenResult> {
    const rotated = await this.rotateSession(
      command.refreshToken,
      command.clientType,
      USER_SESSION_PURPOSE,
      command,
    );
    return this.toSessionToken(rotated.session, rotated.rawRefreshToken);
  }

  async refreshAdminSession(
    command: RefreshAdminSessionCommand,
    authorize: SessionAuthorizationCheck,
  ): Promise<AdminSessionTokenResult> {
    const rotated = await this.rotateSession(
      command.refreshToken,
      'ADMIN_WEB',
      ADMIN_SESSION_PURPOSE,
      command,
      authorize,
    );
    const result = this.toAdminSessionToken(
      rotated.session,
      rotated.rawRefreshToken,
    );

    try {
      await authorize(rotated.session.userId);
    } catch {
      await this.revokeRefreshFamily(
        rotated.session.tokenFamilyId,
        this.clock.now(),
      );
      throw new InvalidRefreshTokenException();
    }

    return result;
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: {
        id: sessionId,
        userId,
        purpose: USER_SESSION_PURPOSE,
        revokedAt: null,
      },
      data: { revokedAt: this.clock.now() },
    });
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { userId, purpose: USER_SESSION_PURPOSE, revokedAt: null },
      data: { revokedAt: this.clock.now() },
    });
  }

  async revokeAdminSession(userId: string, sessionId: string): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: {
        id: sessionId,
        userId,
        purpose: ADMIN_SESSION_PURPOSE,
        revokedAt: null,
      },
      data: { revokedAt: this.clock.now() },
    });
  }

  async resolvePrincipal(accessToken: string): Promise<UserPrincipal> {
    const claims = this.accessTokens.verifyUser(accessToken);
    if (!claims) {
      throw new InvalidAccessTokenException();
    }

    const session = await this.prisma.userSession.findUnique({
      where: { id: claims.sessionId },
      include: { user: true },
    });
    const now = this.clock.now();

    if (
      !session ||
      session.userId !== claims.userId ||
      session.purpose !== USER_SESSION_PURPOSE ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.user.deletedAt ||
      !this.isLoginAllowed(session.user.status)
    ) {
      throw new InvalidAccessTokenException();
    }

    return {
      kind: 'USER',
      userId: session.userId,
      sessionId: session.id,
      tokenId: claims.tokenId,
      status: session.user.status,
    };
  }

  async resolveAdminPrincipal(accessToken: string): Promise<AdminPrincipal> {
    const claims = this.accessTokens.verifyAdmin(accessToken);
    if (!claims) {
      throw new InvalidAccessTokenException();
    }

    const session = await this.prisma.userSession.findUnique({
      where: { id: claims.sessionId },
      include: { user: true },
    });
    const now = this.clock.now();

    if (
      !session ||
      session.userId !== claims.userId ||
      session.purpose !== ADMIN_SESSION_PURPOSE ||
      session.revokedAt ||
      session.expiresAt <= now ||
      session.user.deletedAt ||
      !this.isLoginAllowed(session.user.status)
    ) {
      throw new InvalidAccessTokenException();
    }

    return {
      kind: 'ADMIN',
      userId: session.userId,
      sessionId: session.id,
      tokenId: claims.tokenId,
      status: session.user.status,
    };
  }

  async getMe(principal: { userId: string }): Promise<UserView> {
    const user = await this.prisma.user.findUnique({
      where: { id: principal.userId },
      include: {
        loginIdentities: {
          orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
        },
      },
    });

    if (!user || user.deletedAt) {
      throw new InvalidAccessTokenException();
    }

    return this.toUserView(user);
  }

  async listSessions(principal: UserPrincipal): Promise<SessionView[]> {
    const sessions = await this.prisma.userSession.findMany({
      where: { userId: principal.userId, purpose: USER_SESSION_PURPOSE },
      orderBy: { issuedAt: 'desc' },
      take: 100,
    });

    return sessions.map((session) => ({
      id: session.id,
      clientType: session.clientType,
      current: session.id === principal.sessionId,
      issuedAt: session.issuedAt.toISOString(),
      expiresAt: session.expiresAt.toISOString(),
      lastUsedAt: session.lastUsedAt?.toISOString() ?? null,
      revokedAt: session.revokedAt?.toISOString() ?? null,
      userAgent: session.userAgent,
    }));
  }

  async requestEmailVerification(
    userId: string,
    emailInput: string,
  ): Promise<AcceptedResult> {
    const email = normalizeEmail(emailInput);
    let delivery: { email: string; issued: IssuedOneTimeToken } | null = null;

    try {
      delivery = await this.prisma.$transaction(async (transaction) => {
        const user = await transaction.user.findUnique({
          where: { id: userId },
        });
        if (!user || user.deletedAt || !this.isLoginAllowed(user.status)) {
          return null;
        }

        let identity = await transaction.loginIdentity.findUnique({
          where: {
            type_normalizedValue: {
              type: EMAIL_IDENTITY,
              normalizedValue: email.normalizedValue,
            },
          },
        });

        // This endpoint also attaches the first email to a username-only
        // account. It never transfers an identity already owned by someone else.
        if (identity && identity.userId !== userId) {
          return null;
        }
        identity ??= await transaction.loginIdentity.create({
          data: {
            id: newUlid(this.clock.now().getTime()),
            userId,
            type: EMAIL_IDENTITY,
            value: email.value,
            normalizedValue: email.normalizedValue,
            verifiedAt: null,
            isPrimary: false,
          },
        });
        if (identity.verifiedAt) {
          return null;
        }

        const issued = await this.issueOneTimeToken(
          transaction,
          userId,
          identity.id,
          EMAIL_VERIFICATION_PURPOSE,
          this.config.emailVerificationTtlSeconds,
          this.clock.now(),
        );
        return { email: identity.value, issued };
      });
    } catch (error) {
      // Concurrent attachment or an email already owned by another user has
      // the same accepted response; neither condition discloses ownership.
      if (!this.isUniqueConstraintError(error)) {
        throw error;
      }
    }

    if (delivery) {
      await this.deliverQuietly(() =>
        this.notification.sendEmailVerification({
          email: delivery.email,
          token: delivery.issued.rawToken,
          expiresAt: delivery.issued.expiresAt,
        }),
      );
    }

    return { accepted: true };
  }

  async confirmEmailVerification(
    rawToken: string,
  ): Promise<{ verified: true }> {
    const tokenHash = this.opaqueTokens.hashOneTimeToken(rawToken);
    const token = await this.prisma.oneTimeToken.findUnique({
      where: { tokenHash },
    });
    const now = this.clock.now();

    if (
      !token ||
      token.purpose !== EMAIL_VERIFICATION_PURPOSE ||
      !token.identityId ||
      token.consumedAt ||
      token.expiresAt <= now
    ) {
      await this.countInvalidOneTimeAttempt(token?.id);
      throw new InvalidOneTimeTokenException();
    }

    await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.oneTimeToken.updateMany({
        where: {
          id: token.id,
          purpose: EMAIL_VERIFICATION_PURPOSE,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new InvalidOneTimeTokenException();
      }

      const verified = await transaction.loginIdentity.updateMany({
        where: {
          id: token.identityId!,
          userId: token.userId,
          type: EMAIL_IDENTITY,
        },
        data: { verifiedAt: now },
      });
      if (verified.count !== 1) {
        throw new InvalidOneTimeTokenException();
      }

      await transaction.user.updateMany({
        where: { id: token.userId, status: 'PENDING_VERIFICATION' },
        data: { status: 'ACTIVE', version: { increment: 1 } },
      });
    });

    return { verified: true };
  }

  async requestPasswordReset(identifierInput: string): Promise<AcceptedResult> {
    const normalized = normalizeLoginIdentifier(identifierInput);
    const identity = await this.prisma.loginIdentity.findUnique({
      where: {
        type_normalizedValue: {
          type: normalized.type,
          normalizedValue: normalized.normalizedValue,
        },
      },
      include: { user: true },
    });

    if (
      identity &&
      !identity.user.deletedAt &&
      this.isLoginAllowed(identity.user.status)
    ) {
      const email = await this.prisma.loginIdentity.findFirst({
        where: {
          userId: identity.userId,
          type: EMAIL_IDENTITY,
          verifiedAt: { not: null },
        },
        orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
      });

      if (email) {
        const issued = await this.prisma.$transaction((transaction) =>
          this.issueOneTimeToken(
            transaction,
            identity.userId,
            email.id,
            PASSWORD_RESET_PURPOSE,
            this.config.passwordResetTtlSeconds,
            this.clock.now(),
          ),
        );

        await this.deliverQuietly(() =>
          this.notification.sendPasswordReset({
            email: email.value,
            token: issued.rawToken,
            expiresAt: issued.expiresAt,
          }),
        );
      }
    }

    return { accepted: true };
  }

  async completePasswordReset(
    rawToken: string,
    newPassword: string,
  ): Promise<{ completed: true }> {
    this.assertPasswordInput(newPassword);
    const tokenHash = this.opaqueTokens.hashOneTimeToken(rawToken);
    const token = await this.prisma.oneTimeToken.findUnique({
      where: { tokenHash },
    });
    const now = this.clock.now();

    if (
      !token ||
      token.purpose !== PASSWORD_RESET_PURPOSE ||
      token.consumedAt ||
      token.expiresAt <= now
    ) {
      await this.countInvalidOneTimeAttempt(token?.id);
      throw new InvalidOneTimeTokenException();
    }

    const passwordHash = await this.passwordHasher.hash(newPassword);
    await this.prisma.$transaction(async (transaction) => {
      const consumed = await transaction.oneTimeToken.updateMany({
        where: {
          id: token.id,
          purpose: PASSWORD_RESET_PURPOSE,
          consumedAt: null,
          expiresAt: { gt: now },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) {
        throw new InvalidOneTimeTokenException();
      }

      await transaction.passwordCredential.upsert({
        where: { userId: token.userId },
        create: {
          userId: token.userId,
          passwordHash,
          algorithm: 'ARGON2ID',
          paramsVersion: 1,
          changedAt: now,
        },
        update: {
          passwordHash,
          algorithm: 'ARGON2ID',
          paramsVersion: 1,
          changedAt: now,
        },
      });
      await transaction.userSession.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.oneTimeToken.updateMany({
        where: {
          userId: token.userId,
          purpose: PASSWORD_RESET_PURPOSE,
          consumedAt: null,
        },
        data: { consumedAt: now },
      });
    });

    return { completed: true };
  }

  async reauthenticateUser(userId: string, password: string): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { passwordCredential: true },
    });
    const passwordHash = user?.passwordCredential?.passwordHash ?? null;
    const passwordValid = await this.passwordHasher.verify(
      password,
      passwordHash,
    );
    if (
      !user ||
      !passwordValid ||
      user.deletedAt ||
      !this.isLoginAllowed(user.status)
    ) {
      throw new InvalidCredentialsException();
    }
  }

  private async authenticateCredentials(
    identifier: string,
    password: string,
  ): Promise<string> {
    const normalized = normalizeLoginIdentifier(identifier);
    const identity = await this.prisma.loginIdentity.findUnique({
      where: {
        type_normalizedValue: {
          type: normalized.type,
          normalizedValue: normalized.normalizedValue,
        },
      },
      include: {
        user: {
          include: { passwordCredential: true },
        },
      },
    });

    const passwordHash =
      identity?.user.passwordCredential?.passwordHash ?? null;
    const passwordValid = await this.passwordHasher.verify(
      password,
      passwordHash,
    );

    if (
      !identity ||
      !passwordValid ||
      identity.user.deletedAt ||
      !this.isLoginAllowed(identity.user.status)
    ) {
      throw new InvalidCredentialsException();
    }

    return identity.userId;
  }

  private async rotateSession(
    refreshToken: string,
    expectedClientType: UserClientType | 'ADMIN_WEB',
    expectedPurpose: SessionPurpose,
    metadata: RequestMetadata,
    authorize?: SessionAuthorizationCheck,
  ): Promise<RotatedSession> {
    const tokenHash = this.opaqueTokens.hashRefreshToken(refreshToken);
    const now = this.clock.now();
    const previous = await this.prisma.userSession.findUnique({
      where: { refreshTokenHash: tokenHash },
      include: { user: true },
    });

    if (!previous) {
      throw new InvalidRefreshTokenException();
    }

    // A token presented at the wrong authentication boundary is rejected
    // without mutating the other boundary's session family.
    if (
      previous.clientType !== expectedClientType ||
      previous.purpose !== expectedPurpose
    ) {
      throw new InvalidRefreshTokenException();
    }

    if (
      previous.revokedAt ||
      previous.rotatedAt ||
      previous.expiresAt <= now ||
      previous.user.deletedAt ||
      !this.isLoginAllowed(previous.user.status)
    ) {
      await this.revokeRefreshFamily(previous.tokenFamilyId, now);
      throw new InvalidRefreshTokenException();
    }

    if (authorize) {
      try {
        await authorize(previous.userId);
      } catch {
        await this.revokeRefreshFamily(previous.tokenFamilyId, now);
        throw new InvalidRefreshTokenException();
      }
    }

    const rawRefreshToken = this.opaqueTokens.generate();
    const replacementId = newUlid(now.getTime());
    const replacementExpiresAt = new Date(
      now.getTime() + this.config.refreshTokenTtlSeconds * 1000,
    );

    let replacement: CreatedSession;
    try {
      replacement = await this.prisma.$transaction(async (transaction) => {
        const claimed = await transaction.userSession.updateMany({
          where: {
            id: previous.id,
            clientType: expectedClientType,
            purpose: expectedPurpose,
            revokedAt: null,
            rotatedAt: null,
            expiresAt: { gt: now },
          },
          data: {
            rotatedAt: now,
            lastUsedAt: now,
            replacedBySessionId: replacementId,
          },
        });

        if (claimed.count !== 1) {
          throw new RefreshReplayDetected(previous.tokenFamilyId);
        }

        return transaction.userSession.create({
          data: {
            id: replacementId,
            userId: previous.userId,
            deviceId: previous.deviceId,
            refreshTokenHash:
              this.opaqueTokens.hashRefreshToken(rawRefreshToken),
            tokenFamilyId: previous.tokenFamilyId,
            clientType: previous.clientType,
            purpose: previous.purpose,
            issuedAt: now,
            expiresAt: replacementExpiresAt,
            ipHash: this.opaqueTokens.hashIpAddress(metadata.ipAddress),
            userAgent: this.cleanUserAgent(metadata.userAgent),
          },
        });
      });
    } catch (error) {
      if (error instanceof RefreshReplayDetected) {
        await this.revokeRefreshFamily(error.familyId, now);
        throw new InvalidRefreshTokenException();
      }
      throw error;
    }

    return { session: replacement, rawRefreshToken };
  }

  private async createSession(
    transaction: Prisma.TransactionClient,
    userId: string,
    clientType: UserClientType | 'ADMIN_WEB',
    purpose: SessionPurpose,
    metadata: RequestMetadata,
    now: Date,
  ): Promise<{ session: CreatedSession; rawRefreshToken: string }> {
    const rawRefreshToken = this.opaqueTokens.generate();
    const session = await transaction.userSession.create({
      data: {
        id: newUlid(now.getTime()),
        userId,
        refreshTokenHash: this.opaqueTokens.hashRefreshToken(rawRefreshToken),
        tokenFamilyId: newUlid(now.getTime()),
        clientType,
        purpose,
        issuedAt: now,
        expiresAt: new Date(
          now.getTime() + this.config.refreshTokenTtlSeconds * 1000,
        ),
        ipHash: this.opaqueTokens.hashIpAddress(metadata.ipAddress),
        userAgent: this.cleanUserAgent(metadata.userAgent),
      },
    });

    return { session, rawRefreshToken };
  }

  private async issueOneTimeToken(
    transaction: Prisma.TransactionClient,
    userId: string,
    identityId: string | null,
    purpose: string,
    ttlSeconds: number,
    now: Date,
  ): Promise<IssuedOneTimeToken> {
    const rawToken = this.opaqueTokens.generate();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);

    await transaction.oneTimeToken.updateMany({
      where: { userId, purpose, consumedAt: null },
      data: { consumedAt: now },
    });
    await transaction.oneTimeToken.create({
      data: {
        id: newUlid(now.getTime()),
        userId,
        identityId,
        purpose,
        tokenHash: this.opaqueTokens.hashOneTimeToken(rawToken),
        expiresAt,
      },
    });

    return { rawToken, expiresAt };
  }

  private async findIdentityId(
    transaction: Prisma.TransactionClient,
    type: string,
    normalizedValue: string,
  ): Promise<string> {
    const identity = await transaction.loginIdentity.findUniqueOrThrow({
      where: { type_normalizedValue: { type, normalizedValue } },
      select: { id: true },
    });
    return identity.id;
  }

  private toSessionToken(
    session: CreatedSession,
    rawRefreshToken: string,
  ): SessionTokenResult {
    const access = this.accessTokens.issueUser(session.userId, session.id);

    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      expiresInSeconds: this.config.accessTokenTtlSeconds,
      refreshToken: rawRefreshToken,
      refreshTokenExpiresAt: session.expiresAt.toISOString(),
      sessionId: session.id,
      clientType: session.clientType as UserClientType,
    };
  }

  private toAdminSessionToken(
    session: CreatedSession,
    rawRefreshToken: string,
  ): AdminSessionTokenResult {
    const access = this.accessTokens.issueAdmin(session.userId, session.id);

    return {
      accessToken: access.token,
      accessTokenExpiresAt: access.expiresAt.toISOString(),
      expiresInSeconds: this.config.adminAccessTokenTtlSeconds,
      refreshToken: rawRefreshToken,
      refreshTokenExpiresAt: session.expiresAt.toISOString(),
      sessionId: session.id,
      purpose: ADMIN_SESSION_PURPOSE,
    };
  }

  private toUserView(user: UserRecordView): UserView {
    return {
      id: user.id,
      displayName: user.displayName,
      status: user.status,
      locale: user.locale,
      timezone: user.timezone,
      identities: user.loginIdentities.map((identity) => ({
        type: identity.type,
        value: identity.value,
        verifiedAt: identity.verifiedAt?.toISOString() ?? null,
        isPrimary: identity.isPrimary,
      })),
      createdAt: user.createdAt.toISOString(),
    };
  }

  private resolveDisplayName(
    input: string | undefined,
    username: NormalizedIdentity | undefined,
    email: NormalizedIdentity | undefined,
  ): string {
    const value =
      input?.trim().normalize('NFKC') ||
      username?.value ||
      email?.value.split('@')[0] ||
      '新用户';

    if (value.length > 100) {
      throw new BadRequestException({
        code: 'INVALID_DISPLAY_NAME',
        message: '显示名称不能超过 100 个字符',
      });
    }

    return value;
  }

  private assertPasswordInput(password: string): void {
    if (
      password.length < 10 ||
      password.length > 128 ||
      Buffer.byteLength(password, 'utf8') > 256
    ) {
      throw new BadRequestException({
        code: 'INVALID_PASSWORD',
        message: '密码长度需为 10–128 个字符',
      });
    }
  }

  private cleanUserAgent(userAgent: string | undefined): string | null {
    return userAgent?.slice(0, 512) || null;
  }

  private isLoginAllowed(status: string): boolean {
    return (ACTIVE_USER_STATUSES as readonly string[]).includes(status);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: unknown }).code === 'P2002'
    );
  }

  private async revokeRefreshFamily(
    familyId: string,
    now: Date,
  ): Promise<void> {
    await this.prisma.userSession.updateMany({
      where: { tokenFamilyId: familyId, revokedAt: null },
      data: { revokedAt: now },
    });
  }

  private async countInvalidOneTimeAttempt(
    tokenId: string | undefined,
  ): Promise<void> {
    if (!tokenId) {
      return;
    }

    await this.prisma.oneTimeToken.updateMany({
      where: { id: tokenId },
      data: { attemptCount: { increment: 1 } },
    });
  }

  private async deliverQuietly(deliver: () => Promise<void>): Promise<void> {
    try {
      await deliver();
    } catch {
      // Do not leak account existence or raw tokens. Operational telemetry may
      // report the event name, but never the recipient or delivery payload.
      this.logger.warn('Identity notification delivery failed');
    }
  }
}
