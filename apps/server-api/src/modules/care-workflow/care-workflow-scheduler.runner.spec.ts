import { describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { CareWorkflowSchedulerRunner } from './care-workflow-scheduler.runner';
import type { OccurrenceSchedulerApplication } from './occurrence-scheduler.application';

function runner(
  scheduler: OccurrenceSchedulerApplication,
  values: Record<string, string | number> = {},
) {
  return new CareWorkflowSchedulerRunner(
    scheduler,
    new ConfigService({ NODE_ENV: 'test', ...values }),
  );
}

describe('CareWorkflowSchedulerRunner', () => {
  it('materializes the configured horizon before advancing due work', async () => {
    const scheduler = {
      generateOccurrences: jest.fn(async () => ({ attempted: 0, created: 0 })),
      advanceOccurrences: jest.fn(async () => ({
        awaitingConfirmation: 0,
        needsFamilyReview: 0,
        expired: 0,
      })),
    } satisfies OccurrenceSchedulerApplication;
    const subject = runner(scheduler, {
      CARE_WORKFLOW_GENERATION_HORIZON_HOURS: 2,
    });
    const now = new Date('2026-08-01T12:34:56.789Z');

    await subject.tick(now);

    expect(scheduler.generateOccurrences).toHaveBeenCalledWith({
      windowStartUtc: new Date('2026-08-01T12:34:00.000Z'),
      windowEndUtc: new Date('2026-08-01T14:34:00.000Z'),
    });
    expect(scheduler.advanceOccurrences).toHaveBeenCalledWith({
      now,
      batchSize: 100,
    });
  });

  it('does not overlap ticks when one database pass is still running', async () => {
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const scheduler = {
      generateOccurrences: jest.fn(async () => {
        await pending;
        return { attempted: 0, created: 0 };
      }),
      advanceOccurrences: jest.fn(async () => ({
        awaitingConfirmation: 0,
        needsFamilyReview: 0,
        expired: 0,
      })),
    } satisfies OccurrenceSchedulerApplication;
    const subject = runner(scheduler);

    const first = subject.tick();
    await subject.tick();
    expect(scheduler.generateOccurrences).toHaveBeenCalledTimes(1);
    finish();
    await first;
    expect(scheduler.advanceOccurrences).toHaveBeenCalledTimes(1);
  });
});
