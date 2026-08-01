import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  AdminAccessGuard,
  type AdminAuthenticatedRequest,
} from '../../identity/http/admin-access.guard';
import {
  REQUIRED_PLATFORM_ROLES_KEY,
  type PlatformRoleCode,
} from '../platform-operations.constants';
import { PlatformAccessDeniedException } from '../platform-operations.errors';
import { PlatformRoleAuthorizer } from '../platform-role.authorizer';

export type PlatformAuthenticatedRequest = AdminAuthenticatedRequest & {
  platformRoles?: PlatformRoleCode[];
};

@Injectable()
export class PlatformRoleGuard implements CanActivate {
  constructor(
    private readonly adminAccessGuard: AdminAccessGuard,
    private readonly platformRoles: PlatformRoleAuthorizer,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<PlatformAuthenticatedRequest>();

    // Controllers normally install AdminAccessGuard before this Guard. Keeping
    // this fallback makes the admin boundary safe when reused alone.
    if (!request.adminPrincipal) {
      await this.adminAccessGuard.canActivate(context);
    }
    const principal = request.adminPrincipal;
    if (!principal) {
      throw new PlatformAccessDeniedException();
    }

    const required = this.reflector.getAllAndOverride<PlatformRoleCode[]>(
      REQUIRED_PLATFORM_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    const roles = await this.platformRoles.requireAny(
      principal.userId,
      required,
    );

    request.platformRoles = roles;
    return true;
  }
}
