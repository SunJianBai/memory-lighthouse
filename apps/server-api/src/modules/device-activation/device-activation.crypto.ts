import {
  createHash,
  createHmac,
  createPublicKey,
  KeyObject,
  randomBytes,
  timingSafeEqual,
  verify,
} from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import { DEVICE_ACTIVATION_SECURITY_CONFIG } from './device-activation.constants';
import type { DeviceActivationSecurityConfig } from './device-activation.config';
import { InvalidInstallationKeyException } from './device-activation.errors';
import type { ActivationProofType } from './device-activation.types';

const ACTIVATION_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

function decodeCanonicalBase64Url(
  value: string,
  maximumBytes: number,
): Buffer | null {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, 'base64url');
  if (
    decoded.length === 0 ||
    decoded.length > maximumBytes ||
    decoded.toString('base64url') !== value
  ) {
    return null;
  }
  return decoded;
}

function randomCharacters(length: number): string {
  const acceptedByteLimit =
    Math.floor(256 / ACTIVATION_ALPHABET.length) * ACTIVATION_ALPHABET.length;
  let output = '';
  while (output.length < length) {
    for (const byte of randomBytes(length)) {
      if (byte < acceptedByteLimit) {
        output += ACTIVATION_ALPHABET[byte % ACTIVATION_ALPHABET.length];
        if (output.length === length) {
          break;
        }
      }
    }
  }
  return output;
}

function proofMessage(
  action: string,
  fields: readonly [string, string][],
): Buffer {
  const lines = ['memory-lighthouse.device-proof.v1', `action=${action}`];
  for (const [name, value] of fields) {
    if (value.includes('\n') || value.includes('\r')) {
      throw new Error('Canonical proof values cannot contain line breaks');
    }
    lines.push(`${name}=${value}`);
  }
  return Buffer.from(`${lines.join('\n')}\n`, 'utf8');
}

export interface ClaimProofMessageInput {
  publicId: string;
  installationId: string;
  serverNonce: string;
  proofType: ActivationProofType;
  proofDigest: string;
}

export function buildClaimProofMessage(input: ClaimProofMessageInput): Buffer {
  return proofMessage('claim', [
    ['public-id', input.publicId],
    ['installation-id', input.installationId],
    ['server-nonce', input.serverNonce],
    ['proof-type', input.proofType],
    ['proof-sha256', input.proofDigest],
  ]);
}

export function buildExchangeProofMessage(input: {
  challengeId: string;
  installationId: string;
  approvedAt: string;
}): Buffer {
  return proofMessage('exchange', [
    ['challenge-id', input.challengeId],
    ['installation-id', input.installationId],
    ['approved-at', input.approvedAt],
  ]);
}

export function buildRefreshProofMessage(input: {
  credentialId: string;
  bindingId: string;
  credentialDigest: string;
}): Buffer {
  return proofMessage('refresh', [
    ['credential-id', input.credentialId],
    ['binding-id', input.bindingId],
    ['credential-sha256', input.credentialDigest],
  ]);
}

@Injectable()
export class DeviceActivationCrypto {
  constructor(
    @Inject(DEVICE_ACTIVATION_SECURITY_CONFIG)
    private readonly config: DeviceActivationSecurityConfig,
  ) {}

  parseEd25519Spki(encoded: string): {
    der: Uint8Array<ArrayBuffer>;
    key: KeyObject;
    fingerprint: Uint8Array<ArrayBuffer>;
  } {
    const der = decodeCanonicalBase64Url(encoded, 512);
    if (!der) {
      throw new InvalidInstallationKeyException();
    }

    try {
      const key = createPublicKey({ key: der, format: 'der', type: 'spki' });
      if (key.asymmetricKeyType !== 'ed25519') {
        throw new InvalidInstallationKeyException();
      }
      const canonicalDer = key.export({ format: 'der', type: 'spki' });
      if (!Buffer.from(canonicalDer).equals(der)) {
        throw new InvalidInstallationKeyException();
      }
      return {
        der: Uint8Array.from(der),
        key,
        fingerprint: Uint8Array.from(createHash('sha256').update(der).digest()),
      };
    } catch (error) {
      if (error instanceof InvalidInstallationKeyException) {
        throw error;
      }
      throw new InvalidInstallationKeyException();
    }
  }

