/* Test doubles implement promise-based ports without real asynchronous work. */

import { describe, expect, it, jest } from '@jest/globals';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import { HouseholdAccessDeniedException } from '../household/household.errors';
import type { UserPrincipal } from '../identity/identity.types';
import { AssetApplicationService } from './asset.application.service';
import {
  AssetScanPendingException,
  AssetUploadMismatchException,
} from './memory.errors';
import type {
  CreateUploadGrantInput,
  ObjectStoragePort,
  StoredObjectHead,
} from './ports/object-storage.port';

interface AssetStateRow {
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

interface AssetFakeState {
  assets: AssetStateRow[];
  outbox: Array<Record<string, unknown>>;
}

interface AssetWhere {
  id?: string;
  householdId?: string;
  status?: string;
  scanStatus?: string;
  version?: number;
}

function createAssetPrisma(): {
  prisma: PrismaService;
  state: AssetFakeState;
} {
  const state: AssetFakeState = { assets: [], outbox: [] };
  const matches = (asset: AssetStateRow, where: AssetWhere): boolean =>
    (where.id === undefined || asset.id === where.id) &&
    (where.householdId === undefined ||
      asset.householdId === where.householdId) &&
    (where.status === undefined || asset.status === where.status) &&
    (where.scanStatus === undefined || asset.scanStatus === where.scanStatus) &&
    (where.version === undefined || asset.version === where.version);
  const raw = {
    asset: {
      create: jest.fn(
        async ({
          data,
        }: {
          data: Omit<AssetStateRow, 'version'>;
        }): Promise<AssetStateRow> => {
          const row = { ...data, version: 0 };
          state.assets.push(row);
          return { ...row };
        },
      ),
      findFirst: jest.fn(
        async ({
          where,
        }: {
          where: AssetWhere;
        }): Promise<AssetStateRow | null> =>
          state.assets.find((asset) => matches(asset, where)) ?? null,
      ),
      findUnique: jest.fn(
        async ({
          where,
        }: {
          where: AssetWhere;
        }): Promise<AssetStateRow | null> =>
          state.assets.find((asset) => matches(asset, where)) ?? null,
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: AssetWhere;
          data: Record<string, unknown>;
        }) => {
          const row = state.assets.find((asset) => matches(asset, where));
          if (!row) return { count: 0 };
          for (const [key, value] of Object.entries(data)) {
            if (key === 'version') row.version += 1;
            else if (key in row) Object.assign(row, { [key]: value });
          }
          row.updatedAt = new Date();
          return { count: 1 };
        },
      ),
    },
    outboxEvent: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.outbox.push(data);
        return data;
      }),
    },
  };
  const prisma = {
    ...raw,
    $transaction: jest.fn(
      async (work: (transaction: typeof raw) => Promise<unknown>) => work(raw),
    ),
  } as unknown as PrismaService;
  return { prisma, state };
}

