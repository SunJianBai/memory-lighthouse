import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { TranscriptRetentionApplicationService } from './transcript-retention.application.service';

@Injectable()
export class TranscriptRetentionRunner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(TranscriptRetentionRunner.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly retention: TranscriptRetentionApplicationService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.enabled()) {
      return;
    }
    const intervalMs = this.integerConfig(
      'TRANSCRIPT_PURGE_INTERVAL_MS',
      300_000,
      60_000,
      86_400_000,
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
      const batchSize = this.integerConfig(
        'TRANSCRIPT_PURGE_BATCH_SIZE',
        100,
        1,
        1_000,
      );
      let batches = 0;
      let hasMore = true;
      while (hasMore && batches < 10) {
        const result = await this.retention.purgeExpired(now, batchSize);
        hasMore = result.hasMore;
        batches += 1;
      }
    } catch (error) {
      this.logger.error(
        `Transcript retention tick failed: ${error instanceof Error ? error.name : 'unknown'}`,
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
      (this.config.get<string>('TRANSCRIPT_PURGE_ENABLED') ?? 'true')
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
