import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import { CurrentDevice } from '../../device-activation/http/current-device.decorator';
import { DeviceAuthGuard } from '../../device-activation/http/device-auth.guard';
import type { DevicePrincipal } from '../../device-activation/device-activation.types';
import { RealtimeCommunicationApplicationService } from '../realtime.application.service';
import { JoinTicketDto } from './realtime.dto';

@Controller('device/remote-sessions')
@UseGuards(DeviceAuthGuard)
export class DeviceRealtimeController {
  constructor(
    private readonly realtime: RealtimeCommunicationApplicationService,
  ) {}

  @Get('current')
  current(@CurrentDevice() principal: DevicePrincipal) {
    return this.realtime.getCurrentDeviceSession(principal);
  }

  @Post(':sessionId/accept')
  accept(
    @CurrentDevice() principal: DevicePrincipal,
    @Param('sessionId') sessionId: string,
  ) {
    return this.realtime.acceptByDevice(principal, sessionId);
  }

  @Post(':sessionId/decline')
  decline(
    @CurrentDevice() principal: DevicePrincipal,
    @Param('sessionId') sessionId: string,
  ) {
    return this.realtime.declineByDevice(principal, sessionId);
  }

  @Post(':sessionId/end')
  end(
    @CurrentDevice() principal: DevicePrincipal,
    @Param('sessionId') sessionId: string,
  ) {
    return this.realtime.endByDevice(principal, sessionId);
  }

  @Post(':sessionId/join-ticket')
  joinTicket(
    @CurrentDevice() principal: DevicePrincipal,
    @Param('sessionId') sessionId: string,
    @Body() body: JoinTicketDto,
  ) {
    return this.realtime.issueDeviceJoinTicket(
      principal,
      sessionId,
      body.clientType,
    );
  }

  @Post(':sessionId/heartbeat')
  heartbeat(
    @CurrentDevice() principal: DevicePrincipal,
    @Param('sessionId') sessionId: string,
  ) {
    return this.realtime.renewDeviceLease(principal, sessionId);
  }
}
