import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { ObjectStorageConfigurationException } from '../memory.errors';
import type {
  CreateDownloadGrantInput,
  CreateUploadGrantInput,
  DownloadGrant,
  ObjectLocation,
  ObjectStoragePort,
  StoredObjectHead,
  UploadGrant,
} from '../ports/object-storage.port';

@Injectable()
export class S3ObjectStorageAdapter implements ObjectStoragePort {
  readonly privateBucket: string;
  private readonly client: S3Client;

  constructor(config: ConfigService) {
    const endpoint = config.get<string>('OBJECT_STORAGE_ENDPOINT');
    const accessKeyId = config.get<string>('OBJECT_STORAGE_ACCESS_KEY_ID');
    const secretAccessKey = config.get<string>(
      'OBJECT_STORAGE_SECRET_ACCESS_KEY',
    );
    const bucket = config.get<string>('OBJECT_STORAGE_BUCKET');
    const minioRootUser = config.get<string>('MINIO_ROOT_USER');
    if (!endpoint || !accessKeyId || !secretAccessKey || !bucket) {
      throw new ObjectStorageConfigurationException();
    }
    // Presigned URLs disclose the signer access-key id. Force deployments to
    // provision a bucket-scoped application identity instead of MinIO root.
    if (minioRootUser && accessKeyId === minioRootUser) {
      throw new ObjectStorageConfigurationException();
    }
    if (bucket.length > 63 || !/^[a-z0-9][a-z0-9.-]+[a-z0-9]$/.test(bucket)) {
      throw new ObjectStorageConfigurationException();
    }

    this.privateBucket = bucket;
    this.client = new S3Client({
      endpoint,
      region: config.get<string>('OBJECT_STORAGE_REGION') ?? 'us-east-1',
      forcePathStyle:
        config.get<string>('OBJECT_STORAGE_FORCE_PATH_STYLE') !== 'false',
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  async createUploadGrant(input: CreateUploadGrantInput): Promise<UploadGrant> {
    this.requirePrivateBucket(input.bucket);
    const requiredHeaders: Record<string, string> = {
      'content-type': input.contentType,
      'x-amz-checksum-sha256': input.checksumSha256Base64,
      ...Object.fromEntries(
        Object.entries(input.metadata).map(([name, value]) => [
          `x-amz-meta-${name}`,
          value,
        ]),
      ),
    };
    const command = new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.objectKey,
      ContentLength: input.contentLength,
      ContentType: input.contentType,
      ChecksumSHA256: input.checksumSha256Base64,
      Metadata: input.metadata,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: input.expiresInSeconds,
    });
    return {
      url,
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000),
      requiredHeaders,
    };
  }

  async headObject(location: ObjectLocation): Promise<StoredObjectHead | null> {
    this.requirePrivateBucket(location.bucket);
    try {
      const head = await this.client.send(
        new HeadObjectCommand({
          Bucket: location.bucket,
          Key: location.objectKey,
          ChecksumMode: 'ENABLED',
        }),
      );
      return {
        contentLength: head.ContentLength ?? null,
        contentType: head.ContentType ?? null,
        checksumSha256Base64: head.ChecksumSHA256 ?? null,
        metadata: Object.fromEntries(
          Object.entries(head.Metadata ?? {}).flatMap(([key, value]) =>
            value === undefined ? [] : [[key.toLowerCase(), value]],
          ),
        ),
      };
    } catch (error) {
      const metadata = error as {
        name?: string;
        $metadata?: { httpStatusCode?: number };
      };
      if (
        metadata.name === 'NotFound' ||
        metadata.name === 'NoSuchKey' ||
        metadata.$metadata?.httpStatusCode === 404
      ) {
        return null;
      }
      throw error;
    }
  }

  async createDownloadGrant(
    input: CreateDownloadGrantInput,
  ): Promise<DownloadGrant> {
    this.requirePrivateBucket(input.bucket);
    const encodedFilename = encodeURIComponent(input.originalName).replace(
      /['()*]/g,
      (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    const command = new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.objectKey,
      ResponseContentDisposition: `attachment; filename*=UTF-8''${encodedFilename}`,
    });
    return {
      url: await getSignedUrl(this.client, command, {
        expiresIn: input.expiresInSeconds,
      }),
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1_000),
    };
  }

  async deleteObject(location: ObjectLocation): Promise<void> {
    this.requirePrivateBucket(location.bucket);
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: location.bucket,
        Key: location.objectKey,
      }),
    );
  }

  private requirePrivateBucket(bucket: string): void {
    if (bucket !== this.privateBucket) {
      throw new ObjectStorageConfigurationException();
    }
  }
}
