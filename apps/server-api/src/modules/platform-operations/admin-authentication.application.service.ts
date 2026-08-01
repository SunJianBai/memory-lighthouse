import { Injectable } from '@nestjs/common';

import {
  IdentityApplicationService,
  type AuthenticateAdminCommand,
  type RefreshAdminSessionCommand,
} from '../identity/identity.application.service';
import type { AdminSessionTokenResult } from '../identity/identity.types';
import { PlatformRoleAuthorizer } from './platform-role.authorizer';

@Injectable()
export class AdminAuthenticationApplicationService {
  constructor(
    private readonly identity: IdentityApplicationService,
    private readonly platformRoles: PlatformRoleAuthorizer,
  ) {}

  login(command: AuthenticateAdminCommand): Promise<AdminSessionTokenResult> {
    return this.identity.authenticateAdmin(command, (userId) =>
      this.requireCurrentPlatformRole(userId),
    );
  }

  refresh(
    command: RefreshAdminSessionCommand,
  ): Promise<AdminSessionTokenResult> {
    return this.identity.refreshAdminSession(command, (userId) =>
      this.requireCurrentPlatformRole(userId),
    );
  }

  logout(userId: string, sessionId: string): Promise<void> {
    return this.identity.revokeAdminSession(userId, sessionId);
  }

  private async requireCurrentPlatformRole(userId: string): Promise<void> {
    await this.platformRoles.requireAny(userId);
  }
}
