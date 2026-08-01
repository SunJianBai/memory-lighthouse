import { describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { LiveKitPort } from './ports/livekit.port';
import type { MediaLeasePort } from './ports/media-lease.port';
import { RemoteMediaSecurityCoordinator } from './remote-media-security.coordinator';

jest.mock('../../infrastructure/database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const session = {
  id: '01J00000000000000000000001',
  householdId: '01J00000000000000000000002',
  recipientId: '01J00000000000000000000003',
  bindingId: '01J00000000000000000000004',
  initiatedByMemberId: '01J00000000000000000000005',
  accessPolicyId: '01J00000000000000000000006',
  answerMode: 'ONSITE_ANSWER',
  requestedMedia: '7',
  status: 'REVOKED',
  livekitRoomName: 'ml_cleanup_barrier',
  requestedAt: new Date('2026-08-02T00:00:00.000Z'),
  acceptedAt: new Date('2026-08-02T00:00:01.000Z'),
  connectedAt: new Date('2026-08-02T00:00:02.000Z'),
  endedAt: new Date('2026-08-02T00:00:03.000Z'),
  endedByType: 'SYSTEM',
  endedById: null,
  endReason: 'REMOTE_AUTHORITY_REVOKED',
  roomCleanupStatus: 'PENDING',
  roomCleanupCompletedAt: null,
  roomCleanupNotBefore: null,
  consentSnapshotJson: {},
  traceId: 'request-cleanup',
  createdAt: new Date('2026-08-02T00:00:00.000Z'),
  updatedAt: new Date('2026-08-02T00:00:03.000Z'),
  version: 1,
};

function cleanupHarness(
  initialCleanupStatus = 'PENDING',
  initialCleanupNotBefore: Date | null = null,
) {
  let cleanupStatus = initialCleanupStatus;
  let cleanupNotBefore = initialCleanupNotBefore;
  const remoteAssistanceSession = {
    findFirst: jest.fn(async () =>
      cleanupStatus === 'PENDING' ? { id: session.id } : null,
    ),
    findMany: jest.fn(async () =>
      cleanupStatus === 'PENDING'
        ? [
            {
              ...session,
              roomCleanupStatus: cleanupStatus,
              roomCleanupNotBefore: cleanupNotBefore,
            },
          ]
        : [],
    ),
    updateMany: jest.fn(
      async ({
        where,
        data,
      }: {
        where: { id: string; roomCleanupStatus: string };
        data: {
          roomCleanupStatus: string;
          roomCleanupNotBefore?: Date | null;
        };
      }) => {
        if (
          where.id !== session.id ||
          where.roomCleanupStatus !== cleanupStatus
        ) {
          return { count: 0 };
        }
        cleanupStatus = data.roomCleanupStatus;
        if ('roomCleanupNotBefore' in data) {
          cleanupNotBefore = data.roomCleanupNotBefore ?? null;
        }
        return { count: 1 };
      },
    ),
    findUnique: jest.fn(async () => ({
      status: session.status,
      roomCleanupStatus: cleanupStatus,
      roomCleanupNotBefore: cleanupNotBefore,
    })),
  };
  const prisma = {
    remoteAssistanceSession,
    remoteSessionParticipant: {
      findMany: jest.fn(async () => [
        { id: '01J00000000000000000000007', role: 'FAMILY' },
        { id: '01J00000000000000000000008', role: 'DEVICE' },
      ]),
    },
  };
  const owner = {
    ownerType: 'REMOTE_ASSISTANCE' as const,
    ownerId: session.id,
    leaseId: session.id,
  };
  const leases = {
    acquire: jest.fn(async () => true),
    renew: jest.fn(async () => true),
    transfer: jest.fn(async () => true),
    release: jest.fn(async () => undefined),
    current: jest.fn(async () => owner),
  };
  const livekit = {
    ensureRoom: jest.fn(async () => undefined),
    issueJoinTicket: jest.fn(),
    removeParticipant: jest.fn(async () => undefined),
    deleteRoom: jest.fn(async () => undefined),
    verifyWebhook: jest.fn(),
  };
  const coordinator = new RemoteMediaSecurityCoordinator(
    prisma as unknown as PrismaService,
    leases as unknown as MediaLeasePort,
    livekit as unknown as LiveKitPort,
  );
  return {
    coordinator,
    leases,
    livekit,
    remoteAssistanceSession,
    cleanupStatus: () => cleanupStatus,
    cleanupNotBefore: () => cleanupNotBefore,
  };
}

describe('RemoteMediaSecurityCoordinator cleanup barrier', () => {
  it('atomically extends the cleanup fence when revocation races durable room provisioning', async () => {
    const test = cleanupHarness();
    const occurredAt = new Date('2026-08-02T00:00:05.000Z');
    const sessionUpdates: Array<Record<string, unknown>> = [];
    const updateSession = jest.fn(
      async ({ data }: { data: Record<string, unknown> }) => {
        sessionUpdates.push(data);
        return { count: 1 };
      },
    );
    const updateParticipants = jest.fn(async () => ({
      count: 1,
    }));
    const transaction = {
      $queryRaw: jest.fn(async () => [{ id: session.id }]),
      remoteAssistanceSession: {
        findMany: jest.fn(async () => [
          {
            ...session,
            status: 'CONNECTING',
            endedAt: null,
            endReason: null,
            roomCleanupNotBefore: null,
          },
        ]),
        updateMany: updateSession,
      },
      remoteSessionParticipant: {
        findFirst: jest.fn(async () => ({
          id: '01J00000000000000000000009',
        })),
        updateMany: updateParticipants,
      },
      remoteSessionEvent: { create: jest.fn(async ({ data }) => data) },
      outboxEvent: { create: jest.fn(async ({ data }) => data) },
    };

    await expect(
      test.coordinator.markBindingRevoked(
        transaction as never,
        session.bindingId,
        'BINDING_REVOKED',
        occurredAt,
      ),
    ).resolves.toBe(1);

    expect(updateSession).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'REVOKED',
          roomCleanupStatus: 'PENDING',
          roomCleanupNotBefore: expect.any(Date),
        }),
      }),
    );
    const fence = sessionUpdates[0]?.roomCleanupNotBefore as Date;
    expect(fence.getTime()).toBeGreaterThan(occurredAt.getTime());
    expect(updateParticipants).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          joinTicketStatus: {
            in: expect.arrayContaining(['PROVISIONING', 'ROOM_READY']),
          },
        }),
      }),
    );
  });

  it('treats a completed checkpoint as final and releases only its own lease', async () => {
    const test = cleanupHarness('COMPLETED');
    const completed = {
      ...session,
      roomCleanupStatus: 'COMPLETED',
      roomCleanupCompletedAt: new Date('2026-08-02T00:00:04.000Z'),
    };

    await expect(
      test.coordinator.cleanupSession(completed as never),
    ).resolves.toBe(true);

    expect(test.livekit.deleteRoom).not.toHaveBeenCalled();
    expect(test.leases.release).toHaveBeenCalledWith(session.bindingId, {
      ownerType: 'REMOTE_ASSISTANCE',
      ownerId: session.id,
      leaseId: session.id,
    });
  });

  it('keeps the quarantine lease when both room deletion attempts fail', async () => {
    const test = cleanupHarness();
    test.livekit.deleteRoom.mockRejectedValueOnce(new Error('delete failed'));
    test.livekit.deleteRoom.mockRejectedValueOnce(new Error('retry failed'));

    await expect(
      test.coordinator.cleanupSession(session as never),
    ).resolves.toBe(false);

    expect(test.livekit.deleteRoom).toHaveBeenCalledTimes(2);
    expect(test.livekit.removeParticipant).toHaveBeenCalledTimes(2);
    expect(test.remoteAssistanceSession.updateMany).not.toHaveBeenCalled();
    expect(test.leases.release).not.toHaveBeenCalled();
    expect(test.leases.renew).toHaveBeenCalledTimes(2);
    expect(test.cleanupStatus()).toBe('PENDING');
  });

  it('re-deletes but keeps cleanup pending through an uncertain provisioning fence', async () => {
    const notBefore = new Date(Date.now() + 60_000);
    const test = cleanupHarness('PENDING', notBefore);
    const fenced = { ...session, roomCleanupNotBefore: notBefore };

    await expect(
      test.coordinator.cleanupSession(fenced as never),
    ).resolves.toBe(false);

    expect(test.livekit.deleteRoom).toHaveBeenCalledTimes(1);
    expect(test.remoteAssistanceSession.updateMany).not.toHaveBeenCalled();
    expect(test.leases.renew).toHaveBeenCalledTimes(1);
    expect(test.leases.release).not.toHaveBeenCalled();
    expect(test.cleanupStatus()).toBe('PENDING');
  });

  it('lets the next pending sweep checkpoint deletion before releasing the lease', async () => {
    const test = cleanupHarness();
    test.livekit.deleteRoom.mockRejectedValueOnce(new Error('delete failed'));
    test.livekit.deleteRoom.mockRejectedValueOnce(new Error('retry failed'));
    await test.coordinator.cleanupSession(session as never);

    await test.coordinator.cleanupPendingForBinding(session.bindingId);

    expect(test.livekit.deleteRoom).toHaveBeenCalledTimes(3);
    expect(test.remoteAssistanceSession.updateMany).toHaveBeenCalledWith({
      where: {
        id: session.id,
        roomCleanupStatus: 'PENDING',
        roomCleanupNotBefore: null,
      },
      data: {
        roomCleanupStatus: 'COMPLETED',
        roomCleanupCompletedAt: expect.any(Date),
        roomCleanupNotBefore: null,
      },
    });
    expect(test.cleanupStatus()).toBe('COMPLETED');
    expect(test.leases.release).toHaveBeenCalledWith(session.bindingId, {
      ownerType: 'REMOTE_ASSISTANCE',
      ownerId: session.id,
      leaseId: session.id,
    });
    expect(
      test.remoteAssistanceSession.updateMany.mock.invocationCallOrder[0],
    ).toBeLessThan(test.leases.release.mock.invocationCallOrder[0]);
  });

  it('compare-releases quarantine acquired after another worker completed the checkpoint', async () => {
    const test = cleanupHarness();
    test.livekit.deleteRoom.mockRejectedValue(new Error('delete failed'));
    test.leases.current.mockResolvedValue(null);
    test.leases.acquire.mockResolvedValue(true);
    test.remoteAssistanceSession.findUnique.mockResolvedValue({
      status: 'REVOKED',
      roomCleanupStatus: 'COMPLETED',
    });

    await expect(
      test.coordinator.cleanupSession(session as never),
    ).resolves.toBe(false);

    expect(test.leases.acquire).toHaveBeenCalledTimes(2);
    expect(test.leases.release).toHaveBeenCalledTimes(2);
    expect(test.leases.release).toHaveBeenNthCalledWith(1, session.bindingId, {
      ownerType: 'REMOTE_ASSISTANCE',
      ownerId: session.id,
      leaseId: session.id,
    });
  });

  it('treats a terminal PENDING room as a binding-wide start barrier', async () => {
    const test = cleanupHarness();

    await expect(
      test.coordinator.hasPendingCleanup(
        {
          remoteAssistanceSession: test.remoteAssistanceSession,
        } as never,
        session.bindingId,
      ),
    ).resolves.toBe(true);

    expect(test.remoteAssistanceSession.findFirst).toHaveBeenCalledWith({
      where: {
        bindingId: session.bindingId,
        status: {
          in: expect.arrayContaining([
            'DECLINED',
            'CANCELLED',
            'ENDED',
            'EXPIRED',
            'FAILED',
            'REVOKED',
          ]),
        },
        roomCleanupStatus: 'PENDING',
      },
      select: { id: true },
    });
  });

  it('uses durable open sessions as a barrier even when no Redis lease is consulted', async () => {
    const test = cleanupHarness();
    test.leases.current.mockResolvedValue(null);
    test.remoteAssistanceSession.findFirst.mockResolvedValueOnce({
      id: session.id,
    });

    await expect(
      test.coordinator.hasRemoteMediaBarrier(
        {
          remoteAssistanceSession: test.remoteAssistanceSession,
        } as never,
        session.bindingId,
      ),
    ).resolves.toBe(true);

    expect(test.remoteAssistanceSession.findFirst).toHaveBeenCalledWith({
      where: {
        bindingId: session.bindingId,
        OR: [
          {
            status: {
              in: expect.arrayContaining([
                'RINGING',
                'ACCEPTED',
                'CONNECTING',
                'ACTIVE',
                'ENDING',
              ]),
            },
          },
          {
            status: {
              in: expect.arrayContaining([
                'DECLINED',
                'CANCELLED',
                'ENDED',
                'EXPIRED',
                'FAILED',
                'REVOKED',
              ]),
            },
            roomCleanupStatus: 'PENDING',
          },
        ],
      },
      select: { id: true },
    });
    expect(test.leases.current).not.toHaveBeenCalled();
  });
});
