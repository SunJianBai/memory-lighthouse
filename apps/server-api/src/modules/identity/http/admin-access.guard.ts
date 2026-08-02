import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { IdentityApplicationService } from '../identity.application.service';
import { InvalidAccessTokenException } from '../identity.errors';
import type { AdminPrincipal } from '../identity.types';

export type AdminAuthenticatedRequest = Request & {
  adminPrincipal?: AdminPrincipal;
};

@Injectable()
export class AdminAccessGuard implements CanActivate {
  constructor(private readonly identity: IdentityApplicationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<AdminAuthenticatedRequest>();
    const authorization = request.headers.authorization;

    if (!authorization || Array.isArray(authorization)) {
      throw new InvalidAccessTokenException();
    }

    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);
    if (!match) {
      throw new InvalidAccessTokenException();
    }

    request.adminPrincipal = await this.identity.resolveAdminPrincipal(
      match[1],
    );
    return true;
  }
}
