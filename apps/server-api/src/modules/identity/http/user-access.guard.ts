import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';

import { IdentityApplicationService } from '../identity.application.service';
import { InvalidAccessTokenException } from '../identity.errors';
import type { AuthenticatedRequest } from './current-user.decorator';

@Injectable()
export class UserAccessGuard implements CanActivate {
  constructor(private readonly identity: IdentityApplicationService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;

    if (!authorization || Array.isArray(authorization)) {
      throw new InvalidAccessTokenException();
    }

    const match = /^Bearer ([A-Za-z0-9._~-]+)$/.exec(authorization);
    if (!match) {
      throw new InvalidAccessTokenException();
    }

    request.userPrincipal = await this.identity.resolvePrincipal(match[1]);
    return true;
  }
}
