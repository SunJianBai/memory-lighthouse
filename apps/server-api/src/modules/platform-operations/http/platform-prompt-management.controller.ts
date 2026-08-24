import {
  Body,
  Controller,
  Get,
  Header,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import type { RequestWithContext } from '../../../common/http/request-context';
import { AdminAccessGuard } from '../../identity/http/admin-access.guard';
import { PlatformAuditIpHasher } from '../platform-audit-ip-hasher';
import { PlatformPromptManagementApplicationService } from '../platform-prompt-management.application.service';
import type {
  PlatformPrincipal,
  PlatformRequestMetadata,
} from '../platform-operations.types';
import { CurrentPlatformPrincipal } from './current-platform-principal.decorator';
import { PublishCompanionPromptDto } from './platform-operations.dto';
import { RequirePlatformRoles } from './platform-role.decorator';
import { PlatformRoleGuard } from './platform-role.guard';

@Controller('admin/prompts')
@UseGuards(AdminAccessGuard, PlatformRoleGuard)
@RequirePlatformRoles('ADMIN')
export class PlatformPromptManagementController {
  constructor(
    private readonly prompts: PlatformPromptManagementApplicationService,
    private readonly ipHasher: PlatformAuditIpHasher,
  ) {}

  @Get('current')
  @Header('Cache-Control', 'no-store, max-age=0')
  @Header('Pragma', 'no-cache')
  current() {
    return this.prompts.getCurrentCompanionPrompt();
  }

  @Post('revisions')
  publishRevision(
    @CurrentPlatformPrincipal() principal: PlatformPrincipal,
    @Body() body: PublishCompanionPromptDto,
    @Req() request: RequestWithContext,
  ) {
    return this.prompts.publishCompanionPrompt({
      principal,
      expectedCurrentPromptId: body.expectedCurrentPromptId,
      content: body.content,
      reason: body.reason,
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
