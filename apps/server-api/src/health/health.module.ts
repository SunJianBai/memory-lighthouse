import { Module } from '@nestjs/common';
import { PrismaModule } from '../infrastructure/database/prisma.module';
import { MailModule } from '../infrastructure/mail';
import { DatabaseReadinessIndicator } from './database-readiness.indicator';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';
import { MailReadinessIndicator } from './mail-readiness.indicator';
import { ProcessReadinessIndicator } from './process-readiness.indicator';
import { READINESS_INDICATORS } from './readiness-indicator';

@Module({
  imports: [PrismaModule, MailModule],
  controllers: [HealthController],
  providers: [
    HealthService,
    ProcessReadinessIndicator,
    DatabaseReadinessIndicator,
    MailReadinessIndicator,
    {
      provide: READINESS_INDICATORS,
      inject: [
        ProcessReadinessIndicator,
        DatabaseReadinessIndicator,
        MailReadinessIndicator,
      ],
      useFactory: (
        processIndicator: ProcessReadinessIndicator,
        databaseIndicator: DatabaseReadinessIndicator,
        mailIndicator: MailReadinessIndicator,
      ): ReadonlyArray<
        | ProcessReadinessIndicator
        | DatabaseReadinessIndicator
        | MailReadinessIndicator
      > => [processIndicator, databaseIndicator, mailIndicator],
    },
  ],
})
export class HealthModule {}
