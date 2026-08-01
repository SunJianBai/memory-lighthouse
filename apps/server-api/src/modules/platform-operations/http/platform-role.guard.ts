import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { PrismaService } from '../../../infrastructure/database/prisma.service';
import type { AuthenticatedRequest } from '../../identity/http/current-user.decorator';
import { UserAccessGuard } from '../../identity/http/user-access.guard';
import {
  PLATFORM_ROLE_CODES,
  REQUIRED_PLATFORM_ROLES_KEY,
  type PlatformRoleCode,
} from '../platform-operations.constants';
import { PlatformAccessDeniedException } from '../platform-operations.errors';

export type PlatformAuthenticatedRequest = AuthenticatedRequest & {
  platformRoles?: PlatformRoleCode[];
};

@Injectable()
export class PlatformRoleGuard implements CanActivate {
  constructor(
    private readonly userAccessGuard: UserAccessGuard,
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<PlatformAuthenticatedRequest>();

    // Controllers normally install UserAccessGuard before this Guard. Keeping
    // this fallback makes the platform boundary safe when reused alone.
    if (!request.userPrincipal) {
      await this.userAccessGuard.canActivate(context);
    }
    const principal = request.userPrincipal;
    if (!principal) {
      throw new PlatformAccessDeniedException();
    }

    const required = this.reflector.getAllAndOverride<PlatformRoleCode[]>(
      REQUIRED_PLATFORM_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    ) ?? [...PLATFORM_ROLE_CODES];

    const assignments = await this.prisma.platformRoleAssignment.findMany({
      where: {
        userId: principal.userId,
        role: {
          scope: 'PLATFORM',
          code: { in: [...PLATFORM_ROLE_CODES] },
        },
      },
      select: { role: { select: { code: true } } },
    });
    const roles = assignments
      .map(({ role }) => role.code)
      .filter((code): code is PlatformRoleCode =>
        (PLATFORM_ROLE_CODES as readonly string[]).includes(code),
      );

    if (!required.some((role) => roles.includes(role))) {
      throw new PlatformAccessDeniedException();
    }

    request.platformRoles = roles;
    return true;
  }
}
