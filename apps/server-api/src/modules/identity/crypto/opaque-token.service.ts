import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { IDENTITY_SECURITY_CONFIG } from '../identity.constants';
import type { IdentitySecurityConfig } from '../config/identity-security.config';

@Injectable()
export class OpaqueTokenService {
  constructor(
    @Inject(IDENTITY_SECURITY_CONFIG)
    private readonly config: IdentitySecurityConfig,
  ) {}

  generate(): string {
    return randomBytes(32).toString('base64url');
  }

  generateEmailVerificationCode(): string {
    return randomInt(0, 1_000_000).toString().padStart(6, '0');
  }

  hashRefreshToken(rawToken: string): Uint8Array<ArrayBuffer> {
    return this.hash(this.config.refreshTokenPepper, 'refresh', rawToken);
  }

  hashOneTimeToken(rawToken: string): Uint8Array<ArrayBuffer> {
    return this.hash(this.config.oneTimeTokenPepper, 'one-time', rawToken);
  }

  hashEmailVerificationCode(
    identityId: string,
    challengeId: string,
    code: string,
  ): Uint8Array<ArrayBuffer> {
    return this.hash(
      this.config.oneTimeTokenPepper,
      'email-verification-code',
      `${identityId}\0${challengeId}\0${code}`,
    );
  }

  matchesEmailVerificationCode(
    identityId: string,
    challengeId: string,
    code: string,
    expectedHash: Uint8Array,
  ): boolean {
    const actual = Buffer.from(
      this.hashEmailVerificationCode(identityId, challengeId, code),
    );
    const expected = Buffer.from(expectedHash);
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  hashIpAddress(ipAddress: string | undefined): Uint8Array<ArrayBuffer> | null {
    if (!ipAddress) {
      return null;
    }

    return this.hash(this.config.refreshTokenPepper, 'ip-address', ipAddress);
  }

  private hash(
    pepper: Buffer,
    domain: string,
    value: string,
  ): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(
      createHmac('sha256', pepper)
        .update(domain, 'utf8')
        .update('\0', 'utf8')
        .update(value, 'utf8')
        .digest(),
    );
  }
}
