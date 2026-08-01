import { isIP } from 'node:net';

import { Inject, Injectable } from '@nestjs/common';
import type { Request } from 'express';

import { RATE_LIMIT_CONFIG } from './rate-limit.constants';
import type {
  RateLimitConfig,
  RateLimitDimension,
  RateLimitDimensionKind,
} from './rate-limit.types';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | undefined {
  return typeof value === 'object' && value !== null
    ? (value as UnknownRecord)
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) {
    return undefined;
  }
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0 || pair.slice(0, separator).trim() !== name) {
      continue;
    }
    const raw = pair.slice(separator + 1).trim();
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return undefined;
}

function canonicalIp(raw: string | undefined): string | undefined {
  if (!raw) {
    return undefined;
  }
  let value = raw.trim().replace(/^"|"$/g, '').toLowerCase();
  if (/^\d{1,3}(?:\.\d{1,3}){3}:\d+$/.test(value)) {
    value = value.slice(0, value.lastIndexOf(':'));
  }
  if (value.startsWith('[') && value.includes(']')) {
    value = value.slice(1, value.indexOf(']'));
  }
  value = value.split('%', 1)[0] ?? value;
  if (value.startsWith('::ffff:') && isIP(value.slice(7)) === 4) {
    value = value.slice(7);
  }
  const version = isIP(value);
  if (version === 4) {
    return value;
  }
  if (version === 6) {
    try {
      return new URL(`http://[${value}]/`).hostname.slice(1, -1);
    } catch {
      return undefined;
    }
  }
  return undefined;
}

@Injectable()
export class RateLimitRequestSubjectFactory {
  constructor(
    @Inject(RATE_LIMIT_CONFIG) private readonly config: RateLimitConfig,
  ) {}

  resolve(
    request: Request,
    kinds: readonly RateLimitDimensionKind[],
  ): RateLimitDimension[] | undefined {
    const dimensions: RateLimitDimension[] = [];
    for (const kind of kinds) {
      const value = this.read(request, kind);
      if (value === undefined) {
        return undefined;
      }
      dimensions.push({ kind, value: this.normalize(kind, value) });
    }
    return dimensions;
  }

  private read(
    request: Request,
    kind: RateLimitDimensionKind,
  ): string | undefined {
    const body = asRecord(request.body);
    const params = asRecord(request.params);
    switch (kind) {
      case 'ip':
        return this.clientIp(request);
      case 'identifier':
        return asNonEmptyString(body?.identifier);
      case 'email':
        return asNonEmptyString(body?.email);
      case 'username':
        return asNonEmptyString(body?.username);
      case 'one-time-token':
        return asNonEmptyString(body?.token);
      case 'refresh-token':
        return (
          asNonEmptyString(body?.refreshToken) ??
          readCookie(request, 'ml_user_refresh')
        );
      case 'installation-public-key':
        return asNonEmptyString(body?.installationPublicKeySpki);
      case 'installation-id':
        return asNonEmptyString(body?.installationId);
      case 'public-activation-id':
        return asNonEmptyString(params?.publicId);
      case 'challenge-id':
        return (
          asNonEmptyString(params?.challengeId) ??
          asNonEmptyString(body?.challengeId)
        );
      case 'device-credential':
        return (
          asNonEmptyString(body?.credential) ?? this.bearerCredential(request)
        );
    }
  }

  private normalize(kind: RateLimitDimensionKind, value: string): string {
    const trimmed = value.trim();
    if (kind === 'identifier' || kind === 'email' || kind === 'username') {
      return trimmed.normalize('NFKC').toLowerCase();
    }
    return trimmed;
  }

  private clientIp(request: Request): string {
    const directPeer = canonicalIp(request.socket.remoteAddress);
    if (
      this.config.trustProxyHops > 0 &&
      (directPeer === '127.0.0.1' || directPeer === '::1')
    ) {
      const forwarded = request.headers['x-forwarded-for'];
      const entries = (Array.isArray(forwarded) ? forwarded : [forwarded])
        .filter((value): value is string => typeof value === 'string')
        .flatMap((value) => value.split(','))
        .map((value) => value.trim())
        .filter(Boolean);
      const index = entries.length - this.config.trustProxyHops;
      const trustedValue = index >= 0 ? canonicalIp(entries[index]) : undefined;
      if (trustedValue) {
        return trustedValue;
      }
    }
    return directPeer ?? 'unknown';
  }

  private bearerCredential(request: Request): string | undefined {
    const authorization = request.headers.authorization;
    if (!authorization) {
      return undefined;
    }
    const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
    return asNonEmptyString(match?.[1]);
  }
}
