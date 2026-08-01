import { describe, expect, it, jest } from '@jest/globals';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';
import { HealthService, ReadinessSnapshot } from './health.service';

describe('HealthController', () => {
  it('returns HTTP 503 semantics when a readiness indicator is down', async () => {
    const snapshot: ReadinessSnapshot = {
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      checks: { database: { status: 'down', message: 'unreachable' } },
    };
    const healthService = {
      getReadiness: jest.fn().mockResolvedValue(snapshot),
    } as unknown as HealthService;
    const controller = new HealthController(healthService);

    await expect(controller.getReadiness()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
