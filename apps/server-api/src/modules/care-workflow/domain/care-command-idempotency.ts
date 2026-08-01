import { createHash, timingSafeEqual } from 'node:crypto';

import { Prisma } from '../../../infrastructure/database/generated/prisma/client';
import { newUlid } from '../../identity/domain/ulid';
import { IdempotencyConflictException } from '../care-workflow.errors';
import type { CareWorkflowContentCipher } from '../ports/content-cipher.port';

type TransactionClient = Prisma.TransactionClient;

const canonicalize = (value: unknown): unknown => {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? value.normalize('NFC') : value;
  }
  if (Array.isArray(value)) return value.map(canonicalize);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]),
  );
};

export const fingerprintCareCommand = (
  command: Record<string, unknown>,
): Buffer =>
  createHash('sha256')
    .update(JSON.stringify(canonicalize(command)), 'utf8')
    .digest();

export async function replayCareCommand<T>(
  transaction: TransactionClient,
  idempotencyKey: string,
  commandType: string,
  commandFingerprint: Uint8Array,
  cipher: CareWorkflowContentCipher,
): Promise<T | null> {
  const receipt = await transaction.careCommandReceipt.findUnique({
    where: { idempotencyKey },
    select: {
      commandType: true,
      commandFingerprint: true,
      resultCiphertext: true,
      resultNonce: true,
      encryptionKeyId: true,
    },
  });
  if (!receipt) return null;

  const stored = Buffer.from(receipt.commandFingerprint);
  const requested = Buffer.from(commandFingerprint);
  if (
    receipt.commandType !== commandType ||
    stored.length !== requested.length ||
    !timingSafeEqual(stored, requested)
  ) {
    throw new IdempotencyConflictException();
  }
  return JSON.parse(
    cipher.decrypt({
      ciphertext: Buffer.from(receipt.resultCiphertext),
      nonce: Buffer.from(receipt.resultNonce),
      encryptionKeyId: receipt.encryptionKeyId,
    }),
  ) as T;
}

export async function saveCareCommand<T>(
  transaction: TransactionClient,
  now: Date,
  idempotencyKey: string,
  commandType: string,
  commandFingerprint: Uint8Array,
  result: T,
  cipher: CareWorkflowContentCipher,
): Promise<T> {
  const protectedResult = cipher.encrypt(JSON.stringify(result));
  await transaction.careCommandReceipt.create({
    data: {
      id: newUlid(now.getTime()),
      idempotencyKey,
      commandType,
      commandFingerprint: Uint8Array.from(commandFingerprint),
      resultCiphertext: Uint8Array.from(protectedResult.ciphertext),
      resultNonce: Uint8Array.from(protectedResult.nonce),
      encryptionKeyId: protectedResult.encryptionKeyId,
      createdAt: now,
    },
  });
  return result;
}
