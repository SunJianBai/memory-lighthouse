import { randomBytes } from 'node:crypto';

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function encode(value: bigint, length: number): string {
  let remaining = value;
  let result = '';

  for (let index = 0; index < length; index += 1) {
    result = CROCKFORD_BASE32[Number(remaining & 31n)] + result;
    remaining >>= 5n;
  }

  return result;
}

export function newUlid(now = Date.now()): string {
  const timestamp = BigInt(now);
  const random = randomBytes(10);
  let randomness = 0n;

  for (const byte of random) {
    randomness = (randomness << 8n) | BigInt(byte);
  }

  return `${encode(timestamp, 10)}${encode(randomness, 16)}`;
}
