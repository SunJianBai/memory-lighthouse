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
  purpose: 'USER' | 'ADMIN_WEB';
  sid: string;
  sub: string;
}

export interface VerifiedAccessClaims {
  userId: string;
  sessionId: string;
  tokenId: string;
  expiresAt: Date;
}

interface AccessTokenProfile {
  audience: string;
  issuer: string;
  purpose: 'USER' | 'ADMIN_WEB';
  secret: Buffer;
  ttlSeconds: number;
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
    (claims.purpose === 'USER' || claims.purpose === 'ADMIN_WEB') &&
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

  issueUser(
    userId: string,
    sessionId: string,
  ): {
    token: string;
    tokenId: string;
    expiresAt: Date;
  } {
    return this.issue(userId, sessionId, this.userProfile());
  }

  issueAdmin(
    userId: string,
    sessionId: string,
  ): {
    token: string;
    tokenId: string;
    expiresAt: Date;
  } {
    return this.issue(userId, sessionId, this.adminProfile());
  }

  verifyUser(token: string): VerifiedAccessClaims | null {
    return this.verify(token, this.userProfile());
  }

  verifyAdmin(token: string): VerifiedAccessClaims | null {
    return this.verify(token, this.adminProfile());
  }

  private issue(
    userId: string,
    sessionId: string,
    profile: AccessTokenProfile,
  ): {
    token: string;
    tokenId: string;
    expiresAt: Date;
  } {
    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    const expiresAtSeconds = nowSeconds + profile.ttlSeconds;
    const tokenId = newUlid(nowSeconds * 1000);
    const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
    const claims = encodeJson({
      aud: profile.audience,
      env: this.config.environment,
      exp: expiresAtSeconds,
      iat: nowSeconds,
      iss: profile.issuer,
      jti: tokenId,
      purpose: profile.purpose,
      sid: sessionId,
      sub: userId,
    } satisfies UserAccessClaims);
    const signingInput = `${header}.${claims}`;
    const signature = this.sign(signingInput, profile.secret).toString(
      'base64url',
    );

    return {
      token: `${signingInput}.${signature}`,
      tokenId,
      expiresAt: new Date(expiresAtSeconds * 1000),
    };
  }

  private verify(
    token: string,
    profile: AccessTokenProfile,
  ): VerifiedAccessClaims | null {
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

      const expectedSignature = this.sign(
        `${headerPart}.${claimsPart}`,
        profile.secret,
      );
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
        claims.iss !== profile.issuer ||
        claims.aud !== profile.audience ||
        claims.purpose !== profile.purpose ||
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

  private userProfile(): AccessTokenProfile {
    return {
      audience: this.config.accessTokenAudience,
      issuer: this.config.accessTokenIssuer,
      purpose: 'USER',
      secret: this.config.accessTokenSecret,
      ttlSeconds: this.config.accessTokenTtlSeconds,
    };
  }

  private adminProfile(): AccessTokenProfile {
    return {
      audience: this.config.adminAccessTokenAudience,
      issuer: this.config.adminAccessTokenIssuer,
      purpose: 'ADMIN_WEB',
      secret: this.config.adminAccessTokenSecret,
      ttlSeconds: this.config.adminAccessTokenTtlSeconds,
    };
  }

  private sign(input: string, secret: Buffer): Buffer {
    return createHmac('sha256', secret).update(input, 'utf8').digest();
  }
}
