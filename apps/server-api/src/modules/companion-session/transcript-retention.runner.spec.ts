import { describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import type { TranscriptRetentionApplicationService } from './transcript-retention.application.service';
import { TranscriptRetentionRunner } from './transcript-retention.runner';

function runner(
  retention: TranscriptRetentionApplicationService,
  values: Record<string, string | number> = {},
) {
  return new TranscriptRetentionRunner(
    retention,
    new ConfigService({ NODE_ENV: 'test', ...values }),
  );
}

describe('TranscriptRetentionRunner', () => {
  it('drains bounded batches using one stable cutoff', async () => {
    const purgeExpired = jest
      .fn<TranscriptRetentionApplicationService['purgeExpired']>()
      .mockResolvedValueOnce({ purged: 2, hasMore: true })
      .mockResolvedValueOnce({ purged: 1, hasMore: false });
    const subject = runner(
      { purgeExpired } as TranscriptRetentionApplicationService,
      { TRANSCRIPT_PURGE_BATCH_SIZE: 2 },
    );
    const now = new Date('2026-08-01T12:00:00.000Z');

    await subject.tick(now);

    expect(purgeExpired).toHaveBeenNthCalledWith(1, now, 2);
    expect(purgeExpired).toHaveBeenNthCalledWith(2, now, 2);
  });

  it('does not overlap ticks', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const purgeExpired = jest.fn(async () => {
      await pending;
      return { purged: 0, hasMore: false };
    });
    const subject = runner({
      purgeExpired,
    } as TranscriptRetentionApplicationService);

    const first = subject.tick();
    await subject.tick();
    expect(purgeExpired).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });
});