  decodeSignature(value: string): Buffer | null {
    const signature = decodeCanonicalBase64Url(value, 64);
    return signature?.length === 64 ? signature : null;
  }

  verifyEd25519(
    publicKeyDer: Uint8Array,
    message: Buffer,
    encodedSignature: string,
  ): boolean {
    const signature = this.decodeSignature(encodedSignature);
    if (!signature) {
      return false;
    }
    try {
      const publicKey = createPublicKey({
        key: Buffer.from(publicKeyDer),
        format: 'der',
        type: 'spki',
      });
      return publicKey.asymmetricKeyType === 'ed25519'
        ? verify(null, message, publicKey, signature)
        : false;
    } catch {
      return false;
    }
  }

  generateActivationSecret(): string {
    return randomBytes(32).toString('base64url');
  }

  generateDynamicCode(): string {
    return randomCharacters(8);
  }

  generatePublicId(): string {
    return `ML-${randomCharacters(6)}`;
  }

  generateCredential(): string {
    return randomBytes(32).toString('base64url');
  }

  normalizeProof(type: ActivationProofType, value: string): string {
    return type === 'DYNAMIC_CODE' ? value.trim().toUpperCase() : value;
  }

  digestProof(type: ActivationProofType, value: string): string {
    return createHash('sha256')
      .update(type, 'utf8')
      .update('\0', 'utf8')
      .update(this.normalizeProof(type, value), 'utf8')
      .digest('base64url');
  }

  digestCredential(value: string): string {
    return createHash('sha256').update(value, 'utf8').digest('base64url');
  }

  hashActivationProof(
    publicId: string,
    type: ActivationProofType,
    rawValue: string,
  ): Uint8Array<ArrayBuffer> {
    return this.hmac(
      this.config.activationPepper,
      `activation-${type.toLowerCase()}`,
      `${publicId}\0${this.normalizeProof(type, rawValue)}`,
    );
  }

  hashCredential(rawCredential: string): Uint8Array<ArrayBuffer> {
    return this.hmac(
      this.config.credentialPepper,
      'device-credential',
      rawCredential,
    );
  }

  installationServerNonce(deviceId: string, fingerprint: Uint8Array): string {
    return Buffer.from(
      this.hmac(
        this.config.activationPepper,
        'installation-server-nonce',
        `${deviceId}\0${Buffer.from(fingerprint).toString('base64url')}`,
      ),
    ).toString('base64url');
  }

  equalHash(actual: Uint8Array, expected: Uint8Array | null): boolean {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = expected ? Buffer.from(expected) : Buffer.alloc(32);
    if (actualBuffer.length !== expectedBuffer.length) {
      // Keep a fixed-length comparison on malformed/legacy rows as well.
      timingSafeEqual(
        createHash('sha256').update(actualBuffer).digest(),
        createHash('sha256').update(expectedBuffer).digest(),
      );
      return false;
    }
    return timingSafeEqual(actualBuffer, expectedBuffer) && expected !== null;
  }

  equalText(actual: string, expected: string): boolean {
    const actualDigest = createHash('sha256').update(actual, 'utf8').digest();
    const expectedDigest = createHash('sha256')
      .update(expected, 'utf8')
      .digest();
    return timingSafeEqual(actualDigest, expectedDigest);
  }

  private hmac(
    pepper: Buffer,
    domain: string,
    value: string,
  ): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(
      createHmac('sha256', pepper)
        .update(domain, 'utf8')
        .update('\0', 'utf8')
        .update(value, 'utf8')
        .digest(),
    );
  }
}
