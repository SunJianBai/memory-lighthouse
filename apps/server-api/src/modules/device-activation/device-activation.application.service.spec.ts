import { generateKeyPairSync, KeyObject, sign } from 'node:crypto';

import { beforeEach, describe, expect, it } from '@jest/globals';

import type { PrismaService } from '../../infrastructure/database/prisma.service';
import { DeviceActivationApplicationService } from './device-activation.application.service';
import { DeviceAccessTokenService } from './device-access-token.service';
import { DeviceActivationCrypto } from './device-activation.crypto';
import {
  buildClaimProofMessage,
  buildExchangeProofMessage,
  buildRefreshProofMessage,
} from './device-activation.crypto';
import type { ClockPort } from './device-activation.types';

// Prisma 7's generated NodeNext client emits `.js` specifiers. These unit
// tests use a transaction state double, so the concrete database Adapter is
// intentionally replaced at the module boundary.
jest.mock('../../infrastructure/database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

type Row = Record<string, any>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, expected]) => {
    if (key === 'OR') {
      return (expected as Row[]).some((part) => matches(row, part));
    }
    if (expected && typeof expected === 'object' && 'in' in expected) {
      return expected.in.includes(row[key]);
    }
    if (expected instanceof Uint8Array) {
      return Buffer.from(row[key] ?? []).equals(Buffer.from(expected));
    }
    return row[key] === expected;
  });
}

function applyUpdate(row: Row, data: Row): void {
  for (const [key, value] of Object.entries(data)) {
    if (value && typeof value === 'object' && 'increment' in value) {
      row[key] = (row[key] ?? 0) + value.increment;
    } else {
      row[key] = value;
    }
  }
}

class MutableClock implements ClockPort {
  constructor(public current: Date) {}

  now(): Date {
    return new Date(this.current);
  }
}

class PrismaHarness {
  activationAuthorityEnabled = true;
  readonly devices: Row[] = [];
  readonly challenges: Row[] = [];
  readonly bindings: Row[] = [];
  readonly credentials: Row[] = [];
  readonly bindingEvents: Row[] = [];
  readonly outboxEvents: Row[] = [];

  readonly device: any;

  constructor() {
    this.device = {
      findUnique: async ({ where }: Row) =>
        this.devices.find((row) => matches(row, where)) ?? null,
      create: async ({ data }: Row) => {
        const row = {
          manufacturer: null,
          model: null,
          osVersion: null,
          appVersion: null,
          lastSeenAt: null,
          version: 0,
          ...data,
        };
        this.devices.push(row);
        return row;
      },
      update: async ({ where, data }: Row) => {
        const row = this.devices.find((item) => matches(item, where));
        if (!row) throw new Error('device missing');
        applyUpdate(row, data);
        return row;
      },
    };
  }

  readonly recipientMember = {
    findFirst: async ({ where }: Row) =>
      !this.activationAuthorityEnabled ||
      where.userId === 'denied-user' ||
      where.member?.userId === 'denied-user'
        ? null
        : { householdMemberId: '01JMEMBER00000000000000000' },
    findMany: async () => [{ recipientId: '01JRECIPIENT00000000000000' }],
  };

  readonly deviceActivationChallenge = {
    findUnique: async ({ where }: Row) =>
      this.challenges.find((row) => matches(row, where)) ?? null,
    create: async ({ data }: Row) => {
      const row = {
        pendingDeviceId: null,
        approvedByMemberId: null,
        claimedAt: null,
        approvedAt: null,
        consumedAt: null,
        attemptCount: 0,
        version: 0,
        ...data,
      };
      this.challenges.push(row);
      return row;
    },
    updateMany: async ({ where, data }: Row) => {
      const rows = this.challenges.filter((row) => matches(row, where));
      rows.forEach((row) => applyUpdate(row, data));
      return { count: rows.length };
    },
  };

