import { describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '../../infrastructure/database/prisma.service';
import { CompanionMediaControlService } from './companion-media-control.service';

jest.mock('../../infrastructure/database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

describe('CompanionMediaControlService', () => {
  it('owns generic active-session termination, reason normalization, and outbox emission', async () => {
    const occurredAt = new Date('2026-08-02T08:00:00.000Z');
    const sessions = [
      {
        id: 'session-winner',
        householdId: 'household-1',
        recipientId: 'recipient-1',
        bindingId: 'binding-1',
      },
      {
        id: 'session-raced',
        householdId: 'household-1',
        recipientId: 'recipient-1',
        bindingId: 'binding-2',
      },
    ];
    const modelSession = {
      updateMany: jest.fn(async () => ({ count: 1 })),
    };
    const companionSession = {
      findMany: jest.fn(async () => sessions),
      updateMany: jest
        .fn<(...arguments_: never[]) => Promise<{ count: number }>>()
        .mockResolvedValueOnce({ count: 1 })
        .mockResolvedValueOnce({ count: 0 }),
    };
    const outboxEvent = {
      create: jest.fn(async ({ data }) => data),
    };
    const transaction = { modelSession, companionSession, outboxEvent };
    const service = new CompanionMediaControlService({} as PrismaService);
    const reason = `CONSENT_REVOKED_${'X'.repeat(80)}`;
    await expect(
      service.endForBindingRevocation(
        transaction as never,
        'binding-scope',
        reason,
        occurredAt,
      ),
    ).resolves.toBe(1);

    const normalizedReason = reason.slice(0, 64);
    expect(companionSession.findMany).toHaveBeenCalledWith({
      where: {
        bindingId: 'binding-scope',
        status: 'ACTIVE',
      },
    });
    expect(modelSession.updateMany).toHaveBeenNthCalledWith(1, {
      where: { companionSessionId: 'session-winner', status: 'ACTIVE' },
      data: {
        status: 'ENDED',
        endedAt: occurredAt,
        endReason: normalizedReason,
      },
    });
    expect(modelSession.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      companionSession.updateMany.mock.invocationCallOrder[0]!,
    );
    expect(outboxEvent.create).toHaveBeenCalledTimes(1);
    expect(outboxEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        aggregateType: 'CompanionSession',
        aggregateId: 'session-winner',
        eventType: 'CompanionSessionEnded',
        payloadJson: {
          householdId: 'household-1',
          recipientId: 'recipient-1',
          bindingId: 'binding-1',
          reason: normalizedReason,
        },
        occurredAt,
        availableAt: occurredAt,
      }),
    });
  });

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
