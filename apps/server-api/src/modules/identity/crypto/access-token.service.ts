import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import type { IdentitySecurityConfig } from '../config/identity-security.config';
import {
  IDENTITY_CLOCK,
  IDENTITY_SECURITY_CONFIG,
} from '../identity.constants';
import type { Clock } from '../ports/clock.port';
import { newUlid } from '../domain/ulid';

interface UserAccessClaims {
  aud: string;
  env: string;
  exp: number;
  iat: number;
  iss: string;
  jti: string;
  sid: string;
  sub: string;
}

export interface VerifiedAccessClaims {
  userId: string;
  sessionId: string;
  tokenId: string;
  expiresAt: Date;
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function decodeCanonicalBase64Url(value: string): Buffer | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }

  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value ? decoded : null;
}

function isClaims(value: unknown): value is UserAccessClaims {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const claims = value as Record<string, unknown>;
  return (
    typeof claims.aud === 'string' &&
    typeof claims.env === 'string' &&
    typeof claims.exp === 'number' &&
    typeof claims.iat === 'number' &&
    typeof claims.iss === 'string' &&
    typeof claims.jti === 'string' &&
    typeof claims.sid === 'string' &&
    typeof claims.sub === 'string'
  );
}

@Injectable()
export class AccessTokenService {
  constructor(
    @Inject(IDENTITY_SECURITY_CONFIG)
    private readonly config: IdentitySecurityConfig,
    @Inject(IDENTITY_CLOCK) private readonly clock: Clock,
  ) {}

  issue(
    userId: string,
    sessionId: string,
  ): {
    token: string;
    tokenId: string;
    expiresAt: Date;
  } {
    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    const expiresAtSeconds = nowSeconds + this.config.accessTokenTtlSeconds;
    const tokenId = newUlid(nowSeconds * 1000);
    const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
    const claims = encodeJson({
      aud: this.config.accessTokenAudience,
      env: this.config.environment,
      exp: expiresAtSeconds,
      iat: nowSeconds,
      iss: this.config.accessTokenIssuer,
      jti: tokenId,
      sid: sessionId,
      sub: userId,
    } satisfies UserAccessClaims);
    const signingInput = `${header}.${claims}`;
    const signature = this.sign(signingInput).toString('base64url');

    return {
      token: `${signingInput}.${signature}`,
      tokenId,
      expiresAt: new Date(expiresAtSeconds * 1000),
    };
  }

  verify(token: string): VerifiedAccessClaims | null {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const [headerPart, claimsPart, signaturePart] = parts;

    try {
      const headerBytes = decodeCanonicalBase64Url(headerPart);
      const claimsBytes = decodeCanonicalBase64Url(claimsPart);
      const suppliedSignature = decodeCanonicalBase64Url(signaturePart);
      if (!headerBytes || !claimsBytes || !suppliedSignature) {
        return null;
      }

      const header = JSON.parse(headerBytes.toString('utf8')) as Record<
        string,
        unknown
      >;
      if (header.alg !== 'HS256' || header.typ !== 'JWT') {
        return null;
      }

      const expectedSignature = this.sign(`${headerPart}.${claimsPart}`);
      if (
        suppliedSignature.length !== expectedSignature.length ||
        !timingSafeEqual(suppliedSignature, expectedSignature)
      ) {
        return null;
      }

      const claims: unknown = JSON.parse(claimsBytes.toString('utf8'));
      if (!isClaims(claims)) {
        return null;
      }

      const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
      if (
        claims.iss !== this.config.accessTokenIssuer ||
        claims.aud !== this.config.accessTokenAudience ||
        claims.env !== this.config.environment ||
        claims.exp <= nowSeconds ||
        claims.iat > nowSeconds + 30
      ) {
        return null;
      }

      return {
        userId: claims.sub,
        sessionId: claims.sid,
        tokenId: claims.jti,
        expiresAt: new Date(claims.exp * 1000),
      };
    } catch {
      return null;
    }
  }

  private sign(input: string): Buffer {
    return createHmac('sha256', this.config.accessTokenSecret)
      .update(input, 'utf8')
      .digest();
  }
}
