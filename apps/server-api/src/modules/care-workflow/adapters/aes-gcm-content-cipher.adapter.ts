import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CARE_WORKFLOW_ENCRYPTION_KEY_ID } from '../care-workflow.constants';
import type {
  CareWorkflowContentCipher,
  EncryptedContent,
} from '../ports/content-cipher.port';

const AUTH_TAG_BYTES = 16;
const NONCE_BYTES = 24;

@Injectable()
export class AesGcmContentCipherAdapter implements CareWorkflowContentCipher {
  private readonly key: Buffer;

  constructor(config: ConfigService) {
    const configured = config.get<string>('CARE_WORKFLOW_ENCRYPTION_KEY');
    if (!configured) {
      // This development-only material keeps local tests bootable. Production
      // refuses it below, so protected content can never silently use it.
      if (config.get<string>('NODE_ENV') === 'production') {
        throw new Error(
          'CARE_WORKFLOW_ENCRYPTION_KEY is required in production',
        );
      }
      this.key = createHash('sha256')
        .update('memory-lighthouse-local-care-workflow-key')
        .digest();
      return;
    }
    this.key = createHash('sha256').update(configured).digest();
  }

  encrypt(plaintext: string): EncryptedContent {
    const nonce = randomBytes(NONCE_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    const ciphertext = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    return {
      ciphertext,
      nonce,
      encryptionKeyId: CARE_WORKFLOW_ENCRYPTION_KEY_ID,
    };
  }

  decrypt(content: EncryptedContent): string {
    if (content.ciphertext.length < AUTH_TAG_BYTES) {
      throw new Error('Encrypted care-workflow content is truncated');
    }
    const encrypted = content.ciphertext.subarray(0, -AUTH_TAG_BYTES);
    const authTag = content.ciphertext.subarray(-AUTH_TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.key, content.nonce);
    decipher.setAuthTag(authTag);
    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }
}
