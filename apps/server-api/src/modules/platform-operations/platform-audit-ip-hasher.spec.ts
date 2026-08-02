import { describe, expect, it } from '@jest/globals';

import type { RateLimitConfig } from '../../infrastructure/rate-limit/rate-limit.types';
import { PlatformAuditIpHasher } from './platform-audit-ip-hasher';

function createHasher(): PlatformAuditIpHasher {
  return new PlatformAuditIpHasher({
    environment: 'test',
    backend: 'memory',
    keySecret: Buffer.alloc(32, 0x5a),
    redisPrefix: 'test',
    redisConnectTimeoutMs: 1_000,
    trustProxyHops: 0,
  } satisfies RateLimitConfig);
}

describe('PlatformAuditIpHasher', () => {
  it('creates a deterministic non-reversible 32-byte pseudonym', () => {
    const hasher = createHasher();
    const sourceIp = '203.0.113.24';
    const first = hasher.hash(sourceIp);

    expect(first).toHaveLength(32);
    expect(Buffer.from(first)).toEqual(Buffer.from(hasher.hash(sourceIp)));
    expect(Buffer.from(first).includes(Buffer.from(sourceIp, 'utf8'))).toBe(
      false,
    );
    expect(Buffer.from(first)).not.toEqual(
      Buffer.from(hasher.hash('203.0.113.25')),
    );
  });

  it('canonicalizes IPv4-mapped addresses before hashing', () => {
    const hasher = createHasher();

    expect(Buffer.from(hasher.hash('::ffff:203.0.113.24'))).toEqual(
      Buffer.from(hasher.hash('203.0.113.24')),
    );
  });
});
