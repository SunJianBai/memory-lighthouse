export interface EncryptedContent {
  ciphertext: Buffer;
  nonce: Buffer;
  encryptionKeyId: string;
}

export interface CareWorkflowContentCipher {
  encrypt(plaintext: string): EncryptedContent;
  decrypt(content: EncryptedContent): string;
}
