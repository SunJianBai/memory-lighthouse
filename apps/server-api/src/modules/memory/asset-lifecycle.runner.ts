import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AssetApplicationService } from './asset.application.service';
import { AssetContentScannerService } from './asset-content-scanner.service';
import {
  AssetLifecycleQueue,
  type AssetLifecycleJob,
} from './asset-lifecycle.queue';
import { ASSET_LIFECYCLE_EVENT } from './memory.constants';

@Injectable()
export class AssetLifecycleRunner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(AssetLifecycleRunner.name);
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | undefined;
  private stopping = false;
  private recoveryCursor: string | null = null;

  constructor(
    private readonly queue: AssetLifecycleQueue,
    private readonly scanner: AssetContentScannerService,
    private readonly assets: AssetApplicationService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.enabled()) {
      return;
    }
    const intervalMs = this.integerConfig(
      'ASSET_LIFECYCLE_INTERVAL_MS',
      5_000,
      1_000,
      300_000,
    );
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
    void this.tick();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
    await this.running;
  }

  async tick(now = new Date()): Promise<void> {
    if (this.running || this.stopping) {
      return;
    }
    this.running = this.runTick(now);
    try {
      await this.running;
    } finally {
      this.running = undefined;
    }
  }

  private async runTick(now: Date): Promise<void> {
    try {
      const recoveryBatch = this.integerConfig(
        'ASSET_LIFECYCLE_RECOVERY_BATCH_SIZE',
        100,
        1,
        1_000,
      );
      this.recoveryCursor = await this.queue.recoverMissingJobs(
        this.recoveryCursor,
        recoveryBatch,
        now,
      );

      const concurrency = this.integerConfig(
        'ASSET_LIFECYCLE_CONCURRENCY',
        2,
        1,
        8,
      );
      const batchSize = this.integerConfig(
        'ASSET_LIFECYCLE_BATCH_SIZE',
        20,
        1,
        200,
      );
      const leaseMs = this.integerConfig(
        'ASSET_LIFECYCLE_LEASE_MS',
        300_000,
        60_000,
        1_800_000,
      );

      let processed = 0;
      while (processed < batchSize && !this.stopping) {
        const jobs: AssetLifecycleJob[] = [];
        const slots = Math.min(concurrency, batchSize - processed);
        for (let index = 0; index < slots; index += 1) {
          const job = await this.queue.claim(now, leaseMs);
          if (!job) {
            break;
          }
          jobs.push(job);
        }
        if (jobs.length === 0) {
          break;
        }
        await Promise.all(jobs.map((job) => this.process(job, now)));
        processed += jobs.length;
      }
    } catch (error) {
      this.logger.error(
        `Asset lifecycle tick failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }

  private async process(job: AssetLifecycleJob, now: Date): Promise<void> {
    try {
      if (job.eventType === ASSET_LIFECYCLE_EVENT.scanRequested) {
        await this.scanner.scanPendingAsset(job.assetId);
      } else {
        await this.assets.deletePendingAsset(job.assetId);
      }
      await this.queue.acknowledge(job, new Date());
    } catch {
      const delayMs = this.retryDelay(job.attemptCount);
      const failureCode =
        job.eventType === ASSET_LIFECYCLE_EVENT.scanRequested
          ? 'ASSET_SCAN_FAILED'
          : 'ASSET_DELETE_FAILED';
      await this.queue.retry(
        job,
        new Date(now.getTime() + delayMs),
        failureCode,
      );
      this.logger.warn(`Asset lifecycle job will retry: ${failureCode}`);
    }
  }

  private retryDelay(attemptCount: number): number {
    const baseMs = this.integerConfig(
      'ASSET_LIFECYCLE_RETRY_BASE_MS',
      1_000,
      100,
      60_000,
    );
    const maximumMs = this.integerConfig(
      'ASSET_LIFECYCLE_RETRY_MAX_MS',
      300_000,
      baseMs,
      3_600_000,
    );
    return Math.min(maximumMs, baseMs * 2 ** Math.min(attemptCount - 1, 16));
  }

  private enabled(): boolean {
    if (this.config.get<string>('NODE_ENV') === 'test') {
      return false;
    }
    return (
      (this.config.get<string>('ASSET_LIFECYCLE_WORKER_ENABLED') ?? 'true')
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
