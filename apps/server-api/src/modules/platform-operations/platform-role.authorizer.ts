import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  PLATFORM_ROLE_CODES,
  type PlatformRoleCode,
} from './platform-operations.constants';
import { PlatformAccessDeniedException } from './platform-operations.errors';

@Injectable()
export class PlatformRoleAuthorizer {
  constructor(private readonly prisma: PrismaService) {}

  async requireAny(
    userId: string,
    required: readonly PlatformRoleCode[] = PLATFORM_ROLE_CODES,
  ): Promise<PlatformRoleCode[]> {
    const assignments = await this.prisma.platformRoleAssignment.findMany({
      where: {
        userId,
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

    return roles;
  }
}
