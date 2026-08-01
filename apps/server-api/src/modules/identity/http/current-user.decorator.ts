import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import type { Request } from 'express';

import type { UserPrincipal } from '../identity.types';

export type AuthenticatedRequest = Request & {
  userPrincipal?: UserPrincipal;
};

export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): UserPrincipal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.userPrincipal) {
      throw new InternalServerErrorException(
        'Authenticated principal is missing',
      );
    }

    return request.userPrincipal;
  },
);
