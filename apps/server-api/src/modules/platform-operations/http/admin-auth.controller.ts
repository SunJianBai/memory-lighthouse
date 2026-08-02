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
import type { IdentitySecurityConfig } from '../../identity/config/identity-security.config';
import { IDENTITY_SECURITY_CONFIG } from '../../identity/identity.constants';
import type {
  AdminPrincipal,
  AdminSessionTokenResult,
  PublicAdminSessionTokenResult,
} from '../../identity/identity.types';
import { AdminAccessGuard } from '../../identity/http/admin-access.guard';
import { CurrentAdmin } from '../../identity/http/current-admin.decorator';
import { InvalidRefreshTokenException } from '../../identity/identity.errors';
import { AdminAuthenticationApplicationService } from '../admin-authentication.application.service';
import { AdminLoginDto } from './admin-auth.dto';

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

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly authentication: AdminAuthenticationApplicationService,
    @Inject(IDENTITY_SECURITY_CONFIG)
    private readonly config: IdentitySecurityConfig,
  ) {}

  @Post('login')
  @RateLimited(RateLimitPolicy.AUTH_LOGIN)
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() input: AdminLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicAdminSessionTokenResult> {
    const result = await this.authentication.login({
      ...input,
      ...requestMetadata(request),
    });
    return this.writeRefreshCookie(result, response);
  }

  @Post('refresh')
  @RateLimited(RateLimitPolicy.AUTH_REFRESH)
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicAdminSessionTokenResult> {
    const refreshToken = readCookie(
      request,
      this.config.adminRefreshCookieName,
    );
    if (!refreshToken) {
      throw new InvalidRefreshTokenException();
    }

    const result = await this.authentication.refresh({
      refreshToken,
      ...requestMetadata(request),
    });
    return this.writeRefreshCookie(result, response);
  }

  @Post('logout')
  @UseGuards(AdminAccessGuard)
  @HttpCode(HttpStatus.OK)
  async logout(
    @CurrentAdmin() principal: AdminPrincipal,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ loggedOut: true }> {
    await this.authentication.logout(principal.userId, principal.sessionId);
    response.clearCookie(
      this.config.adminRefreshCookieName,
      this.refreshCookieOptions(undefined),
    );
    return { loggedOut: true };
  }

  private writeRefreshCookie(
    result: AdminSessionTokenResult,
    response: Response,
  ): PublicAdminSessionTokenResult {
    const { refreshToken, ...publicResult } = result;
    response.cookie(
      this.config.adminRefreshCookieName,
      refreshToken,
      this.refreshCookieOptions(
        new Date(result.refreshTokenExpiresAt).getTime() - Date.now(),
      ),
    );
    return publicResult;
  }

  private refreshCookieOptions(maxAge: number | undefined): CookieOptions {
    return {
      httpOnly: true,
      maxAge: maxAge === undefined ? undefined : Math.max(0, maxAge),
      path: this.config.adminRefreshCookiePath,
      sameSite: 'strict',
      secure: this.config.secureCookies,
    };
  }
}
