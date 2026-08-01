import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';

import type { PlatformPrincipal } from '../platform-operations.types';
import type { PlatformAuthenticatedRequest } from './platform-role.guard';

export const CurrentPlatformPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): PlatformPrincipal => {
    const request = context
      .switchToHttp()
      .getRequest<PlatformAuthenticatedRequest>();
    if (!request.adminPrincipal || !request.platformRoles) {
      throw new InternalServerErrorException(
        'Platform principal is missing after authentication',
      );
    }

    return { ...request.adminPrincipal, platformRoles: request.platformRoles };
  },
);
