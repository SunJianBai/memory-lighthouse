import { Inject, Injectable } from '@nestjs/common';
import {
  READINESS_INDICATORS,
  ReadinessCheckResult,
  ReadinessIndicator,
} from './readiness-indicator';

export interface LivenessSnapshot {
  status: 'ok';
  service: 'server-api';
  timestamp: string;
  uptimeSeconds: number;
}

export interface ReadinessSnapshot {
  status: 'ready' | 'not_ready';
  timestamp: string;
  checks: Record<string, Omit<ReadinessCheckResult, 'name'>>;
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(READINESS_INDICATORS)
    private readonly readinessIndicators: ReadonlyArray<ReadinessIndicator>,
  ) {}

  getLiveness(): LivenessSnapshot {
    return {
      status: 'ok',
      service: 'server-api',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.floor(process.uptime()),
    };
  }

  async getReadiness(): Promise<ReadinessSnapshot> {
    const results = await Promise.all(
      this.readinessIndicators.map(async (indicator) => {
        try {
          return await indicator.check();
        } catch (error: unknown) {
          return {
            name: indicator.name,
            status: 'down' as const,
            message: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }),
    );
    const checks = Object.fromEntries(
      results.map(({ name, ...result }) => [name, result]),
    );

    return {
      status: results.every((result) => result.status === 'up')
        ? 'ready'
        : 'not_ready',
      timestamp: new Date().toISOString(),
      checks,
    };
  }
}
