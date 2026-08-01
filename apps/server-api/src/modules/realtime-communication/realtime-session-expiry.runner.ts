import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { RealtimeCommunicationApplicationService } from './realtime.application.service';

@Injectable()
export class RealtimeSessionExpiryRunner
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(RealtimeSessionExpiryRunner.name);
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly realtime: RealtimeCommunicationApplicationService,
    private readonly config: ConfigService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.enabled()) {
      return;
    }
    const intervalMs = this.intervalMs();
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
      await this.realtime.expireStaleSessions(now);
    } catch (error) {
      this.logger.error(
        `Realtime expiry tick failed: ${error instanceof Error ? error.name : 'unknown'}`,
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
      (this.config.get<string>('REMOTE_SESSION_EXPIRY_ENABLED') ?? 'true')
        .trim()
        .toLowerCase() !== 'false'
    );
  }

  private intervalMs(): number {
    const raw = this.config.get<string | number>(
      'REMOTE_SESSION_EXPIRY_INTERVAL_MS',
    );
    const parsed = raw === undefined || raw === '' ? 15_000 : Number(raw);
    if (!Number.isSafeInteger(parsed) || parsed < 5_000 || parsed > 60_000) {
      throw new Error(
        'REMOTE_SESSION_EXPIRY_INTERVAL_MS is outside its safe range',
      );
    }
    return parsed;
  }
}
