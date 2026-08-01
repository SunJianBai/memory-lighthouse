import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  CurrentUser,
  UserAccessGuard,
  type UserPrincipal,
} from '../../identity';
import { DeviceActivationApplicationService } from '../device-activation.application.service';
import type {
  ActivationPresentation,
  CompanionBindingView,
} from '../device-activation.types';
import {
  CancelActivationDto,
  RevokeCompanionBindingDto,
  UpdateCompanionBindingDto,
} from './device-activation.dto';

@Controller()
@UseGuards(UserAccessGuard)
export class FamilyDeviceActivationController {
  constructor(
    private readonly deviceActivation: DeviceActivationApplicationService,
  ) {}

  @Post(
    'households/:householdId/care-recipients/:recipientId/activation-challenges',
  )
  async createChallenge(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('recipientId') recipientId: string,
  ): Promise<ActivationPresentation> {
    return this.deviceActivation.createActivationChallenge({
      userId: principal.userId,
      householdId,
      recipientId,
    });
  }

  @Post('activation-challenges/:challengeId/approve')
  @HttpCode(HttpStatus.OK)
  async approve(
    @CurrentUser() principal: UserPrincipal,
    @Param('challengeId') challengeId: string,
  ): Promise<{ approved: true; approvedAt: string }> {
    return this.deviceActivation.approveActivation({
      userId: principal.userId,
      challengeId,
    });
  }

  @Post('activation-challenges/:challengeId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentUser() principal: UserPrincipal,
    @Param('challengeId') challengeId: string,
    @Body() input: CancelActivationDto,
  ): Promise<{ cancelled: true }> {
    return this.deviceActivation.cancelActivation({
      userId: principal.userId,
      challengeId,
      reasonCode: input.reasonCode,
    });
  }

  @Get('households/:householdId/companion-bindings')
  async listBindings(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
  ): Promise<CompanionBindingView[]> {
    return this.deviceActivation.listCompanionBindings(
      principal.userId,
      householdId,
    );
  }

  @Patch('households/:householdId/companion-bindings/:bindingId')
  async updateBinding(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('bindingId') bindingId: string,
    @Body() input: UpdateCompanionBindingDto,
  ): Promise<CompanionBindingView> {
    if (input.displayName === undefined && input.status === undefined) {
      throw new BadRequestException({
        code: 'DEVICE_BINDING_UPDATE_EMPTY',
        message: '至少需要修改设备名称或状态',
      });
    }
    return this.deviceActivation.updateCompanionBinding({
      userId: principal.userId,
      householdId,
      bindingId,
      ...input,
    });
  }

  @Delete('households/:householdId/companion-bindings/:bindingId')
  @HttpCode(HttpStatus.OK)
  async revokeBinding(
    @CurrentUser() principal: UserPrincipal,
    @Param('householdId') householdId: string,
    @Param('bindingId') bindingId: string,
    @Body() input: RevokeCompanionBindingDto,
  ): Promise<{ revoked: true }> {
    return this.deviceActivation.revokeCompanionBinding({
      userId: principal.userId,
      householdId,
      bindingId,
      reasonCode: input.reasonCode,
    });
  }
}
