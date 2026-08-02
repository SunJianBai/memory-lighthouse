import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';

import type { RequestWithContext } from '../../../common/http/request-context';
import {
  RateLimited,
  RateLimitPolicy,
} from '../../../infrastructure/rate-limit';
import { CurrentUser } from '../../identity/http/current-user.decorator';
import { UserAccessGuard } from '../../identity/http/user-access.guard';
import type { UserPrincipal } from '../../identity/identity.types';
import { RealtimeCommunicationApplicationService } from '../realtime.application.service';
import {
  CreateRemoteSessionDto,
  JoinTicketDto,
  UpdateRemotePolicyDto,
} from './realtime.dto';

@Controller('households/:householdId')
@UseGuards(UserAccessGuard)
export class FamilyRealtimeController {
  constructor(
    private readonly realtime: RealtimeCommunicationApplicationService,
  ) {}

  @Get('companion-bindings/:bindingId/availability')
  availability(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('bindingId') bindingId: string,
  ) {
    return this.realtime.getAvailability(principal, householdId, bindingId);
  }

  @Get('companion-bindings/:bindingId/remote-access-policy')
  policy(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('bindingId') bindingId: string,
  ) {
    return this.realtime.getRemoteAccessPolicy(
      principal,
      householdId,
      bindingId,
    );
  }

  @Put('companion-bindings/:bindingId/remote-access-policy')
  @RateLimited(RateLimitPolicy.REMOTE_POLICY_UPDATE)
  updatePolicy(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('bindingId') bindingId: string,
    @Body() body: UpdateRemotePolicyDto,
  ) {
    return this.realtime.updateRemoteAccessPolicy({
      principal,
      householdId,
      bindingId,
      ...body,
    });
  }

  @Post('remote-sessions')
  @RateLimited(RateLimitPolicy.REMOTE_SESSION_REQUEST)
  requestSession(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: RequestWithContext,
    @Body() body: CreateRemoteSessionDto,
  ) {
    return this.realtime.requestRemoteSession({
      principal,
      householdId,
      bindingId: body.bindingId,
      media: body.media,
      idempotencyKey: idempotencyKey ?? '',
      traceId: request.requestId,
    });
  }

  @Get('remote-sessions/:sessionId')
  getSession(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.realtime.getFamilySession(principal, householdId, sessionId);
  }

  @Post('remote-sessions/:sessionId/cancel')
  cancel(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.realtime.cancelByFamily(principal, householdId, sessionId);
  }

  @Post('remote-sessions/:sessionId/end')
  end(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('sessionId') sessionId: string,
  ) {
    return this.realtime.endByFamily(principal, householdId, sessionId);
  }

  @Post('remote-sessions/:sessionId/join-ticket')
  joinTicket(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('sessionId') sessionId: string,
    @Body() body: JoinTicketDto,
  ) {
    return this.realtime.issueFamilyJoinTicket(
      principal,
      householdId,
      sessionId,
      body.clientType,
    );
  }
}