describe('AssetApplicationService', () => {
  const principal: UserPrincipal = {
    kind: 'USER',
    userId: '01USER00000000000000000000',
    sessionId: '01SESSION00000000000000000',
    tokenId: '01TOKEN0000000000000000000',
    status: 'ACTIVE',
  };
  const householdId = '01HOUSEHOLD000000000000000';
  const recipientId = '01RECIPIENT000000000000000';
  const memberId = '01MEMBER0000000000000000000';
  const sha256 = Buffer.alloc(32, 0x2a).toString('hex');

  function setup(headOverride?: StoredObjectHead) {
    const { prisma, state } = createAssetPrisma();
    let uploadInput: CreateUploadGrantInput | undefined;
    const storage: ObjectStoragePort = {
      privateBucket: 'memory-lighthouse-private',
      createUploadGrant: jest.fn(async (input: CreateUploadGrantInput) => {
        uploadInput = input;
        return {
          url: 'https://minio.test/upload',
          expiresAt: new Date('2026-08-01T10:05:00.000Z'),
          requiredHeaders: { 'content-type': input.contentType },
        };
      }),
      headObject: jest.fn(async () => {
        if (headOverride) return headOverride;
        const asset = state.assets[0];
        return {
          contentLength: Number(asset.byteSize),
          contentType: asset.mimeType,
          checksumSha256Base64: Buffer.from(asset.sha256).toString('base64'),
          metadata: {
            'asset-id': asset.id,
            'household-id': asset.householdId,
            'uploaded-by-member-id': asset.uploadedByMemberId,
            sha256: Buffer.from(asset.sha256).toString('hex'),
          },
        };
      }),
      createDownloadGrant: jest.fn(async () => ({
        url: 'https://minio.test/download',
        expiresAt: new Date('2026-08-01T10:01:00.000Z'),
      })),
      deleteObject: jest.fn(async () => undefined),
    };
    const policy = {
      requireHouseholdAction: jest.fn(
        async (
          _client: unknown,
          _userId: string,
          requestedHousehold: string,
        ) => {
          if (requestedHousehold !== householdId) {
            throw new HouseholdAccessDeniedException();
          }
          return { id: memberId };
        },
      ),
      requireRecipientAction: jest.fn(
        async (
          _client: unknown,
          _userId: string,
          requestedHousehold: string,
          requestedRecipient: string,
        ) => {
          if (
            requestedHousehold !== householdId ||
            requestedRecipient !== recipientId
          ) {
            throw new HouseholdAccessDeniedException();
          }
          return { id: memberId, roleCodes: ['OWNER'] };
        },
      ),
    } as unknown as HouseholdAccessPolicy;
    return {
      service: new AssetApplicationService(prisma, policy, storage),
      state,
      storage,
      uploadInput: () => uploadInput,
    };
  }

  async function begin(service: AssetApplicationService) {
    return service.beginUpload({
      principal,
      householdId,
      recipientId,
      originalName: '老照片.jpg',
      mimeType: 'image/jpeg',
      byteSize: 1_024,
      sha256,
      kind: 'MEMORY_PHOTO',
    });
  }

  it('keeps upload, scan, download, and two-phase deletion states explicit', async () => {
    const { service, state, storage, uploadInput } = setup();
    const intent = await begin(service);

    expect(intent.asset.status).toBe('PENDING_UPLOAD');
    expect(intent.asset.scanStatus).toBe('PENDING');
    expect(uploadInput()?.objectKey.length).toBeLessThanOrEqual(512);
    expect(uploadInput()?.metadata['asset-id']).toBe(intent.asset.id);

    const completed = await service.completeUpload({
      principal,
      householdId,
      assetId: intent.asset.id,
      version: 0,
    });
    expect(completed.status).toBe('ACTIVE');
    expect(completed.scanStatus).toBe('PENDING');
    await expect(
      service.authorizeDownload(principal.userId, householdId, intent.asset.id),
    ).rejects.toBeInstanceOf(AssetScanPendingException);

    await service.recordScanResult(intent.asset.id, 'CLEAN');
    await expect(
      service.authorizeDownload(principal.userId, householdId, intent.asset.id),
    ).resolves.toMatchObject({ downloadUrl: 'https://minio.test/download' });

    const firstDelete = await service.requestDeletion(
      principal.userId,
      householdId,
      intent.asset.id,
    );
    const secondDelete = await service.requestDeletion(
      principal.userId,
      householdId,
      intent.asset.id,
    );
    expect(firstDelete.status).toBe('PENDING_DELETE');
    expect(secondDelete).toEqual(firstDelete);
    expect(state.outbox).toHaveLength(1);

    await service.deletePendingAsset(intent.asset.id);
    await service.deletePendingAsset(intent.asset.id);
    expect(storage.deleteObject).toHaveBeenCalledTimes(1);
    expect(state.assets[0].status).toBe('DELETED');
  });

  it('does not publish an upload whose HEAD owner or hash differs', async () => {
    const { service, state } = setup({
      contentLength: 1_024,
      contentType: 'image/jpeg',
      checksumSha256Base64: Buffer.alloc(32, 0x01).toString('base64'),
      metadata: {
        'asset-id': 'another-asset',
        'household-id': householdId,
        'uploaded-by-member-id': memberId,
        sha256: Buffer.alloc(32, 0x01).toString('hex'),
      },
    });
    const intent = await begin(service);

    await expect(
      service.completeUpload({
        principal,
        householdId,
        assetId: intent.asset.id,
        version: 0,
      }),
    ).rejects.toBeInstanceOf(AssetUploadMismatchException);
    expect(state.assets[0].status).toBe('PENDING_UPLOAD');
  });

  it('denies cross-household asset paths before object storage access', async () => {
    const { service, storage } = setup();
    const intent = await begin(service);

    await expect(
      service.authorizeDownload(
        principal.userId,
        '01OTHERHOUSEHOLD00000000000',
        intent.asset.id,
      ),
    ).rejects.toBeInstanceOf(HouseholdAccessDeniedException);
    expect(storage.createDownloadGrant).not.toHaveBeenCalled();
  });
});
