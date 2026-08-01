import { z } from 'zod';

export const healthStatusSchema = z.object({
  status: z.enum(['ok', 'degraded', 'unavailable']),
  service: z.literal('memory-lighthouse-server-api'),
  timestamp: z.string().datetime({ offset: true }),
  checks: z.record(z.string(), z.enum(['up', 'down'])).optional(),
});

export type HealthStatus = z.infer<typeof healthStatusSchema>;
