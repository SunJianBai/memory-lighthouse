import { isIP } from 'node:net';

import type { ClaimNetworkSource } from './device-activation.types';

const CLAIM_NETWORK_SOURCES = new Set<ClaimNetworkSource>([
  'LOCAL_NETWORK',
  'LOOPBACK',
  'PUBLIC_IPV4',
  'PUBLIC_IPV6',
  'UNKNOWN',
]);

export function normalizeClaimNetworkSource(
  value: string | null | undefined,
): ClaimNetworkSource {
  return value && CLAIM_NETWORK_SOURCES.has(value as ClaimNetworkSource)
    ? (value as ClaimNetworkSource)
    : 'UNKNOWN';
}

function isLocalIpv4(parts: readonly number[]): boolean {
  const [first, second] = parts;
  return (
    first === 10 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 100 && second >= 64 && second <= 127)
  );
}

export function classifyClaimNetworkSource(
  rawAddress: string | undefined,
): ClaimNetworkSource {
  const trimmed = rawAddress?.trim();
  if (!trimmed) return 'UNKNOWN';

  const address = trimmed.startsWith('::ffff:')
    ? trimmed.slice('::ffff:'.length)
    : trimmed;
  const family = isIP(address);
  if (family === 4) {
    const parts = address.split('.').map(Number);
    if (parts[0] === 127) return 'LOOPBACK';
    return isLocalIpv4(parts) ? 'LOCAL_NETWORK' : 'PUBLIC_IPV4';
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    if (normalized === '::1') return 'LOOPBACK';
    if (
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe8') ||
      normalized.startsWith('fe9') ||
      normalized.startsWith('fea') ||
      normalized.startsWith('feb')
    ) {
      return 'LOCAL_NETWORK';
    }
    return 'PUBLIC_IPV6';
  }
  return 'UNKNOWN';
}
