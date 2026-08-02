import { describe, expect, it } from '@jest/globals';

import {
  classifyClaimNetworkSource,
  normalizeClaimNetworkSource,
} from './device-network-source';

describe('device claim network source', () => {
  it.each([
    ['127.0.0.1', 'LOOPBACK'],
    ['::1', 'LOOPBACK'],
    ['192.168.1.5', 'LOCAL_NETWORK'],
    ['::ffff:10.0.0.8', 'LOCAL_NETWORK'],
    ['100.64.10.1', 'LOCAL_NETWORK'],
    ['203.0.113.42', 'PUBLIC_IPV4'],
    ['2001:db8::1', 'PUBLIC_IPV6'],
    ['not-an-address', 'UNKNOWN'],
    [undefined, 'UNKNOWN'],
  ])('classifies %s without retaining the address', (address, expected) => {
    expect(classifyClaimNetworkSource(address)).toBe(expected);
  });

  it('normalizes legacy or malformed stored values to UNKNOWN', () => {
    expect(normalizeClaimNetworkSource('PUBLIC_IPV4')).toBe('PUBLIC_IPV4');
    expect(normalizeClaimNetworkSource('unexpected')).toBe('UNKNOWN');
    expect(normalizeClaimNetworkSource(null)).toBe('UNKNOWN');
  });
});
