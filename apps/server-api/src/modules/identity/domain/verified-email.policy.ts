import { Injectable } from '@nestjs/common';

import type { Prisma } from '../../../infrastructure/database/generated/prisma/client';
import { EmailVerificationRequiredException } from '../identity.errors';

type VerifiedEmailDataClient = Pick<Prisma.TransactionClient, 'loginIdentity'>;

/**
 * Central policy for account actions that require a verified email address.
 *
 * The caller supplies the data client so the check can participate in an
 * existing transaction when a use case needs a stronger consistency boundary.
 */
@Injectable()
export class VerifiedEmailPolicy {
  async requireVerifiedEmail(
    client: VerifiedEmailDataClient,
    userId: string,
  ): Promise<void> {
    const identity = await client.loginIdentity.findFirst({
      where: {
        userId,
        type: 'EMAIL',
        verifiedAt: { not: null },
      },
      select: { id: true },
    });

    if (!identity) {
      throw new EmailVerificationRequiredException();
    }
  }
}