  readonly companionBinding = {
    findUnique: async ({ where }: Row) =>
      this.bindings.find((row) => matches(row, where)) ?? null,
    findFirst: async ({ where }: Row) => {
      const scalar = { ...where };
      delete scalar.device;
      delete scalar.household;
      delete scalar.recipient;
      return this.bindings.find((row) => matches(row, scalar)) ?? null;
    },
    findMany: async () => this.bindings,
    create: async ({ data }: Row) => {
      if (this.bindings.some((row) => row.deviceId === data.deviceId)) {
        const error = new Error('unique') as Error & { code: string };
        error.code = 'P2002';
        throw error;
      }
      const row = {
        revokedAt: null,
        bindingVersion: 1,
        version: 0,
        createdAt: new Date(),
        ...data,
      };
      this.bindings.push(row);
      return row;
    },
    update: async ({ where, data }: Row) => {
      const row = this.bindings.find((item) => matches(item, where));
      if (!row) throw new Error('binding missing');
      applyUpdate(row, data);
      return row;
    },
    updateMany: async ({ where, data }: Row) => {
      const rows = this.bindings.filter((row) => matches(row, where));
      rows.forEach((row) => applyUpdate(row, data));
      return { count: rows.length };
    },
  };

  readonly deviceCredential = {
    findUnique: async ({ where, include }: Row) => {
      const row = this.credentials.find((item) => matches(item, where));
      if (!row) return null;
      if (!include) return row;
      const binding = this.bindings.find((item) => item.id === row.bindingId);
      const device = this.devices.find((item) => item.id === binding?.deviceId);
      return { ...row, binding: { ...binding, device } };
    },
    findFirst: async ({ where }: Row) => {
      const { expiresAt, ...scalar } = where;
      return (
        this.credentials.find(
          (item) =>
            matches(item, scalar) &&
            (!expiresAt?.gt || item.expiresAt > expiresAt.gt),
        ) ?? null
      );
    },
    create: async ({ data }: Row) => {
      const row = {
        lastUsedAt: null,
        rotatedAt: null,
        revokedAt: null,
        ...data,
      };
      this.credentials.push(row);
      return row;
    },
    update: async ({ where, data }: Row) => {
      const row = this.credentials.find((item) => matches(item, where));
      if (!row) throw new Error('credential missing');
      applyUpdate(row, data);
      return row;
    },
    updateMany: async ({ where, data }: Row) => {
      const rows = this.credentials.filter((row) => matches(row, where));
      rows.forEach((row) => applyUpdate(row, data));
      return { count: rows.length };
    },
  };

  readonly deviceBindingEvent = {
    create: async ({ data }: Row) => {
      this.bindingEvents.push(data);
      return data;
    },
  };

  readonly outboxEvent = {
    create: async ({ data }: Row) => {
      this.outboxEvents.push(data);
      return data;
    },
  };

  async $transaction<T>(
    callback: (transaction: this) => Promise<T>,
  ): Promise<T> {
    return callback(this);
  }
}

const securityConfig = {
  activationPepper: Buffer.alloc(32, 11),
  credentialPepper: Buffer.alloc(32, 12),
  accessTokenSecret: Buffer.alloc(32, 13),
  accessTokenTtlSeconds: 600,
  environment: 'test' as const,
  challengeTtlSeconds: 300,
  challengeMaxAttempts: 5,
  credentialTtlSeconds: 3600,
};

function errorCode(error: unknown): string | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('getResponse' in error) ||
    typeof error.getResponse !== 'function'
  ) {
    return undefined;
  }
  const response = error.getResponse() as { code?: string };
  return response.code;
}

async function expectErrorCode(
  promise: Promise<unknown>,
  expectedCode: string,
): Promise<void> {
  try {
    await promise;
    throw new Error(`Expected ${expectedCode}, but the promise resolved`);
  } catch (error) {
    expect(errorCode(error)).toBe(expectedCode);
  }
}

