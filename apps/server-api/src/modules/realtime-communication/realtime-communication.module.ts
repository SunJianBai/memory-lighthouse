import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { RateLimitModule } from '../../infrastructure/rate-limit/rate-limit.module';
import { DeviceActivationModule } from '../device-activation/device-activation.module';
import { CompanionMediaControlModule } from '../companion-session/companion-media-control.module';
import { HouseholdModule } from '../household/household.module';
import { IdentityModule } from '../identity/identity.module';
import { DeviceRealtimeController } from './http/device-realtime.controller';
import { FamilyRealtimeController } from './http/family-realtime.controller';
import { LiveKitWebhookController } from './http/livekit-webhook.controller';
import { RealtimeMediaSecurityModule } from './realtime-media-security.module';
import { RealtimeCommunicationApplicationService } from './realtime.application.service';
import { RealtimeSessionExpiryRunner } from './realtime-session-expiry.runner';

@Module({
  imports: [
    PrismaModule,
    RateLimitModule,
    CompanionMediaControlModule,
    IdentityModule,
    HouseholdModule,
    DeviceActivationModule,
    RealtimeMediaSecurityModule,
  ],
  controllers: [
    FamilyRealtimeController,
    DeviceRealtimeController,
    LiveKitWebhookController,
  ],
  providers: [
    RealtimeCommunicationApplicationService,
    RealtimeSessionExpiryRunner,
  ],
  exports: [RealtimeCommunicationApplicationService],
})
export class RealtimeCommunicationModule {}
