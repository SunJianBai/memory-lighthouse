import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { DeviceActivationModule } from '../device-activation/device-activation.module';
import { HouseholdModule } from '../household/household.module';
import { IdentityModule } from '../identity/identity.module';
import { LiveKitServerAdapter } from './adapters/livekit-server.adapter';
import { RedisMediaLeaseAdapter } from './adapters/redis-media-lease.adapter';
import { DeviceRealtimeController } from './http/device-realtime.controller';
import { FamilyRealtimeController } from './http/family-realtime.controller';
import { LiveKitWebhookController } from './http/livekit-webhook.controller';
import { LIVEKIT_PORT, MEDIA_LEASE_PORT } from './realtime.constants';
import { RealtimeCommunicationApplicationService } from './realtime.application.service';
import { RealtimeSessionExpiryRunner } from './realtime-session-expiry.runner';

@Module({
  imports: [
    PrismaModule,
    IdentityModule,
    HouseholdModule,
    DeviceActivationModule,
  ],
  controllers: [
    FamilyRealtimeController,
    DeviceRealtimeController,
    LiveKitWebhookController,
  ],
  providers: [
    RedisMediaLeaseAdapter,
    { provide: MEDIA_LEASE_PORT, useExisting: RedisMediaLeaseAdapter },
    LiveKitServerAdapter,
    { provide: LIVEKIT_PORT, useExisting: LiveKitServerAdapter },
    RealtimeCommunicationApplicationService,
    RealtimeSessionExpiryRunner,
  ],
  exports: [RealtimeCommunicationApplicationService, MEDIA_LEASE_PORT],
})
export class RealtimeCommunicationModule {}
