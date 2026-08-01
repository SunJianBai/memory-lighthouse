import { createHmac, randomBytes } from 'node:crypto';

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

  hashRefreshToken(rawToken: string): Uint8Array<ArrayBuffer> {
    return this.hash(this.config.refreshTokenPepper, 'refresh', rawToken);
  }

  hashOneTimeToken(rawToken: string): Uint8Array<ArrayBuffer> {
    return this.hash(this.config.oneTimeTokenPepper, 'one-time', rawToken);
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
