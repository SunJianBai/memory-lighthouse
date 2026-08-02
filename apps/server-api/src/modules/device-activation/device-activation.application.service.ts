import { Inject, Injectable } from '@nestjs/common';
import { ulid } from 'ulid';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { Prisma } from '../../infrastructure/database/generated/prisma/client';
import {
  BINDING_STATUS,
  CHALLENGE_STATUS,
  DEVICE_ACTIVATION_CLOCK,
  DEVICE_ACTIVATION_SECURITY_CONFIG,
  DEVICE_KEY_PROTECTION,
  DEVICE_STATUS,
  INSTALLATION_KEY_ALGORITHM,
} from './device-activation.constants';
import type { DeviceActivationSecurityConfig } from './device-activation.config';
import {
  ActivationApprovalRevokedException,
  ActivationApprovalSnapshotChangedException,
  ActivationAlreadyConsumedException,
  ActivationAttemptsExceededException,
  ActivationExpiredException,
  ActivationIdempotencyConflictException,
  ActivationIdempotencyKeyException,
  ActivationNotFoundException,
  ActivationProofInvalidException,
  ActivationStateConflictException,
  CompanionBindingConflictException,
  CompanionBindingNotFoundException,
  DeviceCredentialReplayedException,
  DeviceRevokedException,
  InvalidDeviceCredentialException,
  RecipientActivationDeniedException,
  UnsupportedDeviceKeyProtectionException,
  UnsupportedInstallationKeyAlgorithmException,
  VersionConflictException,
} from './device-activation.errors';
import { DeviceAccessTokenService } from './device-access-token.service';
import {
  buildClaimProofMessage,
  buildExchangeProofMessage,
  buildExchangeRecoveryProofMessage,
  buildRefreshProofMessage,
  DeviceActivationCrypto,
} from './device-activation.crypto';
import type {
  ActivationApprovalDetails,
  ActivationPresentation,
  ActivationProofType,
  ClockPort,
  CompanionBindingView,
  DeviceCredentialPresentation,
  DeviceInstallationView,
  DevicePrincipal,
  InstallationKeyAlgorithm,
  PublicActivationStatus,
} from './device-activation.types';
import {
  classifyClaimNetworkSource,
  normalizeClaimNetworkSource,
} from './device-network-source';
import { RemoteMediaSecurityCoordinator } from '../realtime-communication/remote-media-security.coordinator';
import { IdentityApplicationService } from '../identity';

type DatabaseClient = PrismaService | Prisma.TransactionClient;

const SERIALIZABLE_RETRY_LIMIT = 3;

export interface RegisterDeviceInstallationCommand {
  installationPublicKeySpki: string;
  installationKeyAlgorithm: InstallationKeyAlgorithm;
  keyProtection: 'NON_EXPORTABLE_V1';
  platform: 'ANDROID' | 'WEB';
  manufacturer?: string;
  model?: string;
  osVersion?: string;
  appVersion?: string;
}

export interface CreateActivationChallengeCommand {
  userId: string;
  householdId: string;
  recipientId: string;
}

export interface ClaimActivationChallengeCommand {
  publicId: string;
  installationId: string;
  serverNonce: string;
  proofType: ActivationProofType;
  proof: string;
  signature: string;
  ipAddress?: string;
}

export interface ApproveActivationCommand {
  userId: string;
  challengeId: string;
  idempotencyKey: string;
  claimSnapshotToken: string;
}

export interface CancelActivationCommand {
  userId: string;
  challengeId: string;
  reasonCode?: string;
}

export interface ExchangeDeviceCredentialCommand {
  challengeId: string;
  installationId: string;
  signature: string;
  recoveryToken?: string;
}

export interface UpdateCompanionBindingCommand {
  userId: string;
  householdId: string;
  bindingId: string;
  version: number;
  displayName?: string;
  status?: 'ACTIVE' | 'SUSPENDED';
  currentPassword: string;
}

export interface RevokeCompanionBindingCommand {
  userId: string;
  householdId: string;
  bindingId: string;
  currentPassword: string;
  reasonCode?: string;
}

interface ChallengeRecord {
  id: string;
  publicId: string;
  householdId: string;
  recipientId: string;
  pendingDeviceId: string | null;
  secretHash: Uint8Array;
  codeHash: Uint8Array | null;
  status: string;
  issuedByMemberId: string;
  approvedByMemberId: string | null;
  expiresAt: Date;
  claimedAt: Date | null;
  claimNetworkSource: string | null;
  approvedAt: Date | null;
  approvalIdempotencyKey: string | null;
  consumedAt: Date | null;
  attemptCount: number;
  maxAttempts: number;
  version: number;
}

interface DeviceCredentialWithBinding {
  id: string;
  bindingId: string;
  credentialHash: Uint8Array;
  credentialFamilyId: string;
  deviceKeyThumbprint: Uint8Array;
  issuedAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  rotatedAt: Date | null;
  revokedAt: Date | null;
  binding: {
    id: string;
    deviceId: string;
    householdId: string;
    recipientId: string;
    status: string;
    bindingVersion: number;
    device: {
      id: string;
      status: string;
      installationPublicKey: Uint8Array;
      installationKeyAlgorithm: string;
    };
  };
}

interface CompletedCredentialExchange {
  credential: string;
  credentialId: string;
  credentialFamilyId: string;
  bindingId: string;
  householdId: string;
  recipientId: string;
  expiresAt: Date;
  bindingVersion: number;
}

type TransitionError =
  | 'NOT_FOUND'
  | 'EXPIRED'
  | 'ATTEMPTS_EXCEEDED'
  | 'CONSUMED'
  | 'INVALID_PROOF'
  | 'STATE_CONFLICT'
  | 'BINDING_CONFLICT'
  | 'APPROVAL_REVOKED'
  | 'APPROVAL_SNAPSHOT_CHANGED'
  | 'IDEMPOTENCY_CONFLICT'
  | 'VERSION_CONFLICT';

