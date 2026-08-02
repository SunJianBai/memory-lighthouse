import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { CompanionMediaControlModule } from '../companion-session/companion-media-control.module';
import { LiveKitServerAdapter } from './adapters/livekit-server.adapter';
import { RedisMediaLeaseAdapter } from './adapters/redis-media-lease.adapter';
import { LIVEKIT_PORT, MEDIA_LEASE_PORT } from './realtime.constants';
import { RemoteMediaSecurityCoordinator } from './remote-media-security.coordinator';

@Module({
  imports: [PrismaModule, CompanionMediaControlModule],
  providers: [
    RedisMediaLeaseAdapter,
    { provide: MEDIA_LEASE_PORT, useExisting: RedisMediaLeaseAdapter },
    LiveKitServerAdapter,
    { provide: LIVEKIT_PORT, useExisting: LiveKitServerAdapter },
    RemoteMediaSecurityCoordinator,
  ],
  exports: [MEDIA_LEASE_PORT, LIVEKIT_PORT, RemoteMediaSecurityCoordinator],
})
export class RealtimeMediaSecurityModule {}
