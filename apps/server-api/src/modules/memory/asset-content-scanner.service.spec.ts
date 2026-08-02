import { describe, expect, it, jest } from '@jest/globals';
import { createHash } from 'node:crypto';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { AssetApplicationService } from './asset.application.service';
import {
  AssetContentScannerService,
  AssetScanRetryableError,
} from './asset-content-scanner.service';
import type { MalwareScannerPort } from './ports/malware-scanner.port';
import { MalwareScannerUnavailableError } from './ports/malware-scanner.port';
import type { ObjectStoragePort } from './ports/object-storage.port';

interface SetupOptions {
  content?: Buffer;
  originalName?: string;
  mimeType?: string;
  byteSize?: number;
  sha256?: Buffer;
  verdict?: 'CLEAN' | 'INFECTED';
  scannerUnavailable?: boolean;
}

function setup(options: SetupOptions = {}) {
  const content =
    options.content ?? Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x01, 0x02]);
  const sha256 =
    options.sha256 ??
    // The scanner compares actual content, not the upload metadata checksum.
    createHash('sha256').update(content).digest();
  const row = {
    id: '01ASSET00000000000000000000',
    bucket: 'openbmb-assets',
    objectKey: 'households/h/asset',
    originalName: options.originalName ?? 'photo.jpg',
    mimeType: options.mimeType ?? 'image/jpeg',
    byteSize: BigInt(options.byteSize ?? content.length),
    sha256,
    status: 'ACTIVE',
    scanStatus: 'PENDING',
  };
  const prisma = {
    asset: { findUnique: jest.fn(async () => row) },
  } as unknown as PrismaService;
  const recordScanResult = jest.fn(async () => undefined);
  const assets = { recordScanResult } as unknown as AssetApplicationService;
  const storage = {
    privateBucket: 'openbmb-assets',
    createUploadGrant: jest.fn(),
    headObject: jest.fn(),
    readObject: jest.fn(async () => ({
      content: (async function* () {
        yield content.subarray(0, 2);
        yield content.subarray(2);
      })(),
    })),
    createDownloadGrant: jest.fn(),
    deleteObject: jest.fn(),
  } as unknown as ObjectStoragePort;
  const malware = {
    scan: jest.fn(async ({ content: streamed }) => {
      if (options.scannerUnavailable) {
        throw new MalwareScannerUnavailableError();
      }
      for await (const chunk of streamed) {
        // A fake must consume every byte to satisfy the scanner port contract.
        void chunk;
      }
      return options.verdict ?? 'CLEAN';
    }),
  } as MalwareScannerPort;
  return {
    service: new AssetContentScannerService(prisma, assets, storage, malware),
    recordScanResult,
  };
}

describe('AssetContentScannerService', () => {
  it('records CLEAN only after reading, hashing, identifying, and malware scanning', async () => {
    const { service, recordScanResult } = setup();

    await expect(service.scanPendingAsset('asset')).resolves.toBe('PROCESSED');

    expect(recordScanResult).toHaveBeenCalledWith(
      '01ASSET00000000000000000000',
      'CLEAN',
    );
  });

  it('records QUARANTINED for a malware verdict', async () => {
    const { service, recordScanResult } = setup({ verdict: 'INFECTED' });

    await service.scanPendingAsset('asset');

    expect(recordScanResult).toHaveBeenCalledWith(
      '01ASSET00000000000000000000',
      'QUARANTINED',
    );
  });

  it.each([
    { title: 'extension', originalName: 'photo.exe' },
    { title: 'declared MIME', mimeType: 'image/png' },
    { title: 'file signature', content: Buffer.from('not-a-jpeg') },
    { title: 'size', byteSize: 999 },
    { title: 'SHA-256', sha256: Buffer.alloc(32, 0x42) },
  ])('quarantines a $title mismatch', async (options) => {
    const { service, recordScanResult } = setup(options);

    await service.scanPendingAsset('asset');

    expect(recordScanResult).toHaveBeenLastCalledWith(
      '01ASSET00000000000000000000',
      'QUARANTINED',
    );
  });

  it('records FAILED and remains retryable when clamd is unavailable', async () => {
    const { service, recordScanResult } = setup({ scannerUnavailable: true });

    await expect(service.scanPendingAsset('asset')).rejects.toBeInstanceOf(
      AssetScanRetryableError,
    );
    expect(recordScanResult).toHaveBeenCalledWith(
      '01ASSET00000000000000000000',
      'FAILED',
    );
  });
});
