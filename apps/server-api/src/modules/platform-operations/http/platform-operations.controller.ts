import { Controller, Get, Query, UseGuards } from '@nestjs/common';

import { IdentityApplicationService } from '../../identity/identity.application.service';
import { AdminAccessGuard } from '../../identity/http/admin-access.guard';
import { capabilitiesForPlatformRoles } from '../platform-capabilities';
import { PlatformOperationsApplicationService } from '../platform-operations.application.service';
import type {
  PlatformIdentityView,
  PlatformPrincipal,
} from '../platform-operations.types';
import { CurrentPlatformPrincipal } from './current-platform-principal.decorator';
import { PlatformPageQueryDto } from './platform-operations.dto';
import { RequirePlatformRoles } from './platform-role.decorator';
import { PlatformRoleGuard } from './platform-role.guard';

@Controller('admin')
@UseGuards(AdminAccessGuard, PlatformRoleGuard)
@RequirePlatformRoles('ADMIN', 'CONTENT_AUDITOR')
export class PlatformOperationsController {
  constructor(
    private readonly operations: PlatformOperationsApplicationService,
    private readonly identity: IdentityApplicationService,
  ) {}

  @Get('identity')
  async getIdentity(
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
  ): Promise<PlatformIdentityView> {
    return {
      user: await this.identity.getMe(principal),
      platformRoles: principal.platformRoles,
      capabilities: capabilitiesForPlatformRoles(principal.platformRoles),
    };
  }

  @Get('operations/dashboard')
  @RequirePlatformRoles('ADMIN')
  dashboard(): Promise<Record<string, unknown>> {
    return this.operations.dashboard();
  }

  @Get('users')
  @RequirePlatformRoles('ADMIN')
  listUsers(@Query() query: PlatformPageQueryDto) {
    return this.operations.listUsers(query);
  }

  @Get('households')
  @RequirePlatformRoles('ADMIN')
  listHouseholds(@Query() query: PlatformPageQueryDto) {
    return this.operations.listHouseholds(query);
  }

  @Get('devices')
  @RequirePlatformRoles('ADMIN')
  listDevices(@Query() query: PlatformPageQueryDto) {
    return this.operations.listDevices(query);
  }

  @Get('model-sessions')
  @RequirePlatformRoles('ADMIN')
  listModelSessions(@Query() query: PlatformPageQueryDto) {
    return this.operations.listModelSessions(query);
  }

  @Get('remote-sessions')
  @RequirePlatformRoles('ADMIN')
  listRemoteSessions(@Query() query: PlatformPageQueryDto) {
    return this.operations.listRemoteSessions(query);
  }

  @Get('audit-logs')
  listAuditLogs(@Query() query: PlatformPageQueryDto) {
    return this.operations.listAuditLogs(query);
  }
}
