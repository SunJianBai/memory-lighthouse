import { Inject, Injectable } from '@nestjs/common';

import type { Prisma } from '../../infrastructure/database/generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import { newUlid } from '../identity/domain/ulid';
import {
  ASSET_DOWNLOAD_TTL_SECONDS,
  ASSET_LIFECYCLE_EVENT,
  ASSET_SCAN_STATUS,
  ASSET_STATUS,
  ASSET_UPLOAD_TTL_SECONDS,
  OBJECT_STORAGE_PORT,
} from './memory.constants';
import {
  AssetNotFoundException,
  AssetScanPendingException,
  AssetUnavailableException,
  AssetUploadIncompleteException,
  AssetUploadMismatchException,
  AssetUploadStateException,
  MemoryVersionConflictException,
} from './memory.errors';
import type {
  AssetDeletionView,
  AssetView,
  CompleteUploadCommand,
  CreateUploadIntentCommand,
  UploadIntentView,
} from './memory.types';
import type { ObjectStoragePort } from './ports/object-storage.port';

type DatabaseClient = PrismaService | Prisma.TransactionClient;

interface AssetRecord {
  id: string;
  householdId: string;
  recipientId: string | null;
  bucket: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  byteSize: bigint;
  sha256: Uint8Array;
  kind: string;
  scanStatus: string;
  status: string;
  uploadedByMemberId: string;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}

export interface AssetDownloadGrantView {
  assetId: string;
  downloadUrl: string;
  expiresAt: string;
}

