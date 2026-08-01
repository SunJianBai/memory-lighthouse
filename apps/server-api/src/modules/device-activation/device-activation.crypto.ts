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
import type {
  ActivationProofType,
  InstallationKeyAlgorithm,
} from './device-activation.types';

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

function isCanonicalP256DerSignature(signature: Buffer): boolean {
  if (
    signature.length < 8 ||
    signature.length > 72 ||
    signature[0] !== 0x30 ||
    signature[1] !== signature.length - 2
  ) {
    return false;
  }
  let offset = 2;
  for (let integer = 0; integer < 2; integer += 1) {
    if (signature[offset] !== 0x02) return false;
    const length = signature[offset + 1];
    offset += 2;
    if (!length || length > 33 || offset + length > signature.length) {
      return false;
    }
    const first = signature[offset];
    if (
      (first & 0x80) !== 0 ||
      (length > 1 && first === 0 && (signature[offset + 1] & 0x80) === 0)
    ) {
      return false;
    }
    offset += length;
  }
  return offset === signature.length;
}

function keyMatchesAlgorithm(key: KeyObject, algorithm: string): boolean {
  if (algorithm === 'ED25519') return key.asymmetricKeyType === 'ed25519';
  return (
    algorithm === 'ECDSA_P256_SHA256' &&
    key.asymmetricKeyType === 'ec' &&
    key.asymmetricKeyDetails?.namedCurve === 'prime256v1'
  );
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

  parseInstallationSpki(
    encoded: string,
    algorithm: InstallationKeyAlgorithm,
  ): {
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
      if (!keyMatchesAlgorithm(key, algorithm)) {
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

  parseEd25519Spki(encoded: string): {
    der: Uint8Array<ArrayBuffer>;
    key: KeyObject;
    fingerprint: Uint8Array<ArrayBuffer>;
  } {
    return this.parseInstallationSpki(encoded, 'ED25519');
  }

  verifyInstallationSignature(
    algorithm: string,
    publicKeyDer: Uint8Array,
    message: Buffer,
    encodedSignature: string,
  ): boolean {
    const signature = decodeCanonicalBase64Url(encodedSignature, 80);
    if (!signature) {
      return false;
    }
    if (algorithm !== 'ED25519' && algorithm !== 'ECDSA_P256_SHA256') {
      return false;
    }
    if (
      (algorithm === 'ED25519' && signature.length !== 64) ||
      (algorithm === 'ECDSA_P256_SHA256' &&
        !isCanonicalP256DerSignature(signature))
    ) {
      return false;
    }
    try {
      const publicKey = createPublicKey({
        key: Buffer.from(publicKeyDer),
        format: 'der',
        type: 'spki',
      });
      if (!keyMatchesAlgorithm(publicKey, algorithm)) return false;
      return algorithm === 'ED25519'
        ? verify(null, message, publicKey, signature)
        : verify(
            'sha256',
            message,
            { key: publicKey, dsaEncoding: 'der' },
            signature,
          );
    } catch {
      return false;
    }
  }

  verifyEd25519(
    publicKeyDer: Uint8Array,
    message: Buffer,
    encodedSignature: string,
  ): boolean {
    return this.verifyInstallationSignature(
      'ED25519',
      publicKeyDer,
      message,
      encodedSignature,
    );
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

  approvalSnapshotToken(input: {
    challengeId: string;
    challengeVersion: number;
    pendingDeviceId: string;
    deviceKeyFingerprint: Uint8Array;
    deviceMetadata: {
      platform: string;
      installationKeyAlgorithm: string;
      manufacturer: string | null;
      model: string | null;
      osVersion: string | null;
      appVersion: string | null;
    };
    claimedAt: Date;
    claimNetworkSource: string;
  }): string {
    return Buffer.from(
      this.hmac(
        this.config.activationPepper,
        'activation-approval-snapshot',
        [
          input.challengeId,
          String(input.challengeVersion),
          input.pendingDeviceId,
          Buffer.from(input.deviceKeyFingerprint).toString('base64url'),
          input.deviceMetadata.platform,
          input.deviceMetadata.installationKeyAlgorithm,
          input.deviceMetadata.manufacturer ?? '',
          input.deviceMetadata.model ?? '',
          input.deviceMetadata.osVersion ?? '',
          input.deviceMetadata.appVersion ?? '',
          input.claimedAt.toISOString(),
          input.claimNetworkSource,
        ].join('\0'),
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
