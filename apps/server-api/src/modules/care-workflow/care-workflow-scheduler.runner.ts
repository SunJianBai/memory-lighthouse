import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { OCCURRENCE_SCHEDULER } from './care-workflow.constants';
import type { OccurrenceSchedulerApplication } from './occurrence-scheduler.application';

@Injectable()
export class CareWorkflowSchedulerRunner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(CareWorkflowSchedulerRunner.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    @Inject(OCCURRENCE_SCHEDULER)
    private readonly scheduler: OccurrenceSchedulerApplication,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.enabled()) {
      return;
    }
    const intervalMs = this.integerConfig(
      'CARE_WORKFLOW_SCHEDULER_INTERVAL_MS',
      60_000,
      15_000,
      900_000,
    );
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
    void this.tick();
  }

  onApplicationShutdown(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async tick(now = new Date()): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const horizonHours = this.integerConfig(
        'CARE_WORKFLOW_GENERATION_HORIZON_HOURS',
        24,
        1,
        168,
      );
      const windowStartUtc = new Date(now);
      windowStartUtc.setUTCSeconds(0, 0);
      const windowEndUtc = new Date(
        windowStartUtc.getTime() + horizonHours * 60 * 60 * 1_000,
      );
      await this.scheduler.generateOccurrences({
        windowStartUtc,
        windowEndUtc,
      });
      await this.scheduler.advanceOccurrences({ now, batchSize: 100 });
    } catch (error) {
      this.logger.error(
        `Care workflow scheduler tick failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    } finally {
      this.running = false;
    }
  }

  private enabled(): boolean {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      return false;
    }
    return (
      (this.config.get<string>('CARE_WORKFLOW_SCHEDULER_ENABLED') ?? 'true')
        .trim()
        .toLowerCase() !== 'false'
    );
  }

  private integerConfig(
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ): number {
    const raw = this.config.get<string | number>(name);
    const value = raw === undefined || raw === '' ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
      throw new Error(`${name} is outside its safe range`);
    }
    return value;
  }
}