@Injectable()
export class AssetApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: HouseholdAccessPolicy,
    @Inject(OBJECT_STORAGE_PORT)
    private readonly storage: ObjectStoragePort,
  ) {}

  async beginUpload(
    command: CreateUploadIntentCommand,
  ): Promise<UploadIntentView> {
    const actor = await this.policy.requireRecipientAction(
      this.prisma,
      command.principal.userId,
      command.householdId,
      command.recipientId,
      'MANAGE_RECIPIENT',
    );
    const now = new Date();
    const assetId = newUlid(now.getTime());
    const sha256 = Buffer.from(command.sha256.toLowerCase(), 'hex');
    const objectKey = this.objectKey(command.householdId, assetId, now);
    const created = (await this.prisma.asset.create({
      data: {
        id: assetId,
        householdId: command.householdId,
        recipientId: command.recipientId,
        bucket: this.storage.privateBucket,
        objectKey,
        originalName: command.originalName.trim(),
        mimeType: command.mimeType.toLowerCase(),
        byteSize: BigInt(command.byteSize),
        sha256,
        kind: command.kind.trim(),
        scanStatus: ASSET_SCAN_STATUS.pending,
        status: ASSET_STATUS.pendingUpload,
        uploadedByMemberId: actor.id,
        createdAt: now,
        updatedAt: now,
      },
    })) as AssetRecord;

    try {
      const grant = await this.storage.createUploadGrant({
        bucket: created.bucket,
        objectKey: created.objectKey,
        contentLength: command.byteSize,
        contentType: created.mimeType,
        checksumSha256Base64: sha256.toString('base64'),
        metadata: {
          'asset-id': created.id,
          'household-id': created.householdId,
          'uploaded-by-member-id': created.uploadedByMemberId,
          sha256: command.sha256.toLowerCase(),
        },
        expiresInSeconds: ASSET_UPLOAD_TTL_SECONDS,
      });
      return {
        asset: this.toAssetView(created),
        method: 'PUT',
        uploadUrl: grant.url,
        expiresAt: grant.expiresAt.toISOString(),
        requiredHeaders: grant.requiredHeaders,
      };
    } catch (error) {
      // Grant issuance is outside the database transaction. Mark the orphaned
      // metadata for the same two-phase deletion worker before propagating.
      await this.queueDeletionAfterGrantFailure(created);
      throw error;
    }
  }

  async completeUpload(command: CompleteUploadCommand): Promise<AssetView> {
    const pending = await this.requirePathOwnedAsset(
      this.prisma,
      command.principal.userId,
      command.householdId,
      command.assetId,
      'MANAGE_RECIPIENT',
    );
    if (pending.status === ASSET_STATUS.active) {
      return this.toAssetView(pending);
    }
    if (
      pending.status !== ASSET_STATUS.pendingUpload ||
      pending.version !== command.version
    ) {
      throw new AssetUploadStateException();
    }

    // HEAD is intentionally outside a database transaction. The transaction
    // below re-checks state/version before making the upload visible.
    const head = await this.storage.headObject({
      bucket: pending.bucket,
      objectKey: pending.objectKey,
    });
    if (!head) {
      throw new AssetUploadIncompleteException();
    }
    this.assertStoredObjectMatches(pending, head);

    const completed = await this.prisma.$transaction(async (transaction) => {
      const current = await this.requirePathOwnedAsset(
        transaction,
        command.principal.userId,
        command.householdId,
        command.assetId,
        'MANAGE_RECIPIENT',
      );
      if (current.status === ASSET_STATUS.active) {
        return current;
      }
      if (
        current.status !== ASSET_STATUS.pendingUpload ||
        current.version !== command.version
      ) {
        throw new AssetUploadStateException();
      }
      const updated = await transaction.asset.updateMany({
        where: {
          id: current.id,
          householdId: command.householdId,
          status: ASSET_STATUS.pendingUpload,
          version: command.version,
        },
        data: {
          status: ASSET_STATUS.active,
          scanStatus: ASSET_SCAN_STATUS.pending,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new MemoryVersionConflictException();
      }
      const now = new Date();
      await transaction.outboxEvent.create({
        data: {
          id: newUlid(now.getTime()),
          aggregateType: 'ASSET',
          aggregateId: current.id,
          eventType: ASSET_LIFECYCLE_EVENT.scanRequested,
          payloadJson: {
            assetId: current.id,
            householdId: current.householdId,
          },
          occurredAt: now,
          availableAt: now,
        },
      });
      return this.requireAsset(transaction, command.householdId, current.id);
    });
    return this.toAssetView(completed);
  }

  async authorizeDownload(
    userId: string,
    householdId: string,
    assetId: string,
  ): Promise<AssetDownloadGrantView> {
    const asset = await this.requirePathOwnedAsset(
      this.prisma,
      userId,
      householdId,
      assetId,
      'VIEW_RECIPIENT',
    );
    if (asset.status !== ASSET_STATUS.active) {
      throw new AssetUnavailableException();
    }
    if (asset.scanStatus === ASSET_SCAN_STATUS.pending) {
      throw new AssetScanPendingException();
    }
    if (asset.scanStatus !== ASSET_SCAN_STATUS.clean) {
      throw new AssetUnavailableException();
    }

    const grant = await this.storage.createDownloadGrant({
      bucket: asset.bucket,
      objectKey: asset.objectKey,
      originalName: asset.originalName,
      expiresInSeconds: ASSET_DOWNLOAD_TTL_SECONDS,
    });
    return {
      assetId,
      downloadUrl: grant.url,
      expiresAt: grant.expiresAt.toISOString(),
    };
  }

  requestDeletion(
    userId: string,
    householdId: string,
    assetId: string,
    version?: number,
  ): Promise<AssetDeletionView> {
    return this.prisma.$transaction(async (transaction) => {
      const asset = await this.requirePathOwnedAsset(
        transaction,
        userId,
        householdId,
        assetId,
        'MANAGE_RECIPIENT',
      );
      if (
        asset.status === ASSET_STATUS.pendingDelete ||
        asset.status === ASSET_STATUS.deleted
      ) {
        return {
          assetId,
          status: asset.status,
          accepted: true,
        };
      }
      if (version !== undefined && version !== asset.version) {
        throw new MemoryVersionConflictException();
      }

      const now = new Date();
      const updated = await transaction.asset.updateMany({
        where: {
          id: asset.id,
          householdId,
          version: asset.version,
          status: asset.status,
        },
        data: {
          status: ASSET_STATUS.pendingDelete,
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new MemoryVersionConflictException();
      }
      await transaction.outboxEvent.create({
        data: {
          id: newUlid(now.getTime()),
          aggregateType: 'ASSET',
          aggregateId: asset.id,
          eventType: ASSET_LIFECYCLE_EVENT.deleteRequested,
          payloadJson: {
            assetId: asset.id,
            householdId: asset.householdId,
            bucket: asset.bucket,
            objectKey: asset.objectKey,
          },
          occurredAt: now,
          availableAt: this.deletionAvailableAt(asset, now),
        },
      });
      return {
        assetId,
        status: ASSET_STATUS.pendingDelete,
        accepted: true,
      };
    });
  }

  /** Worker-facing command invoked from the outbox consumer. */
  async deletePendingAsset(assetId: string): Promise<void> {
    const asset = (await this.prisma.asset.findUnique({
      where: { id: assetId },
    })) as AssetRecord | null;
    if (!asset || asset.status === ASSET_STATUS.deleted) {
      return;
    }
    if (asset.status !== ASSET_STATUS.pendingDelete) {
      throw new AssetUnavailableException();
    }

    await this.storage.deleteObject({
      bucket: asset.bucket,
      objectKey: asset.objectKey,
    });
    await this.prisma.asset.updateMany({
      where: {
        id: asset.id,
        householdId: asset.householdId,
        status: ASSET_STATUS.pendingDelete,
      },
      data: {
        status: ASSET_STATUS.deleted,
        version: { increment: 1 },
      },
    });
  }

  /** Scanner-facing command; quarantined/failed objects never get grants. */
  async recordScanResult(
    assetId: string,
    result: 'CLEAN' | 'QUARANTINED' | 'FAILED',
  ): Promise<void> {
    const asset = (await this.prisma.asset.findUnique({
      where: { id: assetId },
    })) as AssetRecord | null;
    if (!asset || asset.status !== ASSET_STATUS.active) {
      return;
    }
    if (asset.scanStatus === result) {
      return;
    }
    if (
      asset.scanStatus !== ASSET_SCAN_STATUS.pending &&
      asset.scanStatus !== ASSET_SCAN_STATUS.failed
    ) {
      return;
    }
    const updated = await this.prisma.asset.updateMany({
      where: {
        id: assetId,
        status: ASSET_STATUS.active,
        scanStatus: asset.scanStatus,
        version: asset.version,
      },
      data: { scanStatus: result, version: { increment: 1 } },
    });
    if (updated.count !== 1) {
      // A duplicate worker may have completed the same deterministic scan or
      // a deletion request may have won the race. Both outcomes remain safe.
      return;
    }
  }

  private async requirePathOwnedAsset(
    client: DatabaseClient,
    userId: string,
    householdId: string,
    assetId: string,
    action: 'VIEW_RECIPIENT' | 'MANAGE_RECIPIENT',
  ): Promise<AssetRecord> {
    await this.policy.requireHouseholdAction(
      client,
      userId,
      householdId,
      'VIEW_HOUSEHOLD',
    );
    const asset = (await client.asset.findFirst({
      where: { id: assetId, householdId },
    })) as AssetRecord | null;
    if (!asset) {
      throw new AssetNotFoundException();
    }
    if (!asset.recipientId) {
      throw new AssetUnavailableException();
    }
    await this.policy.requireRecipientAction(
      client,
      userId,
      householdId,
      asset.recipientId,
      action,
    );
    return asset;
  }

  private async requireAsset(
    client: DatabaseClient,
    householdId: string,
    assetId: string,
  ): Promise<AssetRecord> {
    const asset = (await client.asset.findFirst({
      where: { id: assetId, householdId },
    })) as AssetRecord | null;
    if (!asset) {
      throw new AssetNotFoundException();
    }
    return asset;
  }

  private assertStoredObjectMatches(
    asset: AssetRecord,
    head: {
      contentLength: number | null;
      contentType: string | null;
      checksumSha256Base64: string | null;
      serverSideEncryption: string | null;
      metadata: Record<string, string>;
    },
  ): void {
    const expectedHashHex = Buffer.from(asset.sha256).toString('hex');
    const expectedHashBase64 = Buffer.from(asset.sha256).toString('base64');
    const mismatches: Record<string, unknown> = {};
    if (head.contentLength !== Number(asset.byteSize)) {
      mismatches.byteSize = 'MISMATCH';
    }
    if (head.contentType?.toLowerCase() !== asset.mimeType.toLowerCase()) {
      mismatches.mimeType = 'MISMATCH';
    }
    if (head.serverSideEncryption !== 'AES256') {
      mismatches.encryption = 'MISMATCH';
    }
    if (
      head.checksumSha256Base64 !== expectedHashBase64 &&
      head.metadata.sha256?.toLowerCase() !== expectedHashHex
    ) {
      mismatches.sha256 = 'MISMATCH';
    }
    if (
      head.metadata['asset-id'] !== asset.id ||
      head.metadata['household-id'] !== asset.householdId ||
      head.metadata['uploaded-by-member-id'] !== asset.uploadedByMemberId
    ) {
      mismatches.owner = 'MISMATCH';
    }
    if (Object.keys(mismatches).length > 0) {
      throw new AssetUploadMismatchException(mismatches);
    }
  }

  private async queueDeletionAfterGrantFailure(
    asset: AssetRecord,
  ): Promise<void> {
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.asset.updateMany({
        where: {
          id: asset.id,
          householdId: asset.householdId,
          status: ASSET_STATUS.pendingUpload,
          version: asset.version,
        },
        data: {
          status: ASSET_STATUS.pendingDelete,
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        return;
      }
      await transaction.outboxEvent.create({
        data: {
          id: newUlid(now.getTime()),
          aggregateType: 'ASSET',
          aggregateId: asset.id,
          eventType: ASSET_LIFECYCLE_EVENT.deleteRequested,
          payloadJson: {
            assetId: asset.id,
            householdId: asset.householdId,
            bucket: asset.bucket,
            objectKey: asset.objectKey,
          },
          occurredAt: now,
          availableAt: this.deletionAvailableAt(asset, now),
        },
      });
    });
  }

  private objectKey(householdId: string, assetId: string, now: Date): string {
    const year = now.getUTCFullYear().toString().padStart(4, '0');
    const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
    const key = `households/${householdId}/${year}/${month}/${assetId}`;
    if (key.length > 512) {
      throw new AssetUploadStateException();
    }
    return key;
  }

  private deletionAvailableAt(asset: AssetRecord, now: Date): Date {
    // A granted PUT remains usable even after database state moves to
    // PENDING_DELETE. Wait past its maximum lifetime (plus clock/signing
    // margin), then permanently remove every object version.
    const uploadGrantExpiry = new Date(
      asset.createdAt.getTime() + (ASSET_UPLOAD_TTL_SECONDS + 60) * 1_000,
    );
    return uploadGrantExpiry > now ? uploadGrantExpiry : now;
  }

  private toAssetView(asset: AssetRecord): AssetView {
    return {
      id: asset.id,
      householdId: asset.householdId,
      recipientId: asset.recipientId,
      originalName: asset.originalName,
      mimeType: asset.mimeType,
      byteSize: Number(asset.byteSize),
      sha256: Buffer.from(asset.sha256).toString('hex'),
      kind: asset.kind,
      scanStatus: asset.scanStatus,
      status: asset.status,
      createdAt: asset.createdAt.toISOString(),
      updatedAt: asset.updatedAt.toISOString(),
      version: asset.version,
    };
  }
}
