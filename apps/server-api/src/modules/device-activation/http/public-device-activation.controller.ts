import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';

import {
  RateLimited,
  RateLimitPolicy,
} from '../../../infrastructure/rate-limit';
import { DeviceActivationApplicationService } from '../device-activation.application.service';
import type {
  DeviceCredentialPresentation,
  DeviceInstallationView,
  PublicActivationStatus,
} from '../device-activation.types';
import {
  ClaimActivationChallengeDto,
  ExchangeDeviceCredentialDto,
  RefreshDeviceCredentialDto,
  RegisterDeviceInstallationDto,
} from './device-activation.dto';

@Controller()
export class PublicDeviceActivationController {
  constructor(
    private readonly deviceActivation: DeviceActivationApplicationService,
  ) {}

  @Post('device-installations')
  @RateLimited(RateLimitPolicy.DEVICE_INSTALLATION_REGISTER)
  async registerInstallation(
    @Body() input: RegisterDeviceInstallationDto,
  ): Promise<DeviceInstallationView> {
    return this.deviceActivation.registerInstallation(input);
  }

  @Get('activation-challenges/:challengeId')
  @RateLimited(RateLimitPolicy.DEVICE_ACTIVATION_STATUS)
  async getStatus(
    @Param('challengeId') challengeId: string,
  ): Promise<PublicActivationStatus> {
    return this.deviceActivation.getPublicActivationStatus(challengeId);
  }

  @Post('activation-challenges/:publicId/claim')
  @RateLimited(RateLimitPolicy.DEVICE_ACTIVATION_CLAIM)
  @HttpCode(HttpStatus.OK)
  async claim(
    @Param('publicId') publicId: string,
    @Body() input: ClaimActivationChallengeDto,
    @Req() request: Request,
  ): Promise<{ claimed: true; challengeId: string }> {
    return this.deviceActivation.claimActivationChallenge({
      publicId,
      ipAddress: request.ip,
      ...input,
    });
  }

  @Post('device-credentials/exchange')
  @RateLimited(RateLimitPolicy.DEVICE_CREDENTIAL_EXCHANGE)
  @HttpCode(HttpStatus.OK)
  async exchange(
    @Body() input: ExchangeDeviceCredentialDto,
  ): Promise<DeviceCredentialPresentation> {
    return this.deviceActivation.exchangeDeviceCredential(input);
  }

  @Post('device-auth/refresh')
  @RateLimited(RateLimitPolicy.DEVICE_CREDENTIAL_REFRESH)
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Body() input: RefreshDeviceCredentialDto,
  ): Promise<DeviceCredentialPresentation> {
    return this.deviceActivation.rotateDeviceCredential(
      input.credential,
      input.signature,
    );
  }
}
