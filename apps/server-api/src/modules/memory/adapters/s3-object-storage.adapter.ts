import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
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
  StoredObjectBody,
  StoredObjectHead,
  UploadGrant,
} from '../ports/object-storage.port';

export function encryptedPutObjectCommand(
  input: CreateUploadGrantInput,
): PutObjectCommand {
  return new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.objectKey,
    ContentLength: input.contentLength,
    ContentType: input.contentType,
    ChecksumSHA256: input.checksumSha256Base64,
    ServerSideEncryption: 'AES256',
    IfNoneMatch: '*',
    Metadata: input.metadata,
  });
}

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
      'if-none-match': '*',
      'x-amz-checksum-sha256': input.checksumSha256Base64,
      'x-amz-server-side-encryption': 'AES256',
      ...Object.fromEntries(
        Object.entries(input.metadata).map(([name, value]) => [
          `x-amz-meta-${name}`,
          value,
        ]),
      ),
    };
    const command = encryptedPutObjectCommand(input);
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
        serverSideEncryption: head.ServerSideEncryption ?? null,
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

  async readObject(location: ObjectLocation): Promise<StoredObjectBody | null> {
    this.requirePrivateBucket(location.bucket);
    try {
      const response = await this.client.send(
        new GetObjectCommand({
          Bucket: location.bucket,
          Key: location.objectKey,
        }),
      );
      const body = response.Body;
      if (
        !body ||
        typeof (body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator] !==
          'function'
      ) {
        throw new ObjectStorageConfigurationException();
      }
      return { content: body as AsyncIterable<Uint8Array> };
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
    const wasVisible = (await this.headObject(location)) !== null;
    const versions = await this.listExactObjectVersions(location);

    if (versions.length > 0) {
      for (let offset = 0; offset < versions.length; offset += 1_000) {
        const response = await this.client.send(
          new DeleteObjectsCommand({
            Bucket: location.bucket,
            Delete: {
              Objects: versions.slice(offset, offset + 1_000),
              Quiet: true,
            },
          }),
        );
        if ((response.Errors?.length ?? 0) > 0) {
          throw new ObjectStorageConfigurationException();
        }
      }
    } else if (wasVisible) {
      // Compatibility path for an unexpectedly non-versioned bucket. The
      // managed bucket is versioned, so its normal path always deletes exact
      // version ids (including delete markers) above.
      await this.client.send(
        new DeleteObjectCommand({
          Bucket: location.bucket,
          Key: location.objectKey,
        }),
      );
    }

    // A simple DELETE on a versioned bucket only creates a delete marker. Do
    // not mark database metadata DELETED until no historical bytes remain.
    const remaining = await this.listExactObjectVersions(location);
    const stillVisible = await this.headObject(location);
    if (remaining.length > 0 || stillVisible !== null) {
      throw new ObjectStorageConfigurationException();
    }
  }

  private async listExactObjectVersions(
    location: ObjectLocation,
  ): Promise<Array<{ Key: string; VersionId: string }>> {
    const matches: Array<{ Key: string; VersionId: string }> = [];
    let keyMarker: string | undefined;
    let versionIdMarker: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const response = await this.client.send(
        new ListObjectVersionsCommand({
          Bucket: location.bucket,
          Prefix: location.objectKey,
          KeyMarker: keyMarker,
          VersionIdMarker: versionIdMarker,
        }),
      );
      for (const entry of [
        ...(response.Versions ?? []),
        ...(response.DeleteMarkers ?? []),
      ]) {
        if (entry.Key === location.objectKey && entry.VersionId) {
          matches.push({ Key: entry.Key, VersionId: entry.VersionId });
        }
      }
      if (!response.IsTruncated) {
        hasMore = false;
        continue;
      }
      if (
        !response.NextKeyMarker ||
        (response.NextKeyMarker === keyMarker &&
          response.NextVersionIdMarker === versionIdMarker)
      ) {
        throw new ObjectStorageConfigurationException();
      }
      keyMarker = response.NextKeyMarker;
      versionIdMarker = response.NextVersionIdMarker;
    }

    return matches;
  }

  private requirePrivateBucket(bucket: string): void {
    if (bucket !== this.privateBucket) {
      throw new ObjectStorageConfigurationException();
    }
  }
}
