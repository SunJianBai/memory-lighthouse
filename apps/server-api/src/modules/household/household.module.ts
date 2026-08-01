import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaModule } from '../../infrastructure/database/prisma.module';
import { MailModule } from '../../infrastructure/mail';
import { IdentityModule } from '../identity/identity.module';
import { HouseholdInvitationMailAdapter } from './adapters/household-invitation-mail.adapter';
import { createHouseholdSecurityConfig } from './config/household-security.config';
import { InvitationTokenService } from './crypto/invitation-token.service';
import { HouseholdAccessPolicy } from './domain/household-access.policy';
import { HouseholdApplicationService } from './household.application.service';
import {
  HOUSEHOLD_CLOCK,
  HOUSEHOLD_SECURITY_CONFIG,
  INVITATION_DELIVERY_PORT,
} from './household.constants';
import { CareRecipientsController } from './http/care-recipients.controller';
import { HouseholdInvitationsController } from './http/household-invitations.controller';
import { HouseholdsController } from './http/households.controller';
import { SystemHouseholdClock } from './ports/household-clock.port';

@Module({
  imports: [PrismaModule, MailModule, IdentityModule],
  controllers: [
    HouseholdsController,
    HouseholdInvitationsController,
    CareRecipientsController,
  ],
  providers: [
    {
      provide: HOUSEHOLD_SECURITY_CONFIG,
      inject: [ConfigService],
      useFactory: createHouseholdSecurityConfig,
    },
    SystemHouseholdClock,
    { provide: HOUSEHOLD_CLOCK, useExisting: SystemHouseholdClock },
    HouseholdInvitationMailAdapter,
    {
      provide: INVITATION_DELIVERY_PORT,
      useExisting: HouseholdInvitationMailAdapter,
    },
    InvitationTokenService,
    HouseholdAccessPolicy,
    HouseholdApplicationService,
  ],
  exports: [HouseholdAccessPolicy, HouseholdApplicationService],
})
export class HouseholdModule {}
