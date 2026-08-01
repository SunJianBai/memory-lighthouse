import { describe, expect, it } from '@jest/globals';
import type { Request } from 'express';

import { RateLimitRequestSubjectFactory } from './rate-limit-request-subject.factory';
import type { RateLimitConfig } from './rate-limit.types';

const config = (trustProxyHops: 0 | 1): RateLimitConfig => ({
  environment: 'test',
  backend: 'memory',
  keySecret: Buffer.alloc(32, 1),
  redisUrl: undefined,
  redisPrefix: 'openbmb:rate-limit:v1',
  redisConnectTimeoutMs: 5_000,
  trustProxyHops,
});

function request(remoteAddress: string, forwardedFor: string): Request {
  return {
    body: {},
    params: {},
    headers: { 'x-forwarded-for': forwardedFor },
    socket: { remoteAddress },
  } as unknown as Request;
}

describe('RateLimitRequestSubjectFactory proxy boundary', () => {
  it('accepts one forwarded hop only from the loopback Caddy peer', () => {
    const factory = new RateLimitRequestSubjectFactory(config(1));

    expect(
      factory.resolve(request('127.0.0.1', '203.0.113.8'), ['ip']),
    ).toEqual([{ kind: 'ip', value: '203.0.113.8' }]);
  });

  it('ignores a spoofed forwarding header from a non-loopback peer', () => {
    const factory = new RateLimitRequestSubjectFactory(config(1));

    expect(
      factory.resolve(request('198.51.100.9', '203.0.113.8'), ['ip']),
    ).toEqual([{ kind: 'ip', value: '198.51.100.9' }]);
  });
});
