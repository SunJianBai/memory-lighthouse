import { describe, expect, it } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import {
  DataDecryptionException,
  DataEncryptionConfigurationException,
} from '../memory.errors';
import { AesGcmDataEncryptionAdapter } from './aes-gcm-data-encryption.adapter';

describe('AesGcmDataEncryptionAdapter', () => {
  const key = Buffer.alloc(32, 0x5a).toString('base64');

  function adapter(
    values: Record<string, string | undefined> = {},
  ): AesGcmDataEncryptionAdapter {
    const config = {
      get: (name: string): string | undefined =>
        values[name] ??
        (
          {
            NODE_ENV: 'test',
            DATA_ENCRYPTION_KEY_BASE64: key,
            DATA_ENCRYPTION_KEY_ID: 'test-key-v1',
          } as Record<string, string>
        )[name],
    } as ConfigService;
    return new AesGcmDataEncryptionAdapter(config);
  }

  it('encrypts every sensitive field, authenticates context, and never stores plaintext', () => {
    const encryption = adapter();
    const plaintext = '周日下午和女儿在西湖边散步';
    const sealed = encryption.sealFields(
      { content: plaintext, note: '饭后服用' },
      'memory:01:revision:1',
    );

    expect(sealed.nonceSeed).toHaveLength(24);
    expect(sealed.keyId).toBe('test-key-v1');
    expect(sealed.ciphertexts.content?.includes(Buffer.from(plaintext))).toBe(
      false,
    );
    expect(sealed.ciphertexts.note?.includes(Buffer.from('饭后服用'))).toBe(
      false,
    );
    expect(encryption.openFields(sealed, 'memory:01:revision:1')).toEqual({
      content: plaintext,
      note: '饭后服用',
    });

    const second = encryption.sealFields(
      { content: plaintext, note: '饭后服用' },
      'memory:01:revision:1',
    );
    expect(second.nonceSeed.equals(sealed.nonceSeed)).toBe(false);
    expect(
      second.ciphertexts.content?.equals(sealed.ciphertexts.content!),
    ).toBe(false);
  });

  it('rejects tampering and a different authenticated context', () => {
    const encryption = adapter();
    const sealed = encryption.sealFields(
      { content: '受保护正文' },
      'memory:01:revision:1',
    );
    const tampered = Buffer.from(sealed.ciphertexts.content!);
    tampered[0] ^= 0xff;

    expect(() =>
      encryption.openFields(
        { ...sealed, ciphertexts: { content: tampered } },
        'memory:01:revision:1',
      ),
    ).toThrow(DataDecryptionException);
    expect(() =>
      encryption.openFields(sealed, 'memory:other:revision:1'),
    ).toThrow(DataDecryptionException);
  });

  it('refuses to start production without an explicit 256-bit key and key id', () => {
    const config = {
      get: (name: string): string | undefined =>
        name === 'NODE_ENV' ? 'production' : undefined,
    } as ConfigService;

    expect(() => new AesGcmDataEncryptionAdapter(config)).toThrow(
      DataEncryptionConfigurationException,
    );
  });
});
