import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';

import type { RequestWithContext } from '../../../common/http/request-context';
import { CurrentDevice } from '../../device-activation/http/current-device.decorator';
import { DeviceAuthGuard } from '../../device-activation/http/device-auth.guard';
import type { DevicePrincipal } from '../../device-activation/device-activation.types';
import { CompanionSessionApplicationService } from '../companion-session.application.service';
import {
  AppendModelEventDto,
  AppendUtteranceDto,
  DeviceHeartbeatDto,
  EndCompanionSessionDto,
  StartCompanionSessionDto,
} from './companion-session.dto';

@Controller('device')
@UseGuards(DeviceAuthGuard)
export class CompanionSessionController {
  constructor(private readonly companion: CompanionSessionApplicationService) {}

  @Get('context')
  getContext(@CurrentDevice() principal: DevicePrincipal) {
    return this.companion.getDeviceContext(principal);
  }

  @Post('heartbeats')
  heartbeat(
    @CurrentDevice() principal: DevicePrincipal,
    @Body() body: DeviceHeartbeatDto,
  ) {
    return this.companion.recordHeartbeat(principal, body);
  }

  @Post('companion-sessions')
  startCompanionSession(
    @CurrentDevice() principal: DevicePrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() request: RequestWithContext,
    @Body() body: StartCompanionSessionDto,
  ) {
    return this.companion.startCompanionSession({
      principal,
      mode: body.mode,
      idempotencyKey: idempotencyKey ?? '',
      traceId: request.requestId,
    });
  }

  @Post('companion-sessions/:sessionId/model-sessions')
  startModelSession(
    @CurrentDevice() principal: DevicePrincipal,
    @Param('sessionId') companionSessionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
  ) {
    return this.companion.startModelSession({
      principal,
      companionSessionId,
      idempotencyKey: idempotencyKey ?? '',
    });
  }

  @Post('model-sessions/:modelSessionId/utterances')
  appendUtterance(
    @CurrentDevice() principal: DevicePrincipal,
    @Param('modelSessionId') modelSessionId: string,
    @Body() body: AppendUtteranceDto,
  ) {
    return this.companion.appendUtterance({
      principal,
      modelSessionId,
      ...body,
    });
  }

  @Post('model-sessions/:modelSessionId/events')
  appendEvent(
    @CurrentDevice() principal: DevicePrincipal,
    @Param('modelSessionId') modelSessionId: string,
    @Body() body: AppendModelEventDto,
  ) {
    return this.companion.appendModelEvent({
      principal,
      modelSessionId,
      eventType: body.eventType,
      metrics: body.metrics,
      errorCode: body.errorCode,
      occurredAt: body.occurredAt ? new Date(body.occurredAt) : undefined,
    });
  }

  @Post('companion-sessions/:sessionId/end')
  endSession(
    @CurrentDevice() principal: DevicePrincipal,
    @Param('sessionId') sessionId: string,
    @Body() body: EndCompanionSessionDto,
  ) {
    return this.companion.endCompanionSession(
      principal,
      sessionId,
      body.reason,
    );
  }
}
