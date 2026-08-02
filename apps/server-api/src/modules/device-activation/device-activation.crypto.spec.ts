import { generateKeyPairSync, sign } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { InvalidInstallationKeyException } from './device-activation.errors';
import {
  buildClaimProofMessage,
  DeviceActivationCrypto,
} from './device-activation.crypto';

const config = {
  activationPepper: Buffer.alloc(32, 1),
  credentialPepper: Buffer.alloc(32, 2),
  accessTokenSecret: Buffer.alloc(32, 3),
  accessTokenTtlSeconds: 600,
  environment: 'test' as const,
  challengeTtlSeconds: 300,
  challengeMaxAttempts: 5,
  credentialTtlSeconds: 3600,
};

describe('DeviceActivationCrypto', () => {
  const crypto = new DeviceActivationCrypto(config);

  it('accepts only canonical Ed25519 SPKI and verifies possession', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const spki = Buffer.from(
      publicKey.export({ format: 'der', type: 'spki' }),
    ).toString('base64url');
    const parsed = crypto.parseEd25519Spki(spki);
    const message = buildClaimProofMessage({
      publicId: 'ML-ABC234',
      installationId: '01J00000000000000000000000',
      serverNonce: Buffer.alloc(32, 4).toString('base64url'),
      proofType: 'DYNAMIC_CODE',
      proofDigest: crypto.digestProof('DYNAMIC_CODE', 'ABCD2345'),
    });
    const signature = sign(null, message, privateKey).toString('base64url');

    expect(crypto.verifyEd25519(parsed.der, message, signature)).toBe(true);
    expect(
      crypto.verifyEd25519(
        parsed.der,
        Buffer.from(`${message.toString('utf8')}tampered`),
        signature,
      ),
    ).toBe(false);
  });

  it('rejects non-Ed25519 public keys', () => {
    const { publicKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const spki = Buffer.from(
      publicKey.export({ format: 'der', type: 'spki' }),
    ).toString('base64url');

    expect(() => crypto.parseEd25519Spki(spki)).toThrow(
      InvalidInstallationKeyException,
    );
  });

  it('accepts only declared prime256v1 SPKI with DER ECDSA-SHA256 signatures', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ec', {
      namedCurve: 'prime256v1',
    });
    const spki = Buffer.from(
      publicKey.export({ format: 'der', type: 'spki' }),
    ).toString('base64url');
    const parsed = crypto.parseInstallationSpki(spki, 'ECDSA_P256_SHA256');
    const message = Buffer.from('p256-device-proof');
    const derSignature = sign('sha256', message, {
      key: privateKey,
      dsaEncoding: 'der',
    }).toString('base64url');
    const p1363Signature = sign('sha256', message, {
      key: privateKey,
      dsaEncoding: 'ieee-p1363',
    }).toString('base64url');

    expect(
      crypto.verifyInstallationSignature(
        'ECDSA_P256_SHA256',
        parsed.der,
        message,
        derSignature,
      ),
    ).toBe(true);
    expect(
      crypto.verifyInstallationSignature(
        'ECDSA_P256_SHA256',
        parsed.der,
        message,
        p1363Signature,
      ),
    ).toBe(false);
    expect(() => crypto.parseInstallationSpki(spki, 'ED25519')).toThrow(
      InvalidInstallationKeyException,
    );
    const ed25519 = generateKeyPairSync('ed25519');
    const ed25519Spki = Buffer.from(
      ed25519.publicKey.export({ format: 'der', type: 'spki' }),
    ).toString('base64url');
    expect(() =>
      crypto.parseInstallationSpki(ed25519Spki, 'ECDSA_P256_SHA256'),
    ).toThrow(InvalidInstallationKeyException);

    const p384 = generateKeyPairSync('ec', { namedCurve: 'secp384r1' });
    const p384Spki = Buffer.from(
      p384.publicKey.export({ format: 'der', type: 'spki' }),
    ).toString('base64url');
    expect(() =>
      crypto.parseInstallationSpki(p384Spki, 'ECDSA_P256_SHA256'),
    ).toThrow(InvalidInstallationKeyException);
  });

  it('normalizes dynamic codes but keeps QR secrets case-sensitive', () => {
    expect(
      crypto.equalHash(
        crypto.hashActivationProof('ML-ABC234', 'DYNAMIC_CODE', ' abcd2345 '),
        crypto.hashActivationProof('ML-ABC234', 'DYNAMIC_CODE', 'ABCD2345'),
      ),
    ).toBe(true);
    expect(
      crypto.equalHash(
        crypto.hashActivationProof('ML-ABC234', 'QR_SECRET', 'Secret'),
        crypto.hashActivationProof('ML-ABC234', 'QR_SECRET', 'secret'),
      ),
    ).toBe(false);
  });

  it('binds short-lived recovery tokens to the challenge version and installation', () => {
    const now = new Date('2026-08-02T00:00:00.000Z');
    const input = {
      challengeId: '01J00000000000000000000000',
      installationId: '01J11111111111111111111111',
      challengeVersion: 3,
      approvedAt: '2026-08-01T23:59:00.000Z',
      now,
    };
    const recovery = crypto.issueCredentialRecoveryToken(input);

    expect(
      crypto.verifyCredentialRecoveryToken({
        ...input,
        token: recovery.token,
      }),
    ).toBe(true);
    expect(
      crypto.verifyCredentialRecoveryToken({
        ...input,
        token: recovery.token,
        challengeVersion: 4,
      }),
    ).toBe(false);
    expect(
      crypto.verifyCredentialRecoveryToken({
        ...input,
        token: recovery.token,
        installationId: '01J22222222222222222222222',
      }),
    ).toBe(false);
    const replacement = recovery.token.endsWith('A') ? 'B' : 'A';
    expect(
      crypto.verifyCredentialRecoveryToken({
        ...input,
        token: `${recovery.token.slice(0, -1)}${replacement}`,
      }),
    ).toBe(false);
    expect(
      crypto.verifyCredentialRecoveryToken({
        ...input,
        token: recovery.token,
        now: new Date(recovery.expiresAt.getTime()),
      }),
    ).toBe(false);
  });
});
