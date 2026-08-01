import { describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import { HealthService } from './health.service';
import {
  READINESS_INDICATORS,
  ReadinessIndicator,
} from './readiness-indicator';

describe('HealthService', () => {
  async function createService(indicators: ReadonlyArray<ReadinessIndicator>) {
    const moduleRef = await Test.createTestingModule({
      providers: [
        HealthService,
        { provide: READINESS_INDICATORS, useValue: indicators },
      ],
    }).compile();

    return moduleRef.get(HealthService);
  }

  it('reports liveness independently of external dependencies', async () => {
    const service = await createService([]);

    expect(service.getLiveness()).toMatchObject({
      status: 'ok',
      service: 'server-api',
    });
  });

  it('reports ready when all injected indicators are up', async () => {
    const service = await createService([
      {
        name: 'database',
        check: () =>
          Promise.resolve({ name: 'database', status: 'up' as const }),
      },
    ]);

    await expect(service.getReadiness()).resolves.toMatchObject({
      status: 'ready',
      checks: { database: { status: 'up' } },
    });
  });

  it('converts an indicator exception into a not-ready result', async () => {
    const service = await createService([
      {
        name: 'database',
        check: () => Promise.reject(new Error('connection refused')),
      },
    ]);

    await expect(service.getReadiness()).resolves.toMatchObject({
      status: 'not_ready',
      checks: {
        database: { status: 'down', message: 'connection refused' },
      },
    });
  });
});
