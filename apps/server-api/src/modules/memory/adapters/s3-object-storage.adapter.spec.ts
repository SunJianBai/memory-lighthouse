import { describe, expect, it, jest } from '@jest/globals';
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
} from '@aws-sdk/client-s3';
import { ConfigService } from '@nestjs/config';

import type { CreateUploadGrantInput } from '../ports/object-storage.port';
import {
  encryptedPutObjectCommand,
  S3ObjectStorageAdapter,
} from './s3-object-storage.adapter';

describe('S3ObjectStorageAdapter SSE-S3 contract', () => {
  const input: CreateUploadGrantInput = {
    bucket: 'openbmb-assets',
    objectKey: 'households/h/asset',
    contentLength: 12,
    contentType: 'image/jpeg',
    checksumSha256Base64: Buffer.alloc(32).toString('base64'),
    metadata: { 'asset-id': 'asset' },
    expiresInSeconds: 60,
  };

  it('signs AES256 as a required PUT header and command property', async () => {
    const adapter = new S3ObjectStorageAdapter(
      new ConfigService({
        OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:19000',
        OBJECT_STORAGE_REGION: 'us-east-1',
        OBJECT_STORAGE_BUCKET: 'openbmb-assets',
        OBJECT_STORAGE_ACCESS_KEY_ID: 'openbmb-api',
        OBJECT_STORAGE_SECRET_ACCESS_KEY: 'x'.repeat(40),
        OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
      }),
    );

    const grant = await adapter.createUploadGrant(input);
    const command = encryptedPutObjectCommand(input);

    expect(grant.requiredHeaders['x-amz-server-side-encryption']).toBe(
      'AES256',
    );
    expect(grant.requiredHeaders['if-none-match']).toBe('*');
    expect(command.input.ServerSideEncryption).toBe('AES256');
    expect(command.input.IfNoneMatch).toBe('*');
  });

  it('permanently deletes every exact object version and delete marker', async () => {
    const adapter = new S3ObjectStorageAdapter(
      new ConfigService({
        OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:19000',
        OBJECT_STORAGE_REGION: 'us-east-1',
        OBJECT_STORAGE_BUCKET: 'openbmb-assets',
        OBJECT_STORAGE_ACCESS_KEY_ID: 'openbmb-api',
        OBJECT_STORAGE_SECRET_ACCESS_KEY: 'x'.repeat(40),
        OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
      }),
    );
    const client = (
      adapter as unknown as {
        client: { send(command: unknown): Promise<unknown> };
      }
    ).client;
    let headCalls = 0;
    let listCalls = 0;
    const send = jest
      .spyOn(client, 'send')
      .mockImplementation(async (command) => {
        if (command instanceof HeadObjectCommand) {
          headCalls += 1;
          if (headCalls === 1) {
            return { ContentLength: 12 };
          }
          throw Object.assign(new Error('not found'), {
            $metadata: { httpStatusCode: 404 },
          });
        }
        if (command instanceof ListObjectVersionsCommand) {
          listCalls += 1;
          return listCalls === 1
            ? {
                Versions: [
                  { Key: input.objectKey, VersionId: 'version-2' },
                  { Key: `${input.objectKey}-other`, VersionId: 'unrelated' },
                ],
                DeleteMarkers: [
                  { Key: input.objectKey, VersionId: 'delete-marker-1' },
                ],
                IsTruncated: false,
              }
            : { Versions: [], DeleteMarkers: [], IsTruncated: false };
        }
        if (command instanceof DeleteObjectsCommand) {
          return { Errors: [] };
        }
        throw new Error(`Unexpected command: ${command?.constructor.name}`);
      });

    await adapter.deleteObject({
      bucket: input.bucket,
      objectKey: input.objectKey,
    });

    const commands = send.mock.calls.map(([command]) => command);
    const deletion = commands.find(
      (command) => command instanceof DeleteObjectsCommand,
    );
    expect(deletion).toBeInstanceOf(DeleteObjectsCommand);
    if (!(deletion instanceof DeleteObjectsCommand)) {
      throw new Error('version deletion command not issued');
    }
    expect(deletion.input.Delete?.Objects).toEqual([
      { Key: input.objectKey, VersionId: 'version-2' },
      { Key: input.objectKey, VersionId: 'delete-marker-1' },
    ]);
    expect(
      commands.some((command) => command instanceof DeleteObjectCommand),
    ).toBe(false);
  });
});
