import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  DataDecryptionException,
  DataEncryptionConfigurationException,
} from '../memory.errors';
import type {
  DataEncryptionPort,
  OpenFieldSet,
  SealedFieldSet,
} from '../ports/data-encryption.port';

const AES_KEY_BYTES = 32;
const NONCE_SEED_BYTES = 24;
const GCM_NONCE_BYTES = 12;
const GCM_TAG_BYTES = 16;

@Injectable()
export class AesGcmDataEncryptionAdapter implements DataEncryptionPort {
  private readonly logger = new Logger(AesGcmDataEncryptionAdapter.name);
  private readonly key: Buffer;
  private readonly keyId: string;

  constructor(config: ConfigService) {
    const encodedKey = config.get<string>('DATA_ENCRYPTION_KEY_BASE64');
    const configuredKeyId = config.get<string>('DATA_ENCRYPTION_KEY_ID');
    const production = config.get<string>('NODE_ENV') === 'production';

    if (encodedKey || configuredKeyId) {
      if (!encodedKey || !configuredKeyId) {
        throw new DataEncryptionConfigurationException();
      }
      const decoded = this.decodeKey(encodedKey);
      if (decoded.length !== AES_KEY_BYTES || configuredKeyId.length > 64) {
        throw new DataEncryptionConfigurationException();
      }
      this.key = decoded;
      this.keyId = configuredKeyId;
      return;
    }

    if (production) {
      throw new DataEncryptionConfigurationException();
    }

    // Development without a key is still encrypted at rest. The ephemeral key
    // deliberately cannot decrypt data after process restart; persistent local
    // data must opt in with an explicit development key.
    this.key = randomBytes(AES_KEY_BYTES);
    this.keyId = 'development-ephemeral';
    this.logger.warn(
      'DATA_ENCRYPTION_KEY_BASE64 is absent; using a process-local ephemeral development key',
    );
  }

  sealFields<Field extends string>(
    fields: Readonly<Record<Field, string | null>>,
    authenticatedContext: string,
  ): SealedFieldSet<Field> {
    const nonceSeed = randomBytes(NONCE_SEED_BYTES);
    const ciphertexts = {} as Record<Field, Buffer | null>;
    const contentHashes = {} as Record<Field, Buffer | null>;

    for (const field of Object.keys(fields) as Field[]) {
      const plaintext = fields[field];
      if (plaintext === null) {
        ciphertexts[field] = null;
        contentHashes[field] = null;
        continue;
      }

      const encoded = Buffer.from(plaintext, 'utf8');
      const cipher = createCipheriv(
        'aes-256-gcm',
        this.key,
        this.deriveNonce(nonceSeed, authenticatedContext, field),
        { authTagLength: GCM_TAG_BYTES },
      );
      cipher.setAAD(this.aad(authenticatedContext, field));
      ciphertexts[field] = Buffer.concat([
        cipher.update(encoded),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
      contentHashes[field] = createHash('sha256').update(encoded).digest();
    }

    return {
      ciphertexts,
      contentHashes,
      nonceSeed,
      keyId: this.keyId,
    };
  }

  openFields<Field extends string>(
    sealed: OpenFieldSet<Field>,
    authenticatedContext: string,
  ): Record<Field, string | null> {
    if (
      sealed.keyId !== this.keyId ||
      sealed.nonceSeed.length !== NONCE_SEED_BYTES
    ) {
      throw new DataDecryptionException();
    }

    try {
      const plaintexts = {} as Record<Field, string | null>;
      for (const field of Object.keys(sealed.ciphertexts) as Field[]) {
        const ciphertextAndTag = sealed.ciphertexts[field];
        if (ciphertextAndTag === null) {
          plaintexts[field] = null;
          continue;
        }
        if (ciphertextAndTag.length < GCM_TAG_BYTES) {
          throw new Error('ciphertext is shorter than the authentication tag');
        }

        const ciphertext = ciphertextAndTag.subarray(
          0,
          ciphertextAndTag.length - GCM_TAG_BYTES,
        );
        const tag = ciphertextAndTag.subarray(
          ciphertextAndTag.length - GCM_TAG_BYTES,
        );
        const decipher = createDecipheriv(
          'aes-256-gcm',
          this.key,
          this.deriveNonce(
            nonceSeedCopy(sealed.nonceSeed),
            authenticatedContext,
            field,
          ),
          { authTagLength: GCM_TAG_BYTES },
        );
        decipher.setAAD(this.aad(authenticatedContext, field));
        decipher.setAuthTag(tag);
        const encoded = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]);
        const expectedHash = sealed.contentHashes?.[field];
        if (expectedHash) {
          const actualHash = createHash('sha256').update(encoded).digest();
          if (
            expectedHash.length !== actualHash.length ||
            !timingSafeEqual(expectedHash, actualHash)
          ) {
            throw new Error('content hash mismatch');
          }
        }
        plaintexts[field] = encoded.toString('utf8');
      }
      return plaintexts;
    } catch (error) {
      if (error instanceof DataDecryptionException) {
        throw error;
      }
      throw new DataDecryptionException();
    }
  }

  private deriveNonce(
    nonceSeed: Buffer,
    authenticatedContext: string,
    field: string,
  ): Buffer {
    return createHmac('sha256', this.key)
      .update('memory-lighthouse:aes-gcm-nonce:v1\0')
      .update(nonceSeed)
      .update('\0')
      .update(authenticatedContext)
      .update('\0')
      .update(field)
      .digest()
      .subarray(0, GCM_NONCE_BYTES);
  }

  private aad(authenticatedContext: string, field: string): Buffer {
    return Buffer.from(
      `memory-lighthouse:data:v1\0${authenticatedContext}\0${field}\0${this.keyId}`,
      'utf8',
    );
  }

  private decodeKey(encoded: string): Buffer {
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded) || encoded.length % 4 !== 0) {
      throw new DataEncryptionConfigurationException();
    }
    return Buffer.from(encoded, 'base64');
  }
}

function nonceSeedCopy(value: Buffer): Buffer {
  return Buffer.from(value);
}
