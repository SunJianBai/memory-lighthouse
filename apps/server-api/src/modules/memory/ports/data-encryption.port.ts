export interface SealedFieldSet<Field extends string = string> {
  ciphertexts: Record<Field, Buffer | null>;
  contentHashes: Record<Field, Buffer | null>;
  nonceSeed: Buffer;
  keyId: string;
}

export interface OpenFieldSet<Field extends string = string> {
  ciphertexts: Record<Field, Buffer | null>;
  contentHashes?: Partial<Record<Field, Buffer | null>>;
  nonceSeed: Buffer;
  keyId: string;
}

/**
 * Interface at the application-encryption seam. A nonce seed belongs to one
 * record version. The Adapter derives a different AES-GCM nonce for every
 * field, so callers never reuse a key/nonce pair.
 */
export interface DataEncryptionPort {
  sealFields<Field extends string>(
    fields: Readonly<Record<Field, string | null>>,
    authenticatedContext: string,
  ): SealedFieldSet<Field>;

  openFields<Field extends string>(
    sealed: OpenFieldSet<Field>,
    authenticatedContext: string,
  ): Record<Field, string | null>;
}