describe('DeviceActivationApplicationService', () => {
  let prisma: PrismaHarness;
  let clock: MutableClock;
  let crypto: DeviceActivationCrypto;
  let service: DeviceActivationApplicationService;
  let publicKeySpki: string;
  let privateKey: KeyObject;

  beforeEach(() => {
    prisma = new PrismaHarness();
    clock = new MutableClock(new Date('2026-08-01T10:00:00.000Z'));
    crypto = new DeviceActivationCrypto(securityConfig);
    service = new DeviceActivationApplicationService(
      prisma as unknown as PrismaService,
      crypto,
      new DeviceAccessTokenService(securityConfig, clock),
      clock,
      securityConfig,
    );
    const pair = generateKeyPairSync('ed25519');
    privateKey = pair.privateKey;
    publicKeySpki = Buffer.from(
      pair.publicKey.export({ format: 'der', type: 'spki' }),
    ).toString('base64url');
  });

  async function prepareClaim(proofOverride?: string): Promise<{
    presentation: Awaited<ReturnType<typeof service.createActivationChallenge>>;
    installation: Awaited<ReturnType<typeof service.registerInstallation>>;
  }> {
    const installation = await service.registerInstallation({
      installationPublicKeySpki: publicKeySpki,
      platform: 'ANDROID',
      manufacturer: 'Test',
      model: 'Companion',
    });
    const presentation = await service.createActivationChallenge({
      userId: 'user-1',
      householdId: '01JHOUSEHOLD00000000000000',
      recipientId: '01JRECIPIENT00000000000000',
    });
    const proof = proofOverride ?? presentation.dynamicCode;
    const message = buildClaimProofMessage({
      publicId: presentation.publicId,
      installationId: installation.installationId,
      serverNonce: installation.serverNonce,
      proofType: 'DYNAMIC_CODE',
      proofDigest: crypto.digestProof('DYNAMIC_CODE', proof),
    });
    await service.claimActivationChallenge({
      publicId: presentation.publicId,
      installationId: installation.installationId,
      serverNonce: installation.serverNonce,
      proofType: 'DYNAMIC_CODE',
      proof,
      signature: sign(null, message, privateKey).toString('base64url'),
    });
    return { presentation, installation };
  }

  async function activate(): Promise<{
    installation: Awaited<ReturnType<typeof service.registerInstallation>>;
    credential: Awaited<ReturnType<typeof service.exchangeDeviceCredential>>;
    challengeId: string;
    exchangeSignature: string;
  }> {
    const { presentation, installation } = await prepareClaim();
    const approval = await service.approveActivation({
      userId: 'user-1',
      challengeId: presentation.challengeId,
    });
    const exchangeMessage = buildExchangeProofMessage({
      challengeId: presentation.challengeId,
      installationId: installation.installationId,
      approvedAt: approval.approvedAt,
    });
    const exchangeSignature = sign(null, exchangeMessage, privateKey).toString(
      'base64url',
    );
    const credential = await service.exchangeDeviceCredential({
      challengeId: presentation.challengeId,
      installationId: installation.installationId,
      signature: exchangeSignature,
    });
    return {
      installation,
      credential,
      challengeId: presentation.challengeId,
      exchangeSignature,
    };
  }

  it('requires installation private-key possession, then claim before approval', async () => {
    const installation = await service.registerInstallation({
      installationPublicKeySpki: publicKeySpki,
      platform: 'ANDROID',
    });
    const presentation = await service.createActivationChallenge({
      userId: 'user-1',
      householdId: '01JHOUSEHOLD00000000000000',
      recipientId: '01JRECIPIENT00000000000000',
    });

    await expectErrorCode(
      service.approveActivation({
        userId: 'user-1',
        challengeId: presentation.challengeId,
      }),
      'ACTIVATION_STATE_CONFLICT',
    );

    const wrongKey = generateKeyPairSync('ed25519').privateKey;
    const message = buildClaimProofMessage({
      publicId: presentation.publicId,
      installationId: installation.installationId,
      serverNonce: installation.serverNonce,
      proofType: 'DYNAMIC_CODE',
      proofDigest: crypto.digestProof('DYNAMIC_CODE', presentation.dynamicCode),
    });
    await expectErrorCode(
      service.claimActivationChallenge({
        publicId: presentation.publicId,
        installationId: installation.installationId,
        serverNonce: installation.serverNonce,
        proofType: 'DYNAMIC_CODE',
        proof: presentation.dynamicCode,
        signature: sign(null, message, wrongKey).toString('base64url'),
      }),
      'ACTIVATION_PROOF_INVALID',
    );

    await expect(prepareClaim()).resolves.toBeDefined();
  });

  it('expires challenges and persists a stable ACTIVATION_EXPIRED terminal state', async () => {
    const presentation = await service.createActivationChallenge({
      userId: 'user-1',
      householdId: '01JHOUSEHOLD00000000000000',
      recipientId: '01JRECIPIENT00000000000000',
    });
    clock.current = new Date('2026-08-01T10:05:01.000Z');

    await expectErrorCode(
      service.approveActivation({
        userId: 'user-1',
        challengeId: presentation.challengeId,
      }),
      'ACTIVATION_EXPIRED',
    );
    expect(prisma.challenges[0].status).toBe('EXPIRED');
  });

  it('locks a challenge after the configured invalid-attempt limit', async () => {
    const installation = await service.registerInstallation({
      installationPublicKeySpki: publicKeySpki,
      platform: 'ANDROID',
    });
    const presentation = await service.createActivationChallenge({
      userId: 'user-1',
      householdId: '01JHOUSEHOLD00000000000000',
      recipientId: '01JRECIPIENT00000000000000',
    });
    const wrongProof = 'ZZZZZZZZ';
    const message = buildClaimProofMessage({
      publicId: presentation.publicId,
      installationId: installation.installationId,
      serverNonce: installation.serverNonce,
      proofType: 'DYNAMIC_CODE',
      proofDigest: crypto.digestProof('DYNAMIC_CODE', wrongProof),
    });
    const signature = sign(null, message, privateKey).toString('base64url');

    for (let attempt = 1; attempt <= 5; attempt += 1) {
      const expectedCode =
        attempt === 5
          ? 'ACTIVATION_ATTEMPTS_EXCEEDED'
          : 'ACTIVATION_PROOF_INVALID';
      await expectErrorCode(
        service.claimActivationChallenge({
          publicId: presentation.publicId,
          installationId: installation.installationId,
          serverNonce: installation.serverNonce,
          proofType: 'DYNAMIC_CODE',
          proof: wrongProof,
          signature,
        }),
        expectedCode,
      );
    }
    expect(prisma.challenges[0]).toMatchObject({
      attemptCount: 5,
      status: 'ATTEMPTS_EXCEEDED',
    });
  });

  it('creates one binding and stores only a peppered credential hash', async () => {
    const { installation, credential, challengeId, exchangeSignature } =
      await activate();

    expect(prisma.bindings).toHaveLength(1);
    expect(prisma.credentials).toHaveLength(1);
    expect(prisma.credentials[0].credentialHash).not.toEqual(
      Buffer.from(credential.credential),
    );
    expect(JSON.stringify(prisma)).not.toContain(credential.credential);
    expect(credential.accessToken.split('.')).toHaveLength(3);
    await expect(
      service.resolveDevicePrincipal(credential.accessToken),
    ).resolves.toMatchObject({
      kind: 'DEVICE',
      deviceId: installation.installationId,
      bindingId: credential.bindingId,
      credentialFamilyId: credential.credentialFamilyId,
      capabilities: ['COMPANION', 'REMOTE_ASSISTANCE'],
    });

    await expectErrorCode(
      service.exchangeDeviceCredential({
        challengeId,
        installationId: installation.installationId,
        signature: exchangeSignature,
      }),
      'ACTIVATION_ALREADY_CONSUMED',
    );

    const second = await service.createActivationChallenge({
      userId: 'user-1',
      householdId: '01JHOUSEHOLD00000000000000',
      recipientId: '01JRECIPIENT00000000000000',
    });
    const claimMessage = buildClaimProofMessage({
      publicId: second.publicId,
      installationId: installation.installationId,
      serverNonce: installation.serverNonce,
      proofType: 'DYNAMIC_CODE',
      proofDigest: crypto.digestProof('DYNAMIC_CODE', second.dynamicCode),
    });
    await service.claimActivationChallenge({
      publicId: second.publicId,
      installationId: installation.installationId,
      serverNonce: installation.serverNonce,
      proofType: 'DYNAMIC_CODE',
      proof: second.dynamicCode,
      signature: sign(null, claimMessage, privateKey).toString('base64url'),
    });
    const approval = await service.approveActivation({
      userId: 'user-1',
      challengeId: second.challengeId,
    });
    const exchangeMessage = buildExchangeProofMessage({
      challengeId: second.challengeId,
      installationId: installation.installationId,
      approvedAt: approval.approvedAt,
    });
    await expectErrorCode(
      service.exchangeDeviceCredential({
        challengeId: second.challengeId,
        installationId: installation.installationId,
        signature: sign(null, exchangeMessage, privateKey).toString(
          'base64url',
        ),
      }),
      'DEVICE_ALREADY_BOUND',
    );
    expect(prisma.bindings).toHaveLength(1);
  });

  it('rotates credentials and revokes the whole family when an old token is replayed', async () => {
    const { credential } = await activate();
    const refreshMessage = buildRefreshProofMessage({
      credentialId: credential.credentialId,
      bindingId: credential.bindingId,
      credentialDigest: crypto.digestCredential(credential.credential),
    });
    const signature = sign(null, refreshMessage, privateKey).toString(
      'base64url',
    );
    const rotated = await service.rotateDeviceCredential(
      credential.credential,
      signature,
    );
    expect(rotated.credential).not.toBe(credential.credential);
    expect(rotated.accessToken).not.toBe(credential.accessToken);

    await expectErrorCode(
      service.rotateDeviceCredential(credential.credential, signature),
      'DEVICE_CREDENTIAL_REPLAYED',
    );
    expect(
      prisma.credentials
        .filter(
          (item) => item.credentialFamilyId === credential.credentialFamilyId,
        )
        .every((item) => item.revokedAt instanceof Date),
    ).toBe(true);
  });

  it('revokes the binding, every credential, and appends a binding event', async () => {
    const { credential } = await activate();
    await service.revokeCompanionBinding({
      userId: 'user-1',
      householdId: credential.householdId,
      bindingId: credential.bindingId,
      reasonCode: 'FAMILY_REQUEST',
    });

    expect(prisma.bindings[0]).toMatchObject({ status: 'REVOKED' });
    expect(prisma.credentials[0].revokedAt).toBeInstanceOf(Date);
    expect(prisma.bindingEvents.at(-1)).toMatchObject({
      eventType: 'REVOKED',
      reasonCode: 'FAMILY_REQUEST',
    });
    await expectErrorCode(
      service.resolveDevicePrincipal(credential.accessToken),
      'DEVICE_REVOKED',
    );
  });

  it('re-checks approval authority when the device exchanges the credential', async () => {
    const { presentation, installation } = await prepareClaim();
    const approval = await service.approveActivation({
      userId: 'user-1',
      challengeId: presentation.challengeId,
    });
    prisma.activationAuthorityEnabled = false;
    const exchangeMessage = buildExchangeProofMessage({
      challengeId: presentation.challengeId,
      installationId: installation.installationId,
      approvedAt: approval.approvedAt,
    });
    await expectErrorCode(
      service.exchangeDeviceCredential({
        challengeId: presentation.challengeId,
        installationId: installation.installationId,
        signature: sign(null, exchangeMessage, privateKey).toString(
          'base64url',
        ),
      }),
      'ACTIVATION_APPROVAL_REVOKED',
    );
    expect(prisma.bindings).toHaveLength(0);
  });
});
