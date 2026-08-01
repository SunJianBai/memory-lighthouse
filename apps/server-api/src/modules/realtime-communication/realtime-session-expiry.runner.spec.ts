import { describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import type { RealtimeCommunicationApplicationService } from './realtime.application.service';
import { RealtimeSessionExpiryRunner } from './realtime-session-expiry.runner';

function runner(realtime: RealtimeCommunicationApplicationService) {
  return new RealtimeSessionExpiryRunner(
    realtime,
    new ConfigService({ NODE_ENV: 'test' }),
  );
}

describe('RealtimeSessionExpiryRunner', () => {
  it('passes a stable cutoff to the expiry use case', async () => {
    const expireStaleSessions = jest.fn(() =>
      Promise.resolve({ examined: 1, expired: 1, failed: 0 }),
    );
    const subject = runner({
      expireStaleSessions,
    } as RealtimeCommunicationApplicationService);
    const now = new Date('2026-08-01T12:00:00.000Z');

    await subject.tick(now);

    expect(expireStaleSessions).toHaveBeenCalledWith(now);
  });

  it('does not overlap database sweeps', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const expireStaleSessions = jest.fn(async () => {
      await pending;
      return { examined: 0, expired: 0, failed: 0 };
    });
    const subject = runner({
      expireStaleSessions,
    } as RealtimeCommunicationApplicationService);

    const first = subject.tick();
    await subject.tick();
    expect(expireStaleSessions).toHaveBeenCalledTimes(1);
    finish();
    await first;
  });
});
