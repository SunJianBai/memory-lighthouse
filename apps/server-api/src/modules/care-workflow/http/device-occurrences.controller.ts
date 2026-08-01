import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';

import type { DevicePrincipal } from '../../device-activation/device-activation.types';
import { CurrentDevice } from '../../device-activation/http/current-device.decorator';
import { DeviceAuthGuard } from '../../device-activation/http/device-auth.guard';
import { CareWorkflowApplicationService } from '../care-workflow.application.service';
import type { OccurrenceView } from '../care-workflow.types';
import { DeviceConfirmOccurrenceDto } from './care-workflow.dto';

@Controller('device')
@UseGuards(DeviceAuthGuard)
export class DeviceOccurrencesController {
  constructor(private readonly workflow: CareWorkflowApplicationService) {}

  @Get('occurrences/current')
  current(
    @CurrentDevice() principal: DevicePrincipal,
  ): Promise<OccurrenceView[]> {
    return this.workflow.listCurrentOccurrencesForDevice(principal);
  }

  @Post('occurrences/:occurrenceId/confirm')
  confirm(
    @CurrentDevice() principal: DevicePrincipal,
    @Param('occurrenceId') occurrenceId: string,
    @Body() body: DeviceConfirmOccurrenceDto,
  ): Promise<OccurrenceView> {
    return this.workflow.confirmOccurrenceByDevice(
      principal,
      occurrenceId,
      body,
    );
  }
}
