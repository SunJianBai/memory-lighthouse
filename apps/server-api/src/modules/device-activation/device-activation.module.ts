import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { RateLimitModule } from '../../infrastructure/rate-limit';
import { IdentityModule } from '../identity';
import { DeviceActivationApplicationService } from './device-activation.application.service';
import { DeviceAccessTokenService } from './device-access-token.service';
import { createDeviceActivationSecurityConfig } from './device-activation.config';
import {
  DEVICE_ACTIVATION_CLOCK,
  DEVICE_ACTIVATION_SECURITY_CONFIG,
} from './device-activation.constants';
import { DeviceActivationCrypto } from './device-activation.crypto';
import { FamilyDeviceActivationController } from './http/family-device-activation.controller';
import { DeviceAuthGuard } from './http/device-auth.guard';
import { PublicDeviceActivationController } from './http/public-device-activation.controller';
import { SystemClock } from './system-clock';

@Module({
  imports: [PrismaModule, IdentityModule, RateLimitModule],
  controllers: [
    PublicDeviceActivationController,
    FamilyDeviceActivationController,
  ],
  providers: [
    {
      provide: DEVICE_ACTIVATION_SECURITY_CONFIG,
      inject: [ConfigService],
      useFactory: createDeviceActivationSecurityConfig,
    },
    SystemClock,
    { provide: DEVICE_ACTIVATION_CLOCK, useExisting: SystemClock },
    DeviceActivationCrypto,
    DeviceAccessTokenService,
    DeviceActivationApplicationService,
    DeviceAuthGuard,
  ],
  exports: [
    DeviceActivationApplicationService,
    DeviceActivationCrypto,
    DeviceAccessTokenService,
    DeviceAuthGuard,
  ],
})
export class DeviceActivationModule {}
