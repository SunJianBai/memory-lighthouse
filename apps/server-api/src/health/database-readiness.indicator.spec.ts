import { describe, expect, it, jest } from '@jest/globals';

import { PrismaService } from '../infrastructure/database/prisma.service';
import { DatabaseReadinessIndicator } from './database-readiness.indicator';

describe('DatabaseReadinessIndicator', () => {
  it('reports up when the database answers', async () => {
    const prisma = {
      $queryRaw: jest
        .fn<() => Promise<unknown>>()
        .mockResolvedValue([{ 1: 1 }]),
    } as unknown as PrismaService;

    await expect(
      new DatabaseReadinessIndicator(prisma).check(),
    ).resolves.toEqual({ name: 'database', status: 'up' });
  });

  it('reports a generic failure without leaking a connection error', async () => {
    const prisma = {
      $queryRaw: jest
        .fn<() => Promise<unknown>>()
        .mockRejectedValue(new Error('mysql://user:secret@database/private')),
    } as unknown as PrismaService;

    await expect(
      new DatabaseReadinessIndicator(prisma).check(),
    ).resolves.toEqual({
      name: 'database',
      status: 'down',
      message: 'Database connectivity check failed',
    });
  });
});
