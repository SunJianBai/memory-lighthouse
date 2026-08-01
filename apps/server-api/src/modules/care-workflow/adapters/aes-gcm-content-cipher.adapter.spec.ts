import { ConfigService } from '@nestjs/config';

import { AesGcmContentCipherAdapter } from './aes-gcm-content-cipher.adapter';

describe('AesGcmContentCipherAdapter', () => {
  it('round-trips protected care content and rejects tampering', () => {
    const config = {
      get: jest.fn((key: string) =>
        key === 'CARE_WORKFLOW_ENCRYPTION_KEY' ? 'test-only-secret' : 'test',
      ),
    } as unknown as ConfigService;
    const cipher = new AesGcmContentCipherAdapter(config);
    const encrypted = cipher.encrypt('家属录入的原文');

    expect(encrypted.ciphertext.toString()).not.toContain('家属录入的原文');
    expect(cipher.decrypt(encrypted)).toBe('家属录入的原文');

    const tampered = Buffer.from(encrypted.ciphertext);
    tampered[0] ^= 1;
    expect(() =>
      cipher.decrypt({ ...encrypted, ciphertext: tampered }),
    ).toThrow();
  });
});
