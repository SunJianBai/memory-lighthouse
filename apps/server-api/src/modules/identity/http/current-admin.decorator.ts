import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';

import type { AdminPrincipal } from '../identity.types';
import type { AdminAuthenticatedRequest } from './admin-access.guard';

export const CurrentAdmin = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AdminPrincipal => {
    const request = context
      .switchToHttp()
      .getRequest<AdminAuthenticatedRequest>();
    if (!request.adminPrincipal) {
      throw new InternalServerErrorException(
        'Authenticated admin principal is missing',
      );
    }

    return request.adminPrincipal;
  },
);
