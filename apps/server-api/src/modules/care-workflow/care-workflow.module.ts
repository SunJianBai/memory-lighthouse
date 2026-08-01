import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { DeviceActivationModule } from '../device-activation/device-activation.module';
import { HouseholdModule } from '../household/household.module';
import { IdentityModule } from '../identity/identity.module';
import { AesGcmContentCipherAdapter } from './adapters/aes-gcm-content-cipher.adapter';
import { CareWorkflowSchedulerRunner } from './care-workflow-scheduler.runner';
import { CareWorkflowApplicationService } from './care-workflow.application.service';
import {
  CARE_WORKFLOW_CLOCK,
  CARE_WORKFLOW_CONTENT_CIPHER,
  OCCURRENCE_SCHEDULER,
} from './care-workflow.constants';
import { FamilyTasksController } from './http/family-tasks.controller';
import { DeviceOccurrencesController } from './http/device-occurrences.controller';
import { OccurrencesController } from './http/occurrences.controller';
import { RoutinesController } from './http/routines.controller';
import { PrismaOccurrenceScheduler } from './occurrence-scheduler.application';
import { SystemCareWorkflowClock } from './ports/care-workflow-clock.port';

@Module({
  imports: [
    PrismaModule,
    DeviceActivationModule,
    IdentityModule,
    HouseholdModule,
  ],
  controllers: [
    RoutinesController,
    OccurrencesController,
    DeviceOccurrencesController,
    FamilyTasksController,
  ],
  providers: [
    SystemCareWorkflowClock,
    { provide: CARE_WORKFLOW_CLOCK, useExisting: SystemCareWorkflowClock },
    AesGcmContentCipherAdapter,
    {
      provide: CARE_WORKFLOW_CONTENT_CIPHER,
      useExisting: AesGcmContentCipherAdapter,
    },
    CareWorkflowApplicationService,
    PrismaOccurrenceScheduler,
    { provide: OCCURRENCE_SCHEDULER, useExisting: PrismaOccurrenceScheduler },
    CareWorkflowSchedulerRunner,
  ],
  exports: [
    CareWorkflowApplicationService,
    CARE_WORKFLOW_CONTENT_CIPHER,
    OCCURRENCE_SCHEDULER,
  ],
})
export class CareWorkflowModule {}
