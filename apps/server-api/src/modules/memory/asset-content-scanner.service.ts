import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import {
  ASSET_SCAN_STATUS,
  ASSET_STATUS,
  MALWARE_SCANNER_PORT,
  MAX_ASSET_BYTES,
  OBJECT_STORAGE_PORT,
} from './memory.constants';
import type { MalwareScannerPort } from './ports/malware-scanner.port';
import type { ObjectStoragePort } from './ports/object-storage.port';
import { AssetApplicationService } from './asset.application.service';

interface ScannableAsset {
  id: string;
  bucket: string;
  objectKey: string;
  originalName: string;
  mimeType: string;
  byteSize: bigint;
  sha256: Uint8Array;
  status: string;
  scanStatus: string;
}

interface FileProfile {
  extensions: readonly string[];
  mimeTypes: readonly string[];
  hasExpectedSignature(header: Buffer): boolean;
}

const startsWith = (header: Buffer, signature: readonly number[]): boolean =>
  header.length >= signature.length &&
  signature.every((value, index) => header[index] === value);

const asciiAt = (header: Buffer, offset: number, value: string): boolean =>
  header.length >= offset + value.length &&
  header.subarray(offset, offset + value.length).toString('ascii') === value;

const FILE_PROFILES: readonly FileProfile[] = [
  {
    extensions: ['.jpg', '.jpeg'],
    mimeTypes: ['image/jpeg'],
    hasExpectedSignature: (header) => startsWith(header, [0xff, 0xd8, 0xff]),
  },
  {
    extensions: ['.png'],
    mimeTypes: ['image/png'],
    hasExpectedSignature: (header) =>
      startsWith(header, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  {
    extensions: ['.gif'],
    mimeTypes: ['image/gif'],
    hasExpectedSignature: (header) =>
      asciiAt(header, 0, 'GIF87a') || asciiAt(header, 0, 'GIF89a'),
  },
  {
    extensions: ['.webp'],
    mimeTypes: ['image/webp'],
    hasExpectedSignature: (header) =>
      asciiAt(header, 0, 'RIFF') && asciiAt(header, 8, 'WEBP'),
  },
  {
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    hasExpectedSignature: (header) => asciiAt(header, 0, '%PDF-'),
  },
  {
    extensions: ['.mp3'],
    mimeTypes: ['audio/mpeg'],
    hasExpectedSignature: (header) =>
      asciiAt(header, 0, 'ID3') ||
      (header.length >= 2 && header[0] === 0xff && (header[1] & 0xe0) === 0xe0),
  },
  {
    extensions: ['.wav'],
    mimeTypes: ['audio/wav', 'audio/x-wav'],
    hasExpectedSignature: (header) =>
      asciiAt(header, 0, 'RIFF') && asciiAt(header, 8, 'WAVE'),
  },
  {
    extensions: ['.ogg', '.oga', '.opus'],
    mimeTypes: ['audio/ogg'],
    hasExpectedSignature: (header) => asciiAt(header, 0, 'OggS'),
  },
  {
    extensions: ['.m4a'],
    mimeTypes: ['audio/mp4'],
    hasExpectedSignature: (header) => asciiAt(header, 4, 'ftyp'),
  },
  {
    extensions: ['.mp4', '.m4v'],
    mimeTypes: ['video/mp4'],
    hasExpectedSignature: (header) => asciiAt(header, 4, 'ftyp'),
  },
  {
    extensions: ['.webm'],
    mimeTypes: ['audio/webm', 'video/webm'],
    hasExpectedSignature: (header) =>
      startsWith(header, [0x1a, 0x45, 0xdf, 0xa3]),
  },
  {
    extensions: ['.heic', '.heif'],
    mimeTypes: ['image/heic', 'image/heif'],
    hasExpectedSignature: (header) =>
      asciiAt(header, 4, 'ftyp') &&
      ['heic', 'heix', 'hevc', 'hevx', 'mif1'].some((brand) =>
        asciiAt(header, 8, brand),
      ),
  },
];

class AssetContentPolicyError extends Error {
  constructor() {
    super('Asset content violates the bounded scanner policy');
    this.name = 'AssetContentPolicyError';
  }
}

export class AssetScanRetryableError extends Error {
  constructor() {
    super('Asset scan must be retried');
    this.name = 'AssetScanRetryableError';
  }
}

/**
 * Deep scanner: one object read feeds size/hash/header validation and ClamAV.
 * No caller can accidentally substitute a HEAD-only malware check.
 */
@Injectable()
export class AssetContentScannerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly assets: AssetApplicationService,
    @Inject(OBJECT_STORAGE_PORT)
    private readonly storage: ObjectStoragePort,
    @Inject(MALWARE_SCANNER_PORT)
    private readonly malware: MalwareScannerPort,
  ) {}

  async scanPendingAsset(assetId: string): Promise<'PROCESSED' | 'SKIPPED'> {
    const asset = (await this.prisma.asset.findUnique({
      where: { id: assetId },
    })) as ScannableAsset | null;
    if (
      !asset ||
      asset.status !== ASSET_STATUS.active ||
      ![ASSET_SCAN_STATUS.pending, ASSET_SCAN_STATUS.failed].includes(
        asset.scanStatus as 'PENDING' | 'FAILED',
      )
    ) {
      return 'SKIPPED';
    }

    try {
      const result = await this.inspect(asset);
      await this.assets.recordScanResult(asset.id, result);
      return 'PROCESSED';
    } catch (error) {
      if (error instanceof AssetContentPolicyError) {
        await this.assets.recordScanResult(
          asset.id,
          ASSET_SCAN_STATUS.quarantined,
        );
        return 'PROCESSED';
      }
      // Operational failures are made visible in MySQL immediately. FAILED
      // remains non-downloadable while the outbox job is retried.
      await this.assets.recordScanResult(asset.id, ASSET_SCAN_STATUS.failed);
      throw new AssetScanRetryableError();
    }
  }

  private async inspect(
    asset: ScannableAsset,
  ): Promise<'CLEAN' | 'QUARANTINED'> {
    const stored = await this.storage.readObject({
      bucket: asset.bucket,
      objectKey: asset.objectKey,
    });
    if (!stored) {
      throw new AssetScanRetryableError();
    }

    const expectedBytes = Number(asset.byteSize);
    const expectedHash = Buffer.from(asset.sha256);
    const profile = this.profileFor(asset.originalName);
    const declaredMime = asset.mimeType.trim().toLowerCase();
    const metadataPolicyValid =
      profile !== undefined && profile.mimeTypes.includes(declaredMime);
    const hash = createHash('sha256');
    const headerParts: Buffer[] = [];
    let headerBytes = 0;
    let actualBytes = 0;

    const inspectedContent = async function* (): AsyncIterable<Uint8Array> {
      for await (const value of stored.content) {
        const chunk = Buffer.from(
          value.buffer,
          value.byteOffset,
          value.byteLength,
        );
        actualBytes += chunk.length;
        if (actualBytes > MAX_ASSET_BYTES) {
          throw new AssetContentPolicyError();
        }
        hash.update(chunk);
        if (headerBytes < 32) {
          const part = chunk.subarray(0, 32 - headerBytes);
          headerParts.push(Buffer.from(part));
          headerBytes += part.length;
        }
        yield chunk;
      }
    };

    const malwareVerdict = await this.malware.scan({
      content: inspectedContent(),
      maximumBytes: MAX_ASSET_BYTES,
    });
    if (malwareVerdict === 'INFECTED') {
      return ASSET_SCAN_STATUS.quarantined;
    }

    const actualHash = hash.digest();
    const header = Buffer.concat(headerParts, headerBytes);
    if (
      !metadataPolicyValid ||
      !profile.hasExpectedSignature(header) ||
      actualBytes !== expectedBytes ||
      actualHash.length !== expectedHash.length ||
      !actualHash.equals(expectedHash)
    ) {
      return ASSET_SCAN_STATUS.quarantined;
    }
    return ASSET_SCAN_STATUS.clean;
  }

  private profileFor(originalName: string): FileProfile | undefined {
    const normalized = originalName.trim().toLowerCase();
    const dot = normalized.lastIndexOf('.');
    if (dot <= 0 || dot === normalized.length - 1) {
      return undefined;
    }
    const extension = normalized.slice(dot);
    return FILE_PROFILES.find((profile) =>
      profile.extensions.includes(extension),
    );
  }
}
