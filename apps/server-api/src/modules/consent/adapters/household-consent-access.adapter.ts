import { Injectable } from '@nestjs/common';

import { HouseholdAccessPolicy } from '../../household/domain/household-access.policy';
import type {
  ConsentAccessDataClient,
  ConsentAccessPort,
  ConsentActor,
} from '../ports/consent-access.port';

/**
 * Adapter from Consent capabilities to the Household policy Interface.
 *
 * Consent changes are intentionally separate from editing recipient profile
 * data because they control camera, microphone, model and transcript access.
 */
@Injectable()
export class HouseholdConsentAccessAdapter implements ConsentAccessPort {
  constructor(private readonly householdAccess: HouseholdAccessPolicy) {}

  async requireCanReadConsent(
    client: ConsentAccessDataClient,
    userId: string,
    householdId: string,
    recipientId: string,
  ): Promise<ConsentActor> {
    const member = await this.householdAccess.requireRecipientAction(
      client,
      userId,
      householdId,
      recipientId,
      'VIEW_RECIPIENT',
    );
    return { memberId: member.id };
  }

  async requireCanManageConsent(
    client: ConsentAccessDataClient,
    userId: string,
    householdId: string,
    recipientId: string,
  ): Promise<ConsentActor> {
    const member = await this.householdAccess.requireRecipientAction(
      client,
      userId,
      householdId,
      recipientId,
      'MANAGE_CONSENT',
    );
    return { memberId: member.id };
  }
}
