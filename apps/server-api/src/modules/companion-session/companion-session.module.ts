import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { CareWorkflowModule } from '../care-workflow/care-workflow.module';
import { DeviceActivationModule } from '../device-activation/device-activation.module';
import { MemoryModule } from '../memory/memory.module';
import { RealtimeMediaSecurityModule } from '../realtime-communication/realtime-media-security.module';
import { CompanionSessionApplicationService } from './companion-session.application.service';
import { CompanionMediaControlModule } from './companion-media-control.module';
import { CompanionSessionController } from './http/companion-session.controller';
import { TranscriptRetentionApplicationService } from './transcript-retention.application.service';
import { TranscriptRetentionRunner } from './transcript-retention.runner';

@Module({
  imports: [
    PrismaModule,
    CompanionMediaControlModule,
    CareWorkflowModule,
    DeviceActivationModule,
    MemoryModule,
    RealtimeMediaSecurityModule,
  ],
  controllers: [CompanionSessionController],
  providers: [
    CompanionSessionApplicationService,
    TranscriptRetentionApplicationService,
    TranscriptRetentionRunner,
  ],
  exports: [
    CompanionSessionApplicationService,
    TranscriptRetentionApplicationService,
  ],
})
export class CompanionSessionModule {}
