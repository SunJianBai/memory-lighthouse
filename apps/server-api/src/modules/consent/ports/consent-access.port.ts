import type { Prisma } from '../../../infrastructure/database/generated/prisma/client';

export type ConsentAccessDataClient = Pick<
  Prisma.TransactionClient,
  'householdMember' | 'recipientMember' | 'careRecipient'
>;

export interface ConsentActor {
  memberId: string;
}

/**
 * Authorization Interface owned by the Consent Module.
 *
 * Callers ask about consent capabilities; the Adapter is responsible for
 * translating those capabilities into the current Household policy model.
 */
export interface ConsentAccessPort {
  requireCanReadConsent(
    client: ConsentAccessDataClient,
    userId: string,
    householdId: string,
    recipientId: string,
  ): Promise<ConsentActor>;

  requireCanManageConsent(
    client: ConsentAccessDataClient,
    userId: string,
    householdId: string,
    recipientId: string,
  ): Promise<ConsentActor>;
}
