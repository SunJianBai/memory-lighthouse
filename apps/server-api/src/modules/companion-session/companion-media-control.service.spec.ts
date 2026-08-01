import { describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '../../infrastructure/database/prisma.service';
import { CompanionMediaControlService } from './companion-media-control.service';

jest.mock('../../infrastructure/database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('CompanionMediaControlService', () => {
  it('owns the atomic interruption of active model and companion sessions', async () => {
    const transaction = {
      modelSession: { updateMany: jest.fn(async () => ({ count: 1 })) },
      companionSession: { updateMany: jest.fn(async () => ({ count: 1 })) },
    };
    const service = new CompanionMediaControlService({} as PrismaService);
    const occurredAt = new Date('2026-08-02T08:00:00.000Z');

    await service.interruptForRemoteAssistance(
      transaction as never,
      'binding-1',
      occurredAt,
    );

    expect(transaction.modelSession.updateMany.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        where: {
          companionSession: { bindingId: 'binding-1', status: 'ACTIVE' },
          status: 'ACTIVE',
        },
        data: expect.objectContaining({
          status: 'ENDED',
          endedAt: occurredAt,
          endReason: 'REMOTE_ASSISTANCE_ACCEPTED',
        }),
      }),
    );
    expect(transaction.companionSession.updateMany).toHaveBeenCalledTimes(1);
  });

  it('checks an AI lease owner through the Companion Session boundary', async () => {
    const prisma = {
      companionSession: {
        findFirst: jest.fn(async () => ({ id: 'session-1' })),
      },
    };
    const service = new CompanionMediaControlService(
      prisma as unknown as PrismaService,
    );

    await expect(
      service.isActiveLeaseOwner('binding-1', 'session-1'),
    ).resolves.toBe(true);
    expect(prisma.companionSession.findFirst.mock.calls[0]?.[0]).toEqual({
      where: {
        id: 'session-1',
        bindingId: 'binding-1',
        status: 'ACTIVE',
      },
      select: { id: true },
    });
  });
});
