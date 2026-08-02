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
import { AdminAccessGuard } from '../../identity/http/admin-access.guard';
import { PlatformAuditIpHasher } from '../platform-audit-ip-hasher';
import { PlatformOperationsApplicationService } from '../platform-operations.application.service';
import type {
  PlatformPrincipal,
  PlatformRequestMetadata,
} from '../platform-operations.types';
import { CurrentPlatformPrincipal } from './current-platform-principal.decorator';
import {
  InspectionGrantPageQueryDto,
  InspectionQueryDto,
  MemoryInspectionQueryDto,
  RequestInspectionGrantDto,
} from './platform-operations.dto';
import { RequirePlatformRoles } from './platform-role.decorator';
import { PlatformRoleGuard } from './platform-role.guard';

@Controller('admin')
@UseGuards(AdminAccessGuard, PlatformRoleGuard)
@RequirePlatformRoles('ADMIN', 'CONTENT_AUDITOR')
export class DevelopmentContentInspectionController {
  constructor(
    private readonly operations: PlatformOperationsApplicationService,
    private readonly ipHasher: PlatformAuditIpHasher,
  ) {}

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
      sourceIpHash: this.ipHasher.hash(request.ip),
      ...(typeof userAgent === 'string' ? { userAgent } : {}),
    };
  }
}
