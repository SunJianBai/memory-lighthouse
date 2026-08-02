export interface ObjectLocation {
  bucket: string;
  objectKey: string;
}

export interface CreateUploadGrantInput extends ObjectLocation {
  contentLength: number;
  contentType: string;
  checksumSha256Base64: string;
  metadata: Record<string, string>;
  expiresInSeconds: number;
}

export interface UploadGrant {
  url: string;
  expiresAt: Date;
  requiredHeaders: Record<string, string>;
}

export interface StoredObjectHead {
  contentLength: number | null;
  contentType: string | null;
  checksumSha256Base64: string | null;
  serverSideEncryption: string | null;
  metadata: Record<string, string>;
}

export interface StoredObjectBody {
  content: AsyncIterable<Uint8Array>;
}

export interface CreateDownloadGrantInput extends ObjectLocation {
  originalName: string;
  expiresInSeconds: number;
}

export interface DownloadGrant {
  url: string;
  expiresAt: Date;
}

export interface ObjectStoragePort {
  readonly privateBucket: string;

  createUploadGrant: (input: CreateUploadGrantInput) => Promise<UploadGrant>;
  headObject: (location: ObjectLocation) => Promise<StoredObjectHead | null>;
  readObject: (location: ObjectLocation) => Promise<StoredObjectBody | null>;
  createDownloadGrant: (
    input: CreateDownloadGrantInput,
  ) => Promise<DownloadGrant>;
  deleteObject: (location: ObjectLocation) => Promise<void>;
}
