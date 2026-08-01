import { describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '../../infrastructure/database/prisma.service';
import { TranscriptRetentionApplicationService } from './transcript-retention.application.service';

function subjectWith(options: {
  expiredIds?: string[];
  updatedCount?: number;
}) {
  const findMany = jest.fn(() =>
    Promise.resolve(
      (options.expiredIds ?? []).map((utteranceId) => ({ utteranceId })),
    ),
  );
  const updateMany = jest.fn(() =>
    Promise.resolve({
      count: options.updatedCount ?? options.expiredIds?.length ?? 0,
    }),
  );
  const prisma = {
    conversationUtteranceContent: { findMany, updateMany },
  } as unknown as PrismaService;
  return {
    subject: new TranscriptRetentionApplicationService(prisma),
    findMany,
    updateMany,
  };
}

describe('TranscriptRetentionApplicationService', () => {
  it('removes all encrypted components but keeps the metadata row', async () => {
    const now = new Date('2026-08-01T12:00:00.000Z');
    const { subject, updateMany } = subjectWith({
      expiredIds: ['01J00000000000000000000001'],
    });

    await expect(subject.purgeExpired(now, 100)).resolves.toEqual({
      purged: 1,
      hasMore: false,
    });
    expect(updateMany).toHaveBeenCalledWith({
      where: {
        utteranceId: { in: ['01J00000000000000000000001'] },
        purgedAt: null,
        retentionUntil: { not: null, lte: now },
      },
      data: {
        rawTextCiphertext: null,
        nonce: null,
        encryptionKeyId: null,
        contentHash: null,
        purgedAt: now,
      },
    });
  });

  it('does not issue a write when no transcript is due', async () => {
    const { subject, updateMany } = subjectWith({});

    await expect(subject.purgeExpired()).resolves.toEqual({
      purged: 0,
      hasMore: false,
    });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('rejects unsafe batch sizes', async () => {
    const { subject } = subjectWith({});

    await expect(subject.purgeExpired(new Date(), 0)).rejects.toThrow(
      'outside its safe range',
    );
  });
});
