import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';

import type { DevicePrincipal } from '../../device-activation/device-activation.types';
import { CurrentDevice } from '../../device-activation/http/current-device.decorator';
import { DeviceAuthGuard } from '../../device-activation/http/device-auth.guard';
import { CareWorkflowApplicationService } from '../care-workflow.application.service';
import type {
  FamilyContactRequestView,
  OccurrenceView,
} from '../care-workflow.types';
import {
  DeviceConfirmOccurrenceDto,
  DeviceFamilyContactRequestDto,
} from './care-workflow.dto';
import { requireMatchingIdempotencyKey } from './idempotency-key';

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
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: DeviceConfirmOccurrenceDto,
  ): Promise<OccurrenceView> {
    return this.workflow.confirmOccurrenceByDevice(principal, occurrenceId, {
      ...body,
      idempotencyKey: requireMatchingIdempotencyKey(
        idempotencyKey,
        body.idempotencyKey,
      ),
    });
  }

  @Post('family-contact-requests')
  @HttpCode(HttpStatus.ACCEPTED)
  requestFamilyContact(
    @CurrentDevice() principal: DevicePrincipal,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: DeviceFamilyContactRequestDto,
  ): Promise<FamilyContactRequestView> {
    return this.workflow.requestFamilyContactByDevice(principal, {
      ...body,
      idempotencyKey: requireMatchingIdempotencyKey(
        idempotencyKey,
        body.idempotencyKey,
      ),
    });
  }
}
