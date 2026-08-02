import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';

import {
  RateLimited,
  RateLimitPolicy,
} from '../../../infrastructure/rate-limit';
import type { IdentitySecurityConfig } from '../config/identity-security.config';
import { IDENTITY_SECURITY_CONFIG } from '../identity.constants';
import { IdentityApplicationService } from '../identity.application.service';
import { InvalidRefreshTokenException } from '../identity.errors';
import type {
  PublicSessionTokenResult,
  SessionTokenResult,
  UserPrincipal,
} from '../identity.types';
import { CurrentUser } from './current-user.decorator';
import {
  ClientTypeDto,
  EmailVerificationRequestDto,
  LoginDto,
  OneTimeTokenConfirmDto,
  PasswordResetConfirmDto,
  PasswordResetRequestDto,
  RefreshDto,
  RegisterDto,
} from './identity.dto';
import { UserAccessGuard } from './user-access.guard';

function requestMetadata(request: Request): {
  ipAddress?: string;
  userAgent?: string;
} {
  return {
    ipAddress: request.ip,
    userAgent: request.get('user-agent'),
  };
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) {
    return undefined;
  }

  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator).trim() !== name) {
      continue;
    }

    try {
      return decodeURIComponent(pair.slice(separator + 1).trim());
    } catch {
      return undefined;
    }
  }

  return undefined;
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly identity: IdentityApplicationService,
    @Inject(IDENTITY_SECURITY_CONFIG)
    private readonly config: IdentitySecurityConfig,
  ) {}

  @Post('register')
  @RateLimited(RateLimitPolicy.AUTH_REGISTER)
  async register(
    @Body() input: RegisterDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicSessionTokenResult> {
    const result = await this.identity.registerUser({
      ...input,
      ...requestMetadata(request),
    });
    return this.writeRefreshTransport(result, response);
  }

  @Post('login')
  @RateLimited(RateLimitPolicy.AUTH_LOGIN)
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() input: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicSessionTokenResult> {
    const result = await this.identity.authenticate({
      ...input,
      ...requestMetadata(request),
    });
    return this.writeRefreshTransport(result, response);
  }

  @Post('refresh')
  @RateLimited(RateLimitPolicy.AUTH_REFRESH)
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() input: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicSessionTokenResult> {
    const refreshToken =
      input.clientType === ClientTypeDto.WEB
        ? readCookie(request, this.config.refreshCookieName)
        : input.refreshToken;
    if (!refreshToken) {
      throw new InvalidRefreshTokenException();
    }

    const result = await this.identity.refreshSession({
      refreshToken,
      clientType: input.clientType,
      ...requestMetadata(request),
    });
    return this.writeRefreshTransport(result, response);
  }

  @Post('logout')
  @UseGuards(UserAccessGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentUser() principal: UserPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ loggedOut: true }> {
    await this.identity.revokeSession(principal.userId, principal.sessionId);
    this.clearRefreshCookie(response);
    return { loggedOut: true };
  }

  @Post('device-mode-lock')
  @RateLimited(RateLimitPolicy.AUTH_REFRESH)
  @HttpCode(HttpStatus.OK)
  async lockDeviceMode(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ locked: true }> {
    const refreshToken = readCookie(request, this.config.refreshCookieName);
    if (refreshToken) {
      await this.identity.revokeWebSessionByRefreshToken(refreshToken);
    }
    this.clearRefreshCookie(response);
    return { locked: true };
  }

  @Post('logout-all')
  @UseGuards(UserAccessGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAll(
    @CurrentUser() principal: UserPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ loggedOut: true }> {
    await this.identity.revokeAllSessions(principal.userId);
    this.clearRefreshCookie(response);
    return { loggedOut: true };
  }

  @Post('email-verifications')
  @RateLimited(RateLimitPolicy.AUTH_EMAIL_VERIFICATION_REQUEST)
  @UseGuards(UserAccessGuard)
  @HttpCode(HttpStatus.ACCEPTED)
  requestEmailVerification(
    @CurrentUser() principal: UserPrincipal,
    @Body() input: EmailVerificationRequestDto,
  ) {
    return this.identity.requestEmailVerification(
      principal.userId,
      input.email,
    );
  }

  @Post('email-verifications/confirm')
  @RateLimited(RateLimitPolicy.AUTH_EMAIL_VERIFICATION_CONFIRM)
  @HttpCode(HttpStatus.OK)
  confirmEmailVerification(@Body() input: OneTimeTokenConfirmDto) {
    return this.identity.confirmEmailVerification(input.token);
  }

  @Post('password-resets')
  @RateLimited(RateLimitPolicy.AUTH_PASSWORD_RESET_REQUEST)
  @HttpCode(HttpStatus.ACCEPTED)
  requestPasswordReset(@Body() input: PasswordResetRequestDto) {
    return this.identity.requestPasswordReset(input.identifier);
  }

  @Post('password-resets/confirm')
  @RateLimited(RateLimitPolicy.AUTH_PASSWORD_RESET_CONFIRM)
  @HttpCode(HttpStatus.OK)
  confirmPasswordReset(@Body() input: PasswordResetConfirmDto) {
    return this.identity.completePasswordReset(input.token, input.newPassword);
  }

  private writeRefreshTransport(
    result: SessionTokenResult,
    response: Response,
  ): PublicSessionTokenResult {
    const { refreshToken, ...publicResult } = result;

    if (result.clientType === 'WEB') {
      response.cookie(
        this.config.refreshCookieName,
        refreshToken,
        this.refreshCookieOptions(
          new Date(result.refreshTokenExpiresAt).getTime() - Date.now(),
        ),
      );
      return publicResult;
    }

    return { ...publicResult, refreshToken };
  }

  private clearRefreshCookie(response: Response): void {
    response.clearCookie(
      this.config.refreshCookieName,
      this.refreshCookieOptions(undefined),
    );
  }

  private refreshCookieOptions(maxAge: number | undefined): CookieOptions {
    return {
      httpOnly: true,
      maxAge: maxAge === undefined ? undefined : Math.max(0, maxAge),
      path: this.config.refreshCookiePath,
      sameSite: 'strict',
      secure: this.config.secureCookies,
    };
  }
}
