import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ulid } from 'ulid';

import type { DeviceActivationSecurityConfig } from './device-activation.config';
import {
  DEVICE_ACTIVATION_CLOCK,
  DEVICE_ACTIVATION_SECURITY_CONFIG,
} from './device-activation.constants';
import type {
  ClockPort,
  DeviceCapability,
  DevicePrincipal,
} from './device-activation.types';

interface DeviceAccessClaims {
  aud: 'memory-lighthouse-device';
  env: string;
  exp: number;
  iat: number;
  iss: 'memory-lighthouse-server';
  jti: string;
  cid: string;
  cfi: string;
  did: string;
  bid: string;
  hid: string;
  rid: string;
  bv: number;
  cap: DeviceCapability[];
}

export interface DeviceAccessTokenResult {
  accessToken: string;
  accessTokenExpiresAt: string;
  accessTokenExpiresInSeconds: number;
}

type IssueDevicePrincipal = Omit<
  DevicePrincipal,
  'kind' | 'tokenId' | 'capabilities'
> & {
  capabilities?: readonly DeviceCapability[];
};

@Injectable()
export class DeviceAccessTokenService {
  constructor(
    @Inject(DEVICE_ACTIVATION_SECURITY_CONFIG)
    private readonly config: DeviceActivationSecurityConfig,
    @Inject(DEVICE_ACTIVATION_CLOCK) private readonly clock: ClockPort,
  ) {}

  issue(principal: IssueDevicePrincipal): DeviceAccessTokenResult {
    const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
    const expiresAtSeconds = nowSeconds + this.config.accessTokenTtlSeconds;
    const claims: DeviceAccessClaims = {
      aud: 'memory-lighthouse-device',
      env: this.config.environment,
      exp: expiresAtSeconds,
      iat: nowSeconds,
      iss: 'memory-lighthouse-server',
      jti: ulid(nowSeconds * 1000),
      cid: principal.credentialId,
      cfi: principal.credentialFamilyId,
      did: principal.deviceId,
      bid: principal.bindingId,
      hid: principal.householdId,
      rid: principal.recipientId,
      bv: principal.bindingVersion,
      cap: [...(principal.capabilities ?? ['COMPANION', 'REMOTE_ASSISTANCE'])],
    };
    const header = encodeJson({ alg: 'HS256', typ: 'JWT' });
    const payload = encodeJson(claims);
    const signingInput = `${header}.${payload}`;
    const signature = this.sign(signingInput).toString('base64url');
    return {
      accessToken: `${signingInput}.${signature}`,
      accessTokenExpiresAt: new Date(expiresAtSeconds * 1000).toISOString(),
      accessTokenExpiresInSeconds: this.config.accessTokenTtlSeconds,
    };
  }

  verify(token: string): DevicePrincipal | null {
    if (token.length > 4096) {
      return null;
    }
    const parts = token.split('.');
    if (
      parts.length !== 3 ||
      parts.some((part) => !isCanonicalBase64Url(part))
    ) {
      return null;
    }
    const [headerPart, claimsPart, signaturePart] = parts;
    try {
      const suppliedSignature = Buffer.from(signaturePart, 'base64url');
      const expectedSignature = this.sign(`${headerPart}.${claimsPart}`);
      if (
        suppliedSignature.length !== expectedSignature.length ||
        !timingSafeEqual(suppliedSignature, expectedSignature)
      ) {
        return null;
      }
      const header = JSON.parse(
        Buffer.from(headerPart, 'base64url').toString('utf8'),
      ) as unknown;
      if (!isHeader(header)) {
        return null;
      }
      const claims = JSON.parse(
        Buffer.from(claimsPart, 'base64url').toString('utf8'),
      ) as unknown;
      if (!isDeviceAccessClaims(claims)) {
        return null;
      }
      const nowSeconds = Math.floor(this.clock.now().getTime() / 1000);
      if (
        claims.iss !== 'memory-lighthouse-server' ||
        claims.aud !== 'memory-lighthouse-device' ||
        claims.env !== this.config.environment ||
        claims.exp <= nowSeconds ||
        claims.iat > nowSeconds + 30 ||
        claims.exp - claims.iat !== this.config.accessTokenTtlSeconds
      ) {
        return null;
      }
      return {
        kind: 'DEVICE',
        tokenId: claims.jti,
        credentialId: claims.cid,
        credentialFamilyId: claims.cfi,
        deviceId: claims.did,
        bindingId: claims.bid,
        householdId: claims.hid,
        recipientId: claims.rid,
        bindingVersion: claims.bv,
        capabilities: claims.cap,
      };
    } catch {
      return null;
    }
  }

  private sign(value: string): Buffer {
    return createHmac('sha256', this.config.accessTokenSecret)
      .update(value, 'utf8')
      .digest();
  }
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
}

function isCanonicalBase64Url(value: string): boolean {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return false;
  }
  const decoded = Buffer.from(value, 'base64url');
  return decoded.toString('base64url') === value;
}

function isHeader(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<string, unknown>).alg === 'HS256' &&
    (value as Record<string, unknown>).typ === 'JWT'
  );
}

function isDeviceAccessClaims(value: unknown): value is DeviceAccessClaims {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const claims = value as Record<string, unknown>;
  const ids = ['jti', 'cid', 'cfi', 'did', 'bid', 'hid', 'rid'];
  return (
    claims.aud === 'memory-lighthouse-device' &&
    claims.iss === 'memory-lighthouse-server' &&
    typeof claims.env === 'string' &&
    typeof claims.exp === 'number' &&
    Number.isSafeInteger(claims.exp) &&
    typeof claims.iat === 'number' &&
    Number.isSafeInteger(claims.iat) &&
    typeof claims.bv === 'number' &&
    Number.isSafeInteger(claims.bv) &&
    claims.bv >= 1 &&
    ids.every(
      (key) =>
        typeof claims[key] === 'string' && /^[A-Z0-9]{26}$/.test(claims[key]),
    ) &&
    Array.isArray(claims.cap) &&
    claims.cap.length > 0 &&
    claims.cap.every(
      (capability) =>
        capability === 'COMPANION' || capability === 'REMOTE_ASSISTANCE',
    )
  );
}
