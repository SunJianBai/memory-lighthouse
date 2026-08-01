import { createHmac, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';

import { HOUSEHOLD_SECURITY_CONFIG } from '../household.constants';
import type { HouseholdSecurityConfig } from '../config/household-security.config';

@Injectable()
export class InvitationTokenService {
  constructor(
    @Inject(HOUSEHOLD_SECURITY_CONFIG)
    private readonly config: HouseholdSecurityConfig,
  ) {}

  issue(): { rawToken: string; tokenHash: Uint8Array<ArrayBuffer> } {
    const rawToken = randomBytes(32).toString('base64url');
    return { rawToken, tokenHash: this.hash(rawToken) };
  }

  hash(rawToken: string): Uint8Array<ArrayBuffer> {
    const digest = createHmac('sha256', this.config.invitationTokenPepper)
      .update(rawToken, 'utf8')
      .digest();
    return Uint8Array.from(digest);
  }
}
