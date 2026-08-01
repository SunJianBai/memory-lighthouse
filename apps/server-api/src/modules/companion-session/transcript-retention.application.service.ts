import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infrastructure/database/prisma.service';

export interface TranscriptPurgeResult {
  purged: number;
  hasMore: boolean;
}

@Injectable()
export class TranscriptRetentionApplicationService {
  constructor(private readonly prisma: PrismaService) {}

  async purgeExpired(
    now = new Date(),
    batchSize = 100,
  ): Promise<TranscriptPurgeResult> {
    if (
      !Number.isSafeInteger(batchSize) ||
      batchSize < 1 ||
      batchSize > 1_000
    ) {
      throw new Error('Transcript purge batch size is outside its safe range');
    }

    const expired = await this.prisma.conversationUtteranceContent.findMany({
      where: {
        purgedAt: null,
        retentionUntil: { not: null, lte: now },
      },
      orderBy: [{ retentionUntil: 'asc' }, { utteranceId: 'asc' }],
      take: batchSize,
      select: { utteranceId: true },
    });
    if (expired.length === 0) {
      return { purged: 0, hasMore: false };
    }

    const result = await this.prisma.conversationUtteranceContent.updateMany({
      where: {
        utteranceId: { in: expired.map(({ utteranceId }) => utteranceId) },
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

    return { purged: result.count, hasMore: expired.length === batchSize };
  }
}
