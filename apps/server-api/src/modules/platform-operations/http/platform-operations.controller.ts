import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import type { RequestWithContext } from '../../../common/http/request-context';
import { IdentityApplicationService } from '../../identity/identity.application.service';
import { UserAccessGuard } from '../../identity/http/user-access.guard';
import { capabilitiesForPlatformRoles } from '../platform-capabilities';
import { PlatformOperationsApplicationService } from '../platform-operations.application.service';
import type {
  PlatformIdentityView,
  PlatformPrincipal,
  PlatformRequestMetadata,
} from '../platform-operations.types';
import { CurrentPlatformPrincipal } from './current-platform-principal.decorator';
import {
  InspectionGrantPageQueryDto,
  InspectionQueryDto,
  MemoryInspectionQueryDto,
  PlatformPageQueryDto,
  RequestInspectionGrantDto,
} from './platform-operations.dto';
import { RequirePlatformRoles } from './platform-role.decorator';
import { PlatformRoleGuard } from './platform-role.guard';

@Controller('admin')
@UseGuards(UserAccessGuard, PlatformRoleGuard)
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

  @Get('inspection-grants')
  listInspectionGrants(@Query() query: InspectionGrantPageQueryDto) {
    return this.operations.listInspectionGrants(query);
  }

  @Post('inspection-grants')
  @RequirePlatformRoles('CONTENT_AUDITOR')
  requestInspectionGrant(
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Body() body: RequestInspectionGrantDto,
    @Req() request: RequestWithContext,
  ) {
    return this.operations.requestInspectionGrant({
      principal,
      householdId: body.householdId,
      recipientId: body.recipientId,
      dataCategories: body.dataCategories,
      reason: body.reason,
      ticketReference: body.ticketReference,
      expiresInSeconds: body.expiresInSeconds,
      request: this.requestMetadata(request),
    });
  }

  @Post('inspection-grants/:grantId/approve')
  @RequirePlatformRoles('ADMIN')
  approveInspectionGrant(
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Param('grantId') grantId: string,
    @Req() request: RequestWithContext,
  ) {
    return this.operations.approveInspectionGrant({
      principal,
      grantId,
      request: this.requestMetadata(request),
    });
  }

  @Post('inspection-grants/:grantId/revoke')
  revokeInspectionGrant(
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Param('grantId') grantId: string,
    @Req() request: RequestWithContext,
  ) {
    return this.operations.revokeInspectionGrant({
      principal,
      grantId,
      request: this.requestMetadata(request),
    });
  }

  @Get('inspections/memories/:memoryId')
  @RequirePlatformRoles('CONTENT_AUDITOR')
  @Header('Cache-Control', 'no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  inspectCurrentMemoryRevision(
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Param('memoryId') memoryId: string,
    @Query() query: MemoryInspectionQueryDto,
    @Req() request: RequestWithContext,
  ) {
    return this.operations.inspectMemoryRevision({
      principal,
      grantId: query.grantId,
      memoryId,
      revisionId: query.revisionId,
      request: this.requestMetadata(request),
    });
  }

  @Get('inspections/memories/:memoryId/revisions/:revisionId')
  @RequirePlatformRoles('CONTENT_AUDITOR')
  @Header('Cache-Control', 'no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  inspectMemoryRevision(
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Param('memoryId') memoryId: string,
    @Param('revisionId') revisionId: string,
    @Query() query: InspectionQueryDto,
    @Req() request: RequestWithContext,
  ) {
    return this.operations.inspectMemoryRevision({
      principal,
      grantId: query.grantId,
      memoryId,
      revisionId,
      request: this.requestMetadata(request),
    });
  }

  @Get('inspections/utterances/:utteranceId')
  @RequirePlatformRoles('CONTENT_AUDITOR')
  @Header('Cache-Control', 'no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  @Header('Expires', '0')
  inspectUtterance(
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Param('utteranceId') utteranceId: string,
    @Query() query: InspectionQueryDto,
    @Req() request: RequestWithContext,
  ) {
    return this.operations.inspectUtterance({
      principal,
      grantId: query.grantId,
      utteranceId,
      request: this.requestMetadata(request),
    });
  }

  private requestMetadata(
    request: RequestWithContext,
  ): PlatformRequestMetadata {
    const userAgent = request.headers['user-agent'];
    return {
      requestId: request.requestId,
      ...(typeof userAgent === 'string' ? { userAgent } : {}),
    };
  }
}
