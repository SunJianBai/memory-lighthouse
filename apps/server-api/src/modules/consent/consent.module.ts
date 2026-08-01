import { Module } from '@nestjs/common';

import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { HouseholdModule } from '../household/household.module';
import { IdentityModule } from '../identity';
import { HouseholdConsentAccessAdapter } from './adapters/household-consent-access.adapter';
import { ConsentApplicationService } from './consent.application.service';
import { CONSENT_ACCESS_PORT } from './consent.constants';
import { ConsentController } from './http/consent.controller';

@Module({
  imports: [PrismaModule, IdentityModule, HouseholdModule],
  controllers: [ConsentController],
  providers: [
    HouseholdConsentAccessAdapter,
    {
      provide: CONSENT_ACCESS_PORT,
      useExisting: HouseholdConsentAccessAdapter,
    },
    ConsentApplicationService,
  ],
  exports: [ConsentApplicationService],
})
export class ConsentModule {}
