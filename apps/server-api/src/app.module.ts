import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config/environment';
import { HealthModule } from './health/health.module';
import { ConsentModule } from './modules/consent/consent.module';
import { CareWorkflowModule } from './modules/care-workflow/care-workflow.module';
import { CompanionSessionModule } from './modules/companion-session/companion-session.module';
import { DeviceActivationModule } from './modules/device-activation/device-activation.module';
import { HouseholdModule } from './modules/household/household.module';
import { IdentityModule } from './modules/identity/identity.module';
import { MemoryModule } from './modules/memory/memory.module';
import { NotificationModule } from './modules/notification';
import { PlatformOperationsModule } from './modules/platform-operations/platform-operations.module';
import { RealtimeCommunicationModule } from './modules/realtime-communication/realtime-communication.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      isGlobal: true,
      validate: validateEnvironment,
    }),
    HealthModule,
    IdentityModule,
    HouseholdModule,
    DeviceActivationModule,
    ConsentModule,
    MemoryModule,
    NotificationModule,
    CareWorkflowModule,
    CompanionSessionModule,
    RealtimeCommunicationModule,
    PlatformOperationsModule.register(process.env.NODE_ENV),
  ],
})
export class AppModule {}
