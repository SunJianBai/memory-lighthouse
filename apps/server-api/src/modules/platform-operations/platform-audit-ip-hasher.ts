import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';

import { Inject, Injectable } from '@nestjs/common';

import { RATE_LIMIT_CONFIG } from '../../infrastructure/rate-limit/rate-limit.constants';
import type { RateLimitConfig } from '../../infrastructure/rate-limit/rate-limit.types';

const HASH_DOMAIN = 'platform-audit-source-ip/v1';
const UNKNOWN_SOURCE_IP = 'unknown';

function canonicalIpAddress(raw: string | undefined): string {
  if (!raw) {
    return UNKNOWN_SOURCE_IP;
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
      return UNKNOWN_SOURCE_IP;
    }
  }
  return UNKNOWN_SOURCE_IP;
}

@Injectable()
export class PlatformAuditIpHasher {
  constructor(
    @Inject(RATE_LIMIT_CONFIG) private readonly config: RateLimitConfig,
  ) {}

  hash(ipAddress: string | undefined): Uint8Array {
    const hmac = createHmac('sha256', this.config.keySecret);
    this.addPart(hmac, HASH_DOMAIN);
    this.addPart(hmac, canonicalIpAddress(ipAddress));
    return Uint8Array.from(hmac.digest());
  }

  private addPart(hmac: ReturnType<typeof createHmac>, value: string): void {
    const encoded = Buffer.from(value, 'utf8');
    const length = Buffer.allocUnsafe(4);
    length.writeUInt32BE(encoded.length);
    hmac.update(length);
    hmac.update(encoded);
  }
}