@Injectable()
export class DeviceActivationApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: DeviceActivationCrypto,
    private readonly accessTokens: DeviceAccessTokenService,
    @Inject(DEVICE_ACTIVATION_CLOCK) private readonly clock: ClockPort,
    @Inject(DEVICE_ACTIVATION_SECURITY_CONFIG)
    private readonly config: DeviceActivationSecurityConfig,
    private readonly mediaSecurity: RemoteMediaSecurityCoordinator,
    private readonly identity: IdentityApplicationService,
  ) {}

  async registerInstallation(
    command: RegisterDeviceInstallationCommand,
  ): Promise<DeviceInstallationView> {
    if (command.keyProtection !== DEVICE_KEY_PROTECTION.nonExportableV1) {
      throw new UnsupportedDeviceKeyProtectionException();
    }
    if (
      command.installationKeyAlgorithm !== INSTALLATION_KEY_ALGORITHM.ed25519 &&
      command.installationKeyAlgorithm !==
        INSTALLATION_KEY_ALGORITHM.ecdsaP256Sha256
    ) {
      throw new UnsupportedInstallationKeyAlgorithmException();
    }
    const parsedKey = this.crypto.parseInstallationSpki(
      command.installationPublicKeySpki,
      command.installationKeyAlgorithm,
    );
    const metadata = {
      platform: command.platform,
      installationKeyAlgorithm: command.installationKeyAlgorithm,
      keyProtection: command.keyProtection,
      manufacturer: command.manufacturer?.trim() || null,
      model: command.model?.trim() || null,
      osVersion: command.osVersion?.trim() || null,
      appVersion: command.appVersion?.trim() || null,
    };

    let device = await this.prisma.device.findUnique({
      where: { installationKeyFingerprint: parsedKey.fingerprint },
    });

    if (device) {
      device = await this.prisma.device.update({
        where: { id: device.id },
        data: metadata,
      });
    } else {
      try {
        device = await this.prisma.device.create({
          data: {
            id: ulid(),
            ...metadata,
            installationKeyFingerprint: parsedKey.fingerprint,
            installationPublicKey: parsedKey.der,
            status: DEVICE_STATUS.registered,
          },
        });
      } catch (error) {
        if (!this.isUniqueConstraintError(error)) {
          throw error;
        }
        device = await this.prisma.device.findUnique({
          where: { installationKeyFingerprint: parsedKey.fingerprint },
        });
        if (!device) {
          throw error;
        }
      }
    }

    return {
      installationId: device.id,
      keyFingerprint: Buffer.from(device.installationKeyFingerprint).toString(
        'base64url',
      ),
      serverNonce: this.crypto.installationServerNonce(
        device.id,
        device.installationKeyFingerprint,
      ),
    };
  }

  async createActivationChallenge(
    command: CreateActivationChallengeCommand,
  ): Promise<ActivationPresentation> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const now = this.clock.now();
      const challengeId = ulid(now.getTime());
      const publicId = this.crypto.generatePublicId();
      const qrSecret = this.crypto.generateActivationSecret();
      const dynamicCode = this.crypto.generateDynamicCode();
      const expiresAt = new Date(
        now.getTime() + this.config.challengeTtlSeconds * 1000,
      );

      try {
        await this.prisma.$transaction(async (transaction) => {
          const memberId = await this.requireActivationAuthority(
            transaction,
            command.userId,
            command.householdId,
            command.recipientId,
          );
          await transaction.deviceActivationChallenge.create({
            data: {
              id: challengeId,
              publicId,
              flow: 'FAMILY_INITIATED',
              householdId: command.householdId,
              recipientId: command.recipientId,
              secretHash: this.crypto.hashActivationProof(
                publicId,
                'QR_SECRET',
                qrSecret,
              ),
              codeHash: this.crypto.hashActivationProof(
                publicId,
                'DYNAMIC_CODE',
                dynamicCode,
              ),
              status: CHALLENGE_STATUS.pending,
              issuedByMemberId: memberId,
              expiresAt,
              maxAttempts: this.config.challengeMaxAttempts,
            },
          });
        });

        const query = new URLSearchParams({ publicId, secret: qrSecret });
        return {
          challengeId,
          publicId,
          dynamicCode,
          qrPayload: `memory-lighthouse://activate?${query.toString()}`,
          expiresAt: expiresAt.toISOString(),
        };
      } catch (error) {
        if (!this.isUniqueConstraintError(error) || attempt === 2) {
          throw error;
        }
      }
    }

    throw new Error('Unable to allocate a unique activation challenge');
  }

  async getPublicActivationStatus(
    challengeId: string,
  ): Promise<PublicActivationStatus> {
    const now = this.clock.now();
    const challenge = await this.prisma.$transaction(async (transaction) => {
      const record = await transaction.deviceActivationChallenge.findUnique({
        where: { id: challengeId },
      });
      if (!record) {
        return null;
      }
      if (this.isExpirable(record.status) && record.expiresAt <= now) {
        await transaction.deviceActivationChallenge.updateMany({
          where: { id: record.id, version: record.version },
          data: {
            status: CHALLENGE_STATUS.expired,
            version: { increment: 1 },
          },
        });
        return { ...record, status: CHALLENGE_STATUS.expired };
      }
      return record;
    });

    if (!challenge) {
      throw new ActivationNotFoundException();
    }
    const recovery =
      challenge.status === CHALLENGE_STATUS.consumed &&
      challenge.pendingDeviceId &&
      challenge.approvedAt
        ? this.crypto.issueCredentialRecoveryToken({
            challengeId: challenge.id,
            installationId: challenge.pendingDeviceId,
            challengeVersion: challenge.version,
            approvedAt: challenge.approvedAt.toISOString(),
            now,
          })
        : null;
    return {
      status: challenge.status,
      expiresAt: challenge.expiresAt.toISOString(),
      claimedAt: challenge.claimedAt?.toISOString() ?? null,
      approvedAt: challenge.approvedAt?.toISOString() ?? null,
      recoveryToken: recovery?.token ?? null,
      recoveryTokenExpiresAt: recovery?.expiresAt.toISOString() ?? null,
    };
  }

  async claimActivationChallenge(
    command: ClaimActivationChallengeCommand,
  ): Promise<{ claimed: true; challengeId: string }> {
    const now = this.clock.now();
    const claimNetworkSource = classifyClaimNetworkSource(command.ipAddress);
    const result = await this.prisma.$transaction(async (transaction) => {
      const challenge = (await transaction.deviceActivationChallenge.findUnique(
        {
          where: { publicId: command.publicId },
        },
      )) as ChallengeRecord | null;
      if (!challenge) {
        return { error: 'NOT_FOUND' as const };
      }

      const terminalError = await this.expireOrGetTerminalError(
        transaction,
        challenge,
        now,
      );
      if (terminalError) {
        return { error: terminalError };
      }
      if (challenge.status !== CHALLENGE_STATUS.pending) {
        return { error: 'STATE_CONFLICT' as const };
      }

      const device = await transaction.device.findUnique({
        where: {
          id: command.installationId,
          keyProtection: DEVICE_KEY_PROTECTION.nonExportableV1,
          installationKeyAlgorithm: {
            in: [
              INSTALLATION_KEY_ALGORITHM.ed25519,
              INSTALLATION_KEY_ALGORITHM.ecdsaP256Sha256,
            ],
          },
        },
      });
      const normalizedProof = this.crypto.normalizeProof(
        command.proofType,
        command.proof,
      );
      const submittedHash = this.crypto.hashActivationProof(
        challenge.publicId,
        command.proofType,
        normalizedProof,
      );
      const storedHash =
        command.proofType === 'QR_SECRET'
          ? challenge.secretHash
          : challenge.codeHash;
      const proofMatches = this.crypto.equalHash(submittedHash, storedHash);

      let installationProofValid = false;
      if (device && device.status !== DEVICE_STATUS.revoked) {
        const expectedNonce = this.crypto.installationServerNonce(
          device.id,
          device.installationKeyFingerprint,
        );
        const nonceMatches = this.crypto.equalText(
          command.serverNonce,
          expectedNonce,
        );
        const message = buildClaimProofMessage({
          publicId: challenge.publicId,
          installationId: command.installationId,
          serverNonce: command.serverNonce,
          proofType: command.proofType,
          proofDigest: this.crypto.digestProof(
            command.proofType,
            normalizedProof,
          ),
        });
        installationProofValid =
          nonceMatches &&
          this.crypto.verifyInstallationSignature(
            device.installationKeyAlgorithm,
            device.installationPublicKey,
            message,
            command.signature,
          );
      }

      if (!proofMatches || !installationProofValid || !device) {
        const nextAttemptCount = challenge.attemptCount + 1;
        const exceeded = nextAttemptCount >= challenge.maxAttempts;
        const update = await transaction.deviceActivationChallenge.updateMany({
          where: {
            id: challenge.id,
            version: challenge.version,
            status: CHALLENGE_STATUS.pending,
          },
          data: {
            attemptCount: { increment: 1 },
            status: exceeded
              ? CHALLENGE_STATUS.attemptsExceeded
              : CHALLENGE_STATUS.pending,
            version: { increment: 1 },
          },
        });
        if (update.count !== 1) {
          return { error: 'STATE_CONFLICT' as const };
        }
        return {
          error: exceeded
            ? ('ATTEMPTS_EXCEEDED' as const)
            : ('INVALID_PROOF' as const),
        };
      }

      const update = await transaction.deviceActivationChallenge.updateMany({
        where: {
          id: challenge.id,
          version: challenge.version,
          status: CHALLENGE_STATUS.pending,
        },
        data: {
          pendingDeviceId: device.id,
          claimNetworkSource,
          status: CHALLENGE_STATUS.claimed,
          claimedAt: now,
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) {
        return { error: 'STATE_CONFLICT' as const };
      }
      await this.appendOutbox(transaction, {
        aggregateId: challenge.id,
        eventType: 'activation.claimed',
        occurredAt: now,
        payload: {
          challengeId: challenge.id,
          householdId: challenge.householdId,
          recipientId: challenge.recipientId,
        },
      });
      return { challengeId: challenge.id };
    });

    if ('error' in result) {
      this.throwTransitionError(result.error!);
    }
    return { claimed: true, challengeId: result.challengeId };
  }

  async getActivationApprovalDetails(command: {
    userId: string;
    challengeId: string;
  }): Promise<ActivationApprovalDetails> {
    const now = this.clock.now();
    const result = await this.prisma.$transaction(async (transaction) => {
      const challenge = (await transaction.deviceActivationChallenge.findUnique(
        { where: { id: command.challengeId } },
      )) as ChallengeRecord | null;
      if (!challenge) return { error: 'NOT_FOUND' as const };

      await this.requireActivationAuthority(
        transaction,
        command.userId,
        challenge.householdId,
        challenge.recipientId,
      );
      const terminalError = await this.expireOrGetTerminalError(
        transaction,
        challenge,
        now,
      );
      if (terminalError) return { error: terminalError };
      if (
        challenge.status !== CHALLENGE_STATUS.claimed ||
        !challenge.pendingDeviceId ||
        !challenge.claimedAt
      ) {
        return { error: 'STATE_CONFLICT' as const };
      }

      const device = await transaction.device.findUnique({
        where: {
          id: challenge.pendingDeviceId,
          keyProtection: DEVICE_KEY_PROTECTION.nonExportableV1,
          installationKeyAlgorithm: {
            in: [
              INSTALLATION_KEY_ALGORITHM.ed25519,
              INSTALLATION_KEY_ALGORITHM.ecdsaP256Sha256,
            ],
          },
        },
      });
      if (!device || device.status === DEVICE_STATUS.revoked) {
        return { error: 'STATE_CONFLICT' as const };
      }
      const claimNetworkSource = normalizeClaimNetworkSource(
        challenge.claimNetworkSource,
      );
      const claimSnapshotToken = this.crypto.approvalSnapshotToken({
        challengeId: challenge.id,
        challengeVersion: challenge.version,
        pendingDeviceId: challenge.pendingDeviceId,
        deviceKeyFingerprint: device.installationKeyFingerprint,
        deviceMetadata: {
          platform: device.platform,
          installationKeyAlgorithm: device.installationKeyAlgorithm,
          manufacturer: device.manufacturer,
          model: device.model,
          osVersion: device.osVersion,
          appVersion: device.appVersion,
        },
        claimedAt: challenge.claimedAt,
        claimNetworkSource,
      });
      const encodedFingerprint = Buffer.from(
        device.installationKeyFingerprint,
      ).toString('base64url');
      return {
        details: {
          challengeId: challenge.id,
          status: 'CLAIMED' as const,
          expiresAt: challenge.expiresAt.toISOString(),
          claimedAt: challenge.claimedAt.toISOString(),
          claimNetworkSource,
          claimSnapshotToken,
          device: {
            platform: device.platform,
            installationKeyAlgorithm:
              device.installationKeyAlgorithm as InstallationKeyAlgorithm,
            manufacturer: device.manufacturer,
            model: device.model,
            osVersion: device.osVersion,
            appVersion: device.appVersion,
            keyFingerprintSuffix: encodedFingerprint.slice(-8),
          },
        },
      };
    });

    if ('error' in result) this.throwTransitionError(result.error!);
    return result.details;
  }

  async approveActivation(
    command: ApproveActivationCommand,
  ): Promise<{ approved: true; approvedAt: string }> {
    const idempotencyKey = command.idempotencyKey.trim();
    if (
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 100 ||
      /[\r\n]/.test(idempotencyKey)
    ) {
      throw new ActivationIdempotencyKeyException();
    }
    const now = this.clock.now();
    let result;
    try {
      result = await this.prisma.$transaction(async (transaction) => {
        const challenge =
          (await transaction.deviceActivationChallenge.findUnique({
            where: { id: command.challengeId },
          })) as ChallengeRecord | null;
        if (!challenge) {
          return { error: 'NOT_FOUND' as const };
        }
        const memberId = await this.requireActivationAuthority(
          transaction,
          command.userId,
          challenge.householdId,
          challenge.recipientId,
        );
        if (
          challenge.approvalIdempotencyKey === idempotencyKey &&
          challenge.approvedAt &&
          (challenge.status === CHALLENGE_STATUS.approved ||
            challenge.status === CHALLENGE_STATUS.consumed)
        ) {
          return { approvedAt: challenge.approvedAt };
        }
        const idempotencyReplay =
          await transaction.deviceActivationChallenge.findUnique({
            where: { approvalIdempotencyKey: idempotencyKey },
            select: { id: true },
          });
        if (idempotencyReplay) {
          return { error: 'IDEMPOTENCY_CONFLICT' as const };
        }
        const terminalError = await this.expireOrGetTerminalError(
          transaction,
          challenge,
          now,
        );
        if (terminalError) {
          return { error: terminalError };
        }
        if (
          challenge.status !== CHALLENGE_STATUS.claimed ||
          !challenge.pendingDeviceId ||
          !challenge.claimedAt
        ) {
          return { error: 'STATE_CONFLICT' as const };
        }
        const device = await transaction.device.findUnique({
          where: {
            id: challenge.pendingDeviceId,
            keyProtection: DEVICE_KEY_PROTECTION.nonExportableV1,
            installationKeyAlgorithm: {
              in: [
                INSTALLATION_KEY_ALGORITHM.ed25519,
                INSTALLATION_KEY_ALGORITHM.ecdsaP256Sha256,
              ],
            },
          },
        });
        if (!device || device.status === DEVICE_STATUS.revoked) {
          return { error: 'STATE_CONFLICT' as const };
        }
        const expectedSnapshotToken = this.crypto.approvalSnapshotToken({
          challengeId: challenge.id,
          challengeVersion: challenge.version,
          pendingDeviceId: challenge.pendingDeviceId,
          deviceKeyFingerprint: device.installationKeyFingerprint,
          deviceMetadata: {
            platform: device.platform,
            installationKeyAlgorithm: device.installationKeyAlgorithm,
            manufacturer: device.manufacturer,
            model: device.model,
            osVersion: device.osVersion,
            appVersion: device.appVersion,
          },
          claimedAt: challenge.claimedAt,
          claimNetworkSource: normalizeClaimNetworkSource(
            challenge.claimNetworkSource,
          ),
        });
        if (
          !this.crypto.equalText(
            command.claimSnapshotToken,
            expectedSnapshotToken,
          )
        ) {
          return { error: 'APPROVAL_SNAPSHOT_CHANGED' as const };
        }
        const update = await transaction.deviceActivationChallenge.updateMany({
          where: {
            id: challenge.id,
            version: challenge.version,
            status: CHALLENGE_STATUS.claimed,
          },
          data: {
            status: CHALLENGE_STATUS.approved,
            approvedByMemberId: memberId,
            approvedAt: now,
            approvalIdempotencyKey: idempotencyKey,
            version: { increment: 1 },
          },
        });
        if (update.count !== 1) {
          return { error: 'STATE_CONFLICT' as const };
        }
        await this.appendOutbox(transaction, {
          aggregateId: challenge.id,
          eventType: 'activation.approved',
          occurredAt: now,
          payload: {
            challengeId: challenge.id,
            deviceId: challenge.pendingDeviceId,
          },
        });
        return { approvedAt: now };
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ActivationIdempotencyConflictException();
      }
      throw error;
    }

    if ('error' in result) {
      this.throwTransitionError(result.error!);
    }
    return { approved: true, approvedAt: result.approvedAt.toISOString() };
  }

  async cancelActivation(
    command: CancelActivationCommand,
  ): Promise<{ cancelled: true }> {
    const now = this.clock.now();
    const result = await this.prisma.$transaction(async (transaction) => {
      const challenge = (await transaction.deviceActivationChallenge.findUnique(
        {
          where: { id: command.challengeId },
        },
      )) as ChallengeRecord | null;
      if (!challenge) {
        return { error: 'NOT_FOUND' as const };
      }
      await this.requireActivationAuthority(
        transaction,
        command.userId,
        challenge.householdId,
        challenge.recipientId,
      );
      const terminalError = await this.expireOrGetTerminalError(
        transaction,
        challenge,
        now,
      );
      if (terminalError) {
        return { error: terminalError };
      }
      const update = await transaction.deviceActivationChallenge.updateMany({
        where: { id: challenge.id, version: challenge.version },
        data: {
          status: CHALLENGE_STATUS.cancelled,
          version: { increment: 1 },
        },
      });
      return update.count === 1
        ? { cancelled: true as const }
        : { error: 'STATE_CONFLICT' as const };
    });

    if ('error' in result) {
      this.throwTransitionError(result.error!);
    }
    return { cancelled: true };
  }

  async exchangeDeviceCredential(
    command: ExchangeDeviceCredentialCommand,
  ): Promise<DeviceCredentialPresentation> {
    const now = this.clock.now();
    const credentialId = ulid(now.getTime());
    const credentialFamilyId = ulid(now.getTime());
    const bindingId = ulid(now.getTime());
    const expiresAt = new Date(
      now.getTime() + this.config.credentialTtlSeconds * 1000,
    );

    const result = await this.serializable(async (transaction) => {
      const challenge = (await transaction.deviceActivationChallenge.findUnique(
        {
          where: { id: command.challengeId },
        },
      )) as ChallengeRecord | null;
      if (!challenge) {
        return { error: 'NOT_FOUND' as const };
      }
      if (challenge.status === CHALLENGE_STATUS.consumed) {
        const replay = await this.recoverConsumedCredentialExchange(
          transaction,
          challenge,
          command,
          now,
        );
        if (replay) return replay;
        return { error: 'CONSUMED' as const };
      }
      const terminalError = await this.expireOrGetTerminalError(
        transaction,
        challenge,
        now,
      );
      if (terminalError) {
        return { error: terminalError };
      }
      if (
        challenge.status !== CHALLENGE_STATUS.approved ||
        !challenge.pendingDeviceId ||
        !challenge.approvedAt ||
        !challenge.approvedByMemberId ||
        challenge.pendingDeviceId !== command.installationId
      ) {
        return { error: 'STATE_CONFLICT' as const };
      }

      // Approval is a point-in-time decision, not a bearer capability. The
      // exchange re-checks every mutable authorization input so a removed
      // member or suspended household cannot activate a device later.
      const approvalAuthority = await transaction.recipientMember.findFirst({
        where: {
          householdId: challenge.householdId,
          recipientId: challenge.recipientId,
          householdMemberId: challenge.approvedByMemberId,
          status: 'ACTIVE',
          canActivateDevice: true,
          member: {
            status: 'ACTIVE',
            household: { status: 'ACTIVE' },
            user: {
              status: 'ACTIVE',
              deletedAt: null,
              loginIdentities: {
                some: { type: 'EMAIL', verifiedAt: { not: null } },
              },
            },
          },
          recipient: { status: 'ACTIVE', deletedAt: null },
        },
        select: { householdMemberId: true },
      });
      if (!approvalAuthority) {
        return { error: 'APPROVAL_REVOKED' as const };
      }

      const device = await transaction.device.findUnique({
        where: {
          id: command.installationId,
          keyProtection: DEVICE_KEY_PROTECTION.nonExportableV1,
          installationKeyAlgorithm: {
            in: [
              INSTALLATION_KEY_ALGORITHM.ed25519,
              INSTALLATION_KEY_ALGORITHM.ecdsaP256Sha256,
            ],
          },
        },
      });
      if (!device || device.status === DEVICE_STATUS.revoked) {
        return { error: 'INVALID_PROOF' as const };
      }
      const proofValid = this.crypto.verifyInstallationSignature(
        device.installationKeyAlgorithm,
        device.installationPublicKey,
        buildExchangeProofMessage({
          challengeId: challenge.id,
          installationId: device.id,
          approvedAt: challenge.approvedAt.toISOString(),
        }),
        command.signature,
      );
      if (!proofValid) {
        return { error: 'INVALID_PROOF' as const };
      }
      const rawCredential = this.crypto.deriveInitialCredential({
        challengeId: challenge.id,
        installationId: device.id,
        approvedAt: challenge.approvedAt.toISOString(),
      });
      const credentialHash = this.crypto.hashCredential(rawCredential);
      const existingBinding = await transaction.companionBinding.findUnique({
        where: { deviceId: device.id },
      });
      if (existingBinding) {
        return { error: 'BINDING_CONFLICT' as const };
      }

      const consumed = await transaction.deviceActivationChallenge.updateMany({
        where: {
          id: challenge.id,
          version: challenge.version,
          status: CHALLENGE_STATUS.approved,
        },
        data: {
          status: CHALLENGE_STATUS.consumed,
          consumedAt: now,
          version: { increment: 1 },
        },
      });
      if (consumed.count !== 1) {
        return { error: 'STATE_CONFLICT' as const };
      }

      await transaction.companionBinding.create({
        data: {
          id: bindingId,
          deviceId: device.id,
          householdId: challenge.householdId,
          recipientId: challenge.recipientId,
          displayName: device.model?.trim() || '守忆灯塔陪伴设备',
          status: BINDING_STATUS.active,
          activatedByMemberId: challenge.approvedByMemberId,
          activatedAt: now,
        },
      });
      await transaction.deviceCredential.create({
        data: {
          id: credentialId,
          bindingId,
          credentialHash,
          credentialFamilyId,
          deviceKeyThumbprint: device.installationKeyFingerprint,
          issuedAt: now,
          expiresAt,
        },
      });
      await transaction.deviceBindingEvent.create({
        data: {
          id: ulid(now.getTime()),
          bindingId,
          eventType: 'ACTIVATED',
          actorType: 'USER',
          actorId: challenge.approvedByMemberId,
          occurredAt: now,
        },
      });
      await transaction.device.update({
        where: { id: device.id },
        data: { status: DEVICE_STATUS.active, lastSeenAt: now },
      });
      await this.appendOutbox(transaction, {
        aggregateId: bindingId,
        eventType: 'device.activated',
        occurredAt: now,
        payload: {
          bindingId,
          householdId: challenge.householdId,
          recipientId: challenge.recipientId,
        },
      });
      return {
        credential: rawCredential,
        credentialId,
        credentialFamilyId,
        bindingId,
        householdId: challenge.householdId,
        recipientId: challenge.recipientId,
        expiresAt,
        bindingVersion: 1,
      };
    }).catch((error: unknown) => {
      if (this.isUniqueConstraintError(error)) {
        throw new CompanionBindingConflictException();
      }
      throw error;
    });

    if ('error' in result) {
      this.throwTransitionError(result.error);
    }
    const access = this.accessTokens.issue({
      credentialId: result.credentialId,
      credentialFamilyId: result.credentialFamilyId,
      deviceId: command.installationId,
      bindingId: result.bindingId,
      householdId: result.householdId,
      recipientId: result.recipientId,
      bindingVersion: result.bindingVersion,
    });
    return {
      credential: result.credential,
      credentialId: result.credentialId,
      credentialFamilyId: result.credentialFamilyId,
      bindingId: result.bindingId,
      householdId: result.householdId,
      recipientId: result.recipientId,
      expiresAt: result.expiresAt.toISOString(),
      ...access,
    };
  }

  private async recoverConsumedCredentialExchange(
    transaction: Prisma.TransactionClient,
    challenge: ChallengeRecord,
    command: ExchangeDeviceCredentialCommand,
    now: Date,
  ): Promise<CompletedCredentialExchange | null> {
    const recoveryToken = command.recoveryToken;
    if (
      !recoveryToken ||
      !challenge.pendingDeviceId ||
      challenge.pendingDeviceId !== command.installationId ||
      !challenge.approvedAt
    ) {
      return null;
    }
    const approvedAt = challenge.approvedAt.toISOString();
    if (
      !this.crypto.verifyCredentialRecoveryToken({
        token: recoveryToken,
        challengeId: challenge.id,
        installationId: command.installationId,
        challengeVersion: challenge.version,
        approvedAt,
        now,
      })
    ) {
      return null;
    }
    const device = await transaction.device.findUnique({
      where: {
        id: command.installationId,
        status: DEVICE_STATUS.active,
        keyProtection: DEVICE_KEY_PROTECTION.nonExportableV1,
        installationKeyAlgorithm: {
          in: [
            INSTALLATION_KEY_ALGORITHM.ed25519,
            INSTALLATION_KEY_ALGORITHM.ecdsaP256Sha256,
          ],
        },
      },
    });
    if (!device) return null;
    const proofValid = this.crypto.verifyInstallationSignature(
      device.installationKeyAlgorithm,
      device.installationPublicKey,
      buildExchangeRecoveryProofMessage({
        challengeId: challenge.id,
        installationId: device.id,
        recoveryToken,
      }),
      command.signature,
    );
    if (!proofValid) return null;

    const rawCredential = this.crypto.deriveInitialCredential({
      challengeId: challenge.id,
      installationId: device.id,
      approvedAt,
    });
    const credentialHash = this.crypto.hashCredential(rawCredential);
    const binding = await transaction.companionBinding.findUnique({
      where: { deviceId: device.id },
    });
    if (
      !binding ||
      binding.status !== BINDING_STATUS.active ||
      binding.revokedAt ||
      binding.householdId !== challenge.householdId ||
      binding.recipientId !== challenge.recipientId
    ) {
      return null;
    }
    const credential = await transaction.deviceCredential.findFirst({
      where: {
        bindingId: binding.id,
        credentialHash,
        rotatedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
    });
    if (
      !credential ||
      !this.crypto.equalHash(
        device.installationKeyFingerprint,
        credential.deviceKeyThumbprint,
      )
    ) {
      return null;
    }
    const consumed = await transaction.deviceActivationChallenge.updateMany({
      where: {
        id: challenge.id,
        status: CHALLENGE_STATUS.consumed,
        version: challenge.version,
      },
      data: { version: { increment: 1 } },
    });
    if (consumed.count !== 1) return null;
    return {
      credential: rawCredential,
      credentialId: credential.id,
      credentialFamilyId: credential.credentialFamilyId,
      bindingId: binding.id,
      householdId: binding.householdId,
      recipientId: binding.recipientId,
      expiresAt: credential.expiresAt,
      bindingVersion: binding.bindingVersion,
    };
  }

  async resolveDevicePrincipal(accessToken: string): Promise<DevicePrincipal> {
    const now = this.clock.now();
    const principal = this.accessTokens.verify(accessToken);
    if (!principal) {
      throw new InvalidDeviceCredentialException();
    }
    const [binding, liveCredential] = await Promise.all([
      this.prisma.companionBinding.findFirst({
        where: {
          id: principal.bindingId,
          deviceId: principal.deviceId,
          householdId: principal.householdId,
          recipientId: principal.recipientId,
          bindingVersion: principal.bindingVersion,
          status: BINDING_STATUS.active,
          revokedAt: null,
          device: {
            status: DEVICE_STATUS.active,
            keyProtection: DEVICE_KEY_PROTECTION.nonExportableV1,
            installationKeyAlgorithm: {
              in: [
                INSTALLATION_KEY_ALGORITHM.ed25519,
                INSTALLATION_KEY_ALGORITHM.ecdsaP256Sha256,
              ],
            },
          },
          household: { status: 'ACTIVE' },
          recipient: { status: 'ACTIVE', deletedAt: null },
        },
        select: { id: true },
      }),
      this.prisma.deviceCredential.findFirst({
        where: {
          bindingId: principal.bindingId,
          credentialFamilyId: principal.credentialFamilyId,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        select: { id: true },
      }),
    ]);
    if (!binding) {
      throw new DeviceRevokedException();
    }
    if (!liveCredential) {
      throw new InvalidDeviceCredentialException();
    }
    return principal;
  }

  async rotateDeviceCredential(
    rawCredential: string,
    signature: string,
  ): Promise<DeviceCredentialPresentation> {
    const now = this.clock.now();
    const candidateHash = this.crypto.hashCredential(rawCredential);
    const nextRawCredential = this.crypto.generateCredential();
    const nextCredentialHash = this.crypto.hashCredential(nextRawCredential);
    const nextCredentialId = ulid(now.getTime());
    const expiresAt = new Date(
      now.getTime() + this.config.credentialTtlSeconds * 1000,
    );

    const result = await this.serializable(async (transaction) => {
      const credential = (await transaction.deviceCredential.findFirst({
        where: {
          credentialHash: candidateHash,
          binding: {
            device: {
              keyProtection: DEVICE_KEY_PROTECTION.nonExportableV1,
              installationKeyAlgorithm: {
                in: [
                  INSTALLATION_KEY_ALGORITHM.ed25519,
                  INSTALLATION_KEY_ALGORITHM.ecdsaP256Sha256,
                ],
              },
            },
          },
        },
        include: { binding: { include: { device: true } } },
      })) as DeviceCredentialWithBinding | null;
      if (
        !credential ||
        !this.crypto.equalHash(candidateHash, credential.credentialHash)
      ) {
        return { error: 'INVALID' as const };
      }
      // A stale raw credential is not sufficient authority to revoke its
      // successor family. Authenticate proof-of-possession with the persisted
      // non-exportable installation key before every replay response that
      // performs destructive writes.
      const proofValid = this.crypto.verifyInstallationSignature(
        credential.binding.device.installationKeyAlgorithm,
        credential.binding.device.installationPublicKey,
        buildRefreshProofMessage({
          credentialId: credential.id,
          bindingId: credential.binding.id,
          credentialDigest: this.crypto.digestCredential(rawCredential),
        }),
        signature,
      );
      if (!proofValid) {
        return { error: 'INVALID' as const };
      }
      if (credential.rotatedAt) {
        await transaction.deviceCredential.updateMany({
          where: { credentialFamilyId: credential.credentialFamilyId },
          data: { revokedAt: now },
        });
        return { error: 'REPLAYED' as const };
      }
      if (
        credential.binding.status !== BINDING_STATUS.active ||
        credential.binding.device.status !== DEVICE_STATUS.active
      ) {
        return { error: 'REVOKED' as const };
      }
      if (credential.revokedAt || credential.expiresAt <= now) {
        return { error: 'INVALID' as const };
      }

      const rotated = await transaction.deviceCredential.updateMany({
        where: { id: credential.id, rotatedAt: null, revokedAt: null },
        data: { rotatedAt: now, lastUsedAt: now },
      });
      if (rotated.count !== 1) {
        await transaction.deviceCredential.updateMany({
          where: { credentialFamilyId: credential.credentialFamilyId },
          data: { revokedAt: now },
        });
        return { error: 'REPLAYED' as const };
      }
      await transaction.deviceCredential.create({
        data: {
          id: nextCredentialId,
          bindingId: credential.bindingId,
          credentialHash: nextCredentialHash,
          credentialFamilyId: credential.credentialFamilyId,
          deviceKeyThumbprint: Uint8Array.from(credential.deviceKeyThumbprint),
          issuedAt: now,
          expiresAt,
        },
      });
      return { credential };
    });

    if ('error' in result) {
      if (result.error === 'REPLAYED') {
        throw new DeviceCredentialReplayedException();
      }
      if (result.error === 'REVOKED') {
        throw new DeviceRevokedException();
      }
      throw new InvalidDeviceCredentialException();
    }
    const current = result.credential;
    const access = this.accessTokens.issue({
      credentialId: nextCredentialId,
      credentialFamilyId: current.credentialFamilyId,
      deviceId: current.binding.deviceId,
      bindingId: current.binding.id,
      householdId: current.binding.householdId,
      recipientId: current.binding.recipientId,
      bindingVersion: current.binding.bindingVersion,
    });
    return {
      credential: nextRawCredential,
      credentialId: nextCredentialId,
      credentialFamilyId: current.credentialFamilyId,
      bindingId: current.binding.id,
      householdId: current.binding.householdId,
      recipientId: current.binding.recipientId,
      expiresAt: expiresAt.toISOString(),
      ...access,
    };
  }

  async listCompanionBindings(
    userId: string,
    householdId: string,
  ): Promise<CompanionBindingView[]> {
    const authorities = await this.prisma.recipientMember.findMany({
      where: {
        householdId,
        status: 'ACTIVE',
        canActivateDevice: true,
        member: { userId, status: 'ACTIVE' },
      },
      select: { recipientId: true },
    });
    if (authorities.length === 0) {
      return [];
    }
    const bindings = await this.prisma.companionBinding.findMany({
      where: {
        householdId,
        recipientId: { in: authorities.map(({ recipientId }) => recipientId) },
      },
      orderBy: { createdAt: 'desc' },
    });
    return bindings.map((binding) => this.toBindingView(binding));
  }

  async updateCompanionBinding(
    command: UpdateCompanionBindingCommand,
  ): Promise<CompanionBindingView> {
    await this.identity.reauthenticateUser(
      command.userId,
      command.currentPassword,
    );
    const now = this.clock.now();
    const result = await this.serializable(async (transaction) => {
      const binding = await transaction.companionBinding.findFirst({
        where: { id: command.bindingId, householdId: command.householdId },
      });
      if (!binding) {
        throw new CompanionBindingNotFoundException();
      }
      const memberId = await this.requireActivationAuthority(
        transaction,
        command.userId,
        binding.householdId,
        binding.recipientId,
      );
      if (binding.status === BINDING_STATUS.revoked) {
        throw new DeviceRevokedException();
      }
      const statusChanged =
        command.status !== undefined && command.status !== binding.status;
      const update = await transaction.companionBinding.updateMany({
        where: {
          id: binding.id,
          householdId: command.householdId,
          version: command.version,
        },
        data: {
          ...(command.displayName !== undefined
            ? { displayName: command.displayName.trim() }
            : {}),
          ...(command.status !== undefined ? { status: command.status } : {}),
          ...(statusChanged ? { bindingVersion: { increment: 1 } } : {}),
          version: { increment: 1 },
        },
      });
      if (update.count !== 1) {
        return { error: 'VERSION_CONFLICT' as const };
      }
      if (statusChanged) {
        await transaction.deviceBindingEvent.create({
          data: {
            id: ulid(now.getTime()),
            bindingId: binding.id,
            eventType:
              command.status === BINDING_STATUS.active
                ? 'RESUMED'
                : 'SUSPENDED',
            actorType: 'USER',
            actorId: memberId,
            occurredAt: now,
          },
        });
      }
      const suspendsMedia =
        statusChanged && command.status === BINDING_STATUS.suspended;
      if (suspendsMedia) {
        await this.mediaSecurity.markBindingRevoked(
          transaction,
          binding.id,
          'DEVICE_BINDING_SUSPENDED',
          now,
        );
        await this.mediaSecurity.markCompanionBindingRevoked(
          transaction,
          binding.id,
          'DEVICE_BINDING_SUSPENDED',
          now,
        );
      }
      const updated = await transaction.companionBinding.findUnique({
        where: { id: binding.id },
      });
      return updated
        ? { binding: updated, suspendsMedia }
        : { error: 'VERSION_CONFLICT' as const };
    });

    if ('error' in result) {
      this.throwTransitionError(result.error!);
    }
    if (result.suspendsMedia) {
      await Promise.all([
        this.mediaSecurity.cleanupPendingForBinding(command.bindingId),
        this.mediaSecurity.cleanupCompanionLeasesForBinding(command.bindingId),
      ]);
    }
    return this.toBindingView(result.binding);
  }

  async revokeCompanionBinding(
    command: RevokeCompanionBindingCommand,
  ): Promise<{ revoked: true }> {
    await this.identity.reauthenticateUser(
      command.userId,
      command.currentPassword,
    );
    const now = this.clock.now();
    await this.serializable(async (transaction) => {
      const binding = await transaction.companionBinding.findFirst({
        where: { id: command.bindingId, householdId: command.householdId },
      });
      if (!binding) {
        throw new CompanionBindingNotFoundException();
      }
      const memberId = await this.requireActivationAuthority(
        transaction,
        command.userId,
        binding.householdId,
        binding.recipientId,
      );
      if (binding.status === BINDING_STATUS.revoked) {
        await this.mediaSecurity.markBindingRevoked(
          transaction,
          binding.id,
          'DEVICE_BINDING_REVOKED',
          now,
        );
        await this.mediaSecurity.markCompanionBindingRevoked(
          transaction,
          binding.id,
          'DEVICE_BINDING_REVOKED',
          now,
        );
        return;
      }
      await transaction.companionBinding.update({
        where: { id: binding.id },
        data: {
          status: BINDING_STATUS.revoked,
          revokedAt: now,
          bindingVersion: { increment: 1 },
          version: { increment: 1 },
        },
      });
      await transaction.deviceCredential.updateMany({
        where: { bindingId: binding.id, revokedAt: null },
        data: { revokedAt: now },
      });
      await transaction.device.update({
        where: { id: binding.deviceId },
        data: { status: DEVICE_STATUS.revoked },
      });
      await transaction.deviceBindingEvent.create({
        data: {
          id: ulid(now.getTime()),
          bindingId: binding.id,
          eventType: 'REVOKED',
          actorType: 'USER',
          actorId: memberId,
          reasonCode: command.reasonCode?.trim() || null,
          occurredAt: now,
        },
      });
      await this.appendOutbox(transaction, {
        aggregateId: binding.id,
        eventType: 'device.revoked',
        occurredAt: now,
        payload: {
          bindingId: binding.id,
          householdId: binding.householdId,
          recipientId: binding.recipientId,
        },
      });
      await this.mediaSecurity.markBindingRevoked(
        transaction,
        binding.id,
        'DEVICE_BINDING_REVOKED',
        now,
      );
      await this.mediaSecurity.markCompanionBindingRevoked(
        transaction,
        binding.id,
        'DEVICE_BINDING_REVOKED',
        now,
      );
    });
    await Promise.all([
      this.mediaSecurity.cleanupPendingForBinding(command.bindingId),
      this.mediaSecurity.cleanupCompanionLeasesForBinding(command.bindingId),
    ]);
    return { revoked: true };
  }

  private async requireActivationAuthority(
    client: DatabaseClient,
    userId: string,
    householdId: string,
    recipientId: string,
  ): Promise<string> {
    const authority = await client.recipientMember.findFirst({
      where: {
        householdId,
        recipientId,
        status: 'ACTIVE',
        canActivateDevice: true,
        member: {
          userId,
          status: 'ACTIVE',
          household: { status: 'ACTIVE' },
          user: {
            status: 'ACTIVE',
            deletedAt: null,
            loginIdentities: {
              some: { type: 'EMAIL', verifiedAt: { not: null } },
            },
          },
        },
        recipient: { status: 'ACTIVE', deletedAt: null },
      },
      select: { householdMemberId: true },
    });
    if (!authority) {
      throw new RecipientActivationDeniedException();
    }
    return authority.householdMemberId;
  }

  private async serializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        if (attempt === SERIALIZABLE_RETRY_LIMIT || !isRetryable(error)) {
          throw error;
        }
      }
    }
    throw new Error('Serializable device activation transaction exhausted');
  }

  private async expireOrGetTerminalError(
    transaction: Prisma.TransactionClient,
    challenge: ChallengeRecord,
    now: Date,
  ): Promise<TransitionError | null> {
    if (challenge.status === CHALLENGE_STATUS.expired) {
      return 'EXPIRED';
    }
    if (challenge.status === CHALLENGE_STATUS.attemptsExceeded) {
      return 'ATTEMPTS_EXCEEDED';
    }
    if (
      challenge.status === CHALLENGE_STATUS.consumed ||
      challenge.status === CHALLENGE_STATUS.cancelled
    ) {
      return 'CONSUMED';
    }
    if (this.isExpirable(challenge.status) && challenge.expiresAt <= now) {
      await transaction.deviceActivationChallenge.updateMany({
        where: { id: challenge.id, version: challenge.version },
        data: {
          status: CHALLENGE_STATUS.expired,
          version: { increment: 1 },
        },
      });
      return 'EXPIRED';
    }
    return null;
  }

  private isExpirable(status: string): boolean {
    return (
      status === CHALLENGE_STATUS.pending ||
      status === CHALLENGE_STATUS.claimed ||
      status === CHALLENGE_STATUS.approved
    );
  }

  private async appendOutbox(
    transaction: Prisma.TransactionClient,
    event: {
      aggregateId: string;
      eventType: string;
      occurredAt: Date;
      payload: Prisma.InputJsonObject;
    },
  ): Promise<void> {
    await transaction.outboxEvent.create({
      data: {
        id: ulid(event.occurredAt.getTime()),
        aggregateType: 'DEVICE_ACTIVATION',
        aggregateId: event.aggregateId,
        eventType: event.eventType,
        payloadJson: event.payload,
        occurredAt: event.occurredAt,
        availableAt: event.occurredAt,
      },
    });
  }

  private throwTransitionError(error: TransitionError): never {
    switch (error) {
      case 'NOT_FOUND':
        throw new ActivationNotFoundException();
      case 'EXPIRED':
        throw new ActivationExpiredException();
      case 'ATTEMPTS_EXCEEDED':
        throw new ActivationAttemptsExceededException();
      case 'CONSUMED':
        throw new ActivationAlreadyConsumedException();
      case 'INVALID_PROOF':
        throw new ActivationProofInvalidException();
      case 'BINDING_CONFLICT':
        throw new CompanionBindingConflictException();
      case 'APPROVAL_REVOKED':
        throw new ActivationApprovalRevokedException();
      case 'APPROVAL_SNAPSHOT_CHANGED':
        throw new ActivationApprovalSnapshotChangedException();
      case 'IDEMPOTENCY_CONFLICT':
        throw new ActivationIdempotencyConflictException();
      case 'VERSION_CONFLICT':
        throw new VersionConflictException();
      case 'STATE_CONFLICT':
        throw new ActivationStateConflictException('正确的前置');
    }
  }

  private toBindingView(binding: {
    id: string;
    deviceId: string;
    householdId: string;
    recipientId: string;
    displayName: string;
    status: string;
    activatedAt: Date;
    revokedAt: Date | null;
    bindingVersion: number;
    version: number;
  }): CompanionBindingView {
    return {
      id: binding.id,
      deviceId: binding.deviceId,
      householdId: binding.householdId,
      recipientId: binding.recipientId,
      displayName: binding.displayName,
      status: binding.status,
      activatedAt: binding.activatedAt.toISOString(),
      revokedAt: binding.revokedAt?.toISOString() ?? null,
      bindingVersion: binding.bindingVersion,
      version: binding.version,
    };
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2002'
    );
  }
}

function isRetryable(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2034'
  );
}
