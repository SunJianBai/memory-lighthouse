import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { DevicePrincipal } from '../device-activation/device-activation.types';
import type { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import type { UserPrincipal } from '../identity/identity.types';
import type { LiveKitPort } from './ports/livekit.port';
import type { MediaLeasePort } from './ports/media-lease.port';
import { REMOTE_SESSION_STATUS } from './realtime.constants';
import { RealtimeCommunicationApplicationService } from './realtime.application.service';
import type {
  RequestedRemoteMedia,
  VerifiedLiveKitWebhook,
} from './realtime.types';

jest.mock('../../infrastructure/database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const IDS = {
  user: '01J00000000000000000000001',
  otherUser: '01J00000000000000000000002',
  member: '01J00000000000000000000003',
  otherMember: '01J00000000000000000000004',
  device: '01J00000000000000000000005',
  binding: '01J00000000000000000000006',
  household: '01J00000000000000000000007',
  recipient: '01J00000000000000000000008',
  policy: '01J00000000000000000000009',
  session: '01J0000000000000000000000A',
  familyParticipant: '01J0000000000000000000000B',
  deviceParticipant: '01J0000000000000000000000C',
} as const;

const NOW = new Date('2026-08-01T08:00:00.000Z');
const media: RequestedRemoteMedia = {
  receiveDeviceAudio: true,
  receiveDeviceVideo: true,
  sendFamilyAudio: true,
  sendFamilyVideo: false,
};

const userPrincipal: UserPrincipal = {
  kind: 'USER',
  userId: IDS.user,
  sessionId: '01J0000000000000000000000D',
  tokenId: '01J0000000000000000000000E',
  status: 'ACTIVE',
};

const devicePrincipal: DevicePrincipal = {
  kind: 'DEVICE',
  tokenId: '01J0000000000000000000000F',
  credentialId: '01J0000000000000000000000G',
  credentialFamilyId: '01J0000000000000000000000H',
  deviceId: IDS.device,
  bindingId: IDS.binding,
  householdId: IDS.household,
  recipientId: IDS.recipient,
  bindingVersion: 1,
  capabilities: ['REMOTE_ASSISTANCE'],
};

function policy() {
  return {
    id: IDS.policy,
    householdId: IDS.household,
    recipientId: IDS.recipient,
    bindingId: IDS.binding,
    mode: 'ONSITE_ANSWER',
    cameraAllowed: true,
    microphoneAllowed: true,
    sendFamilyAudioAllowed: true,
    countdownSeconds: 10,
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: null,
    localConfirmedAt: null,
    consentEventId: null,
    status: 'ACTIVE',
    createdAt: NOW,
    updatedAt: NOW,
    version: 0,
  };
}

function binding() {
  return {
    id: IDS.binding,
    deviceId: IDS.device,
    householdId: IDS.household,
    recipientId: IDS.recipient,
    displayName: '客厅陪伴设备',
    status: 'ACTIVE',
    activatedByMemberId: IDS.member,
    activatedAt: NOW,
    revokedAt: null,
    bindingVersion: 1,
    createdAt: NOW,
    updatedAt: NOW,
    version: 0,
    device: { id: IDS.device, status: 'ACTIVE', lastSeenAt: new Date() },
    recipient: {
      id: IDS.recipient,
      status: 'ACTIVE',
      deletedAt: null,
    },
    remoteAccessPolicy: policy(),
  };
}

function remoteSession(status = REMOTE_SESSION_STATUS.ringing) {
  return {
    id: IDS.session,
    householdId: IDS.household,
    recipientId: IDS.recipient,
    bindingId: IDS.binding,
    initiatedByMemberId: IDS.member,
    accessPolicyId: IDS.policy,
    answerMode: 'ONSITE_ANSWER',
    requestedMedia: '7',
    status,
    livekitRoomName: 'ml_test_room',
    requestedAt: NOW,
    acceptedAt: status === REMOTE_SESSION_STATUS.ringing ? null : new Date(NOW),
    connectedAt: status === REMOTE_SESSION_STATUS.active ? new Date(NOW) : null,
    endedAt: null,
    endedByType: null,
    endedById: null,
    endReason: null,
    consentSnapshotJson: {
      REMOTE_ASSISTANCE_AUDIO: true,
      REMOTE_ASSISTANCE_VIDEO: true,
    },
    traceId: 'request-test',
    createdAt: NOW,
    updatedAt: NOW,
    version: 0,
  };
}

function participant(
  role: 'FAMILY' | 'DEVICE',
  id: string,
  options?: { joined?: boolean; audio?: boolean; video?: boolean },
) {
  return {
    id,
    sessionId: IDS.session,
    principalType: role === 'FAMILY' ? 'USER' : 'DEVICE',
    userId: role === 'FAMILY' ? IDS.user : null,
    bindingId: role === 'DEVICE' ? IDS.binding : null,
    role,
    clientType: 'WEB',
    joinedAt: options?.joined ? new Date(NOW) : null,
    leftAt: null,
    publishedAudio: options?.audio ?? false,
    publishedVideo: options?.video ?? false,
    createdAt: NOW,
  };
}

function codeOf(error: unknown): string | undefined {
  if (
    typeof error !== 'object' ||
    error === null ||
    !('getResponse' in error) ||
    typeof error.getResponse !== 'function'
  ) {
    return undefined;
  }
  return (error.getResponse() as { code?: string }).code;
}

interface HarnessOptions {
  status?: string;
  consents?: string[];
  leaseAcquired?: boolean;
  authorized?: boolean;
  actingMemberId?: string;
  participants?: Array<ReturnType<typeof participant>>;
  replayWithMedia?: string;
  sessionVisible?: boolean;
  leaseCurrent?: 'REMOTE' | 'AI' | 'NONE';
  requestedAt?: Date;
  initiatingMemberActive?: boolean;
}

function harness(options: HarnessOptions = {}) {
  let currentSession = remoteSession(
    options.status ?? REMOTE_SESSION_STATUS.ringing,
  );
  if (options.requestedAt) {
    currentSession = { ...currentSession, requestedAt: options.requestedAt };
  }
  const participants = [...(options.participants ?? [])];
  const events: Array<Record<string, unknown>> = [];
  const outbox: Array<Record<string, unknown>> = [];
  let nextWebhook: VerifiedLiveKitWebhook | null = null;

  const consentScopes = options.consents ?? [
    'REMOTE_ASSISTANCE_AUDIO',
    'REMOTE_ASSISTANCE_VIDEO',
  ];
  const recipientConsentState = {
    findMany: jest.fn(async () =>
      consentScopes.map((scope) => ({ scope, decision: 'GRANTED' })),
    ),
  };

  const updateSession = jest.fn(async ({ where, data }) => {
    if (
      where.id !== currentSession.id ||
      (where.status !== undefined && where.status !== currentSession.status) ||
      (where.version !== undefined && where.version !== currentSession.version)
    ) {
      return { count: 0 };
    }
    const increment = data.version?.increment ?? 0;
    currentSession = {
      ...currentSession,
      ...data,
      version: currentSession.version + increment,
    };
    return { count: 1 };
  });

  const sessionFindFirst = jest.fn(async ({ where }) => {
    if (options.sessionVisible === false) {
      return null;
    }
    if (
      where.livekitRoomName &&
      where.livekitRoomName !== currentSession.livekitRoomName
    ) {
      return null;
    }
    if (where.id && where.id !== currentSession.id) {
      return null;
    }
    if (where.householdId && where.householdId !== currentSession.householdId) {
      return null;
    }
    if (where.recipientId && where.recipientId !== currentSession.recipientId) {
      return null;
    }
    if (where.bindingId && where.bindingId !== currentSession.bindingId) {
      return null;
    }
    if (where.status?.in && !where.status.in.includes(currentSession.status)) {
      return null;
    }
    return where.livekitRoomName
      ? {
          ...currentSession,
          participants: participants.map((row) => ({ ...row })),
        }
      : { ...currentSession };
  });

  const sessionFindUnique = jest.fn(async ({ where, include }) => {
    if (options.replayWithMedia && !include) {
      return {
        ...currentSession,
        id: where.id,
        requestedMedia: options.replayWithMedia,
      };
    }
    if (where.id !== currentSession.id) {
      return null;
    }
    return include?.participants
      ? {
          ...currentSession,
          participants: participants.map((row) => ({ ...row })),
        }
      : { ...currentSession };
  });

  const transaction = {
    companionBinding: { findFirst: jest.fn(async () => binding()) },
    recipientConsentState,
    remoteAssistanceSession: {
      findFirst: sessionFindFirst,
      findUnique: sessionFindUnique,
      create: jest.fn(async ({ data }) => {
        currentSession = {
          ...remoteSession(data.status),
          ...data,
          acceptedAt: null,
          connectedAt: null,
          endedAt: null,
          endedByType: null,
          endedById: null,
          endReason: null,
          createdAt: NOW,
          updatedAt: NOW,
          version: 0,
        };
        return { ...currentSession };
      }),
      updateMany: updateSession,
    },
    remoteSessionEvent: {
      create: jest.fn(async ({ data }) => {
        events.push(data);
        return data;
      }),
    },
    outboxEvent: {
      create: jest.fn(async ({ data }) => {
        outbox.push(data);
        return data;
      }),
    },
    modelSession: { updateMany: jest.fn(async () => ({ count: 1 })) },
    companionSession: { updateMany: jest.fn(async () => ({ count: 1 })) },
    householdMember: { findFirst: jest.fn() },
    recipientMember: { findFirst: jest.fn() },
    careRecipient: { findFirst: jest.fn() },
  };

  const remoteSessionParticipant = {
    upsert: jest.fn(async ({ create, update }) => {
      let row = participants.find((candidate) => candidate.id === create.id);
      if (!row) {
        row = {
          ...participant(create.role, create.id),
          ...create,
        };
        participants.push(row);
      } else {
        Object.assign(row, update);
      }
      return { ...row };
    }),
    updateMany: jest.fn(async ({ where, data }) => {
      const row = participants.find((candidate) => candidate.id === where.id);
      if (!row || (where.leftAt === null && row.leftAt !== null)) {
        return { count: 0 };
      }
      if (where.joinedAt === null && row.joinedAt !== null) {
        return { count: 0 };
      }
      Object.assign(row, data);
      return { count: 1 };
    }),
    findMany: jest.fn(async () =>
      participants.map(({ id, role }) => ({ id, role })),
    ),
  };

  const prisma = {
    companionBinding: { findFirst: jest.fn(async () => binding()) },
    householdMember: {
      findFirst: jest.fn(async () =>
        options.initiatingMemberActive === false ? null : { userId: IDS.user },
      ),
    },
    recipientConsentState,
    remoteAssistanceSession: {
      findFirst: sessionFindFirst,
      findUnique: sessionFindUnique,
      findMany: jest.fn(async () =>
        options.sessionVisible !== false &&
        [
          REMOTE_SESSION_STATUS.ringing,
          REMOTE_SESSION_STATUS.accepted,
          REMOTE_SESSION_STATUS.connecting,
          REMOTE_SESSION_STATUS.active,
          REMOTE_SESSION_STATUS.ending,
        ].includes(currentSession.status)
          ? [{ ...currentSession }]
          : [],
      ),
      updateMany: updateSession,
    },
    remoteSessionParticipant,
    companionSession: {
      findFirst: jest.fn(async ({ where }) =>
        options.leaseCurrent === 'AI' && where.id === 'ai-session'
          ? { id: 'ai-session' }
          : null,
      ),
    },
    user: { findUnique: jest.fn(async () => ({ displayName: '家属甲' })) },
    $transaction: jest.fn(async (work) => work(transaction)),
  };

  const householdAccess = {
    requireRecipientAction: jest.fn(async () => {
      if (options.authorized === false) {
        throw new ForbiddenException({ code: 'RECIPIENT_ACCESS_DENIED' });
      }
      return {
        id: options.actingMemberId ?? IDS.member,
        userId: userPrincipal.userId,
        householdId: IDS.household,
        roleCodes: ['CAREGIVER'],
      };
    }),
  };

  const leases = {
    acquire: jest.fn(async () => options.leaseAcquired ?? true),
    renew: jest.fn(async () => true),
    transfer: jest.fn(async () => true),
    release: jest.fn(async () => undefined),
    current: jest.fn(async () => {
      if (options.leaseCurrent === 'NONE') {
        return null;
      }
      if (options.leaseCurrent === 'AI') {
        return {
          ownerType: 'AI_COMPANION',
          ownerId: 'ai-session',
          leaseId: 'ai-lease',
        };
      }
      return {
        ownerType: 'REMOTE_ASSISTANCE',
        ownerId: currentSession.id,
        leaseId: currentSession.id,
      };
    }),
  };
  const livekit = {
    issueJoinTicket: jest.fn(async () => ({
      token: 'livekit-token',
      url: 'wss://rtc.example.test',
      expiresAt: new Date('2026-08-01T08:02:00.000Z'),
    })),
    removeParticipant: jest.fn(async () => undefined),
    deleteRoom: jest.fn(async () => undefined),
    verifyWebhook: jest.fn(async () => {
      if (!nextWebhook) {
        throw new Error('test webhook not configured');
      }
      return nextWebhook;
    }),
  };
  const config = {
    get: jest.fn((key: string) =>
      key === 'DEVICE_ONLINE_THRESHOLD_SECONDS' ? 120 : undefined,
    ),
  };

  const service = new RealtimeCommunicationApplicationService(
    prisma as unknown as PrismaService,
    householdAccess as unknown as HouseholdAccessPolicy,
    config as unknown as ConfigService,
    leases as unknown as MediaLeasePort,
    livekit as unknown as LiveKitPort,
  );

  async function webhook(
    event: string,
    participantIdentity: string | null,
    trackSource: VerifiedLiveKitWebhook['trackSource'] = null,
  ) {
    nextWebhook = {
      event,
      roomName: currentSession.livekitRoomName,
      participantIdentity,
      trackSource,
      occurredAt: new Date(NOW.getTime() + 1_000),
    };
    await service.handleLiveKitWebhook('signed-body', 'Bearer signature');
  }

  return {
    service,
    prisma,
    transaction,
    householdAccess,
    leases,
    livekit,
    participants,
    events,
    outbox,
    currentSession: () => currentSession,
    webhook,
  };
}

describe('RealtimeCommunicationApplicationService authorization and consent', () => {
  it('rejects a family member without recipient remote-call authority', async () => {
    const test = harness({ authorized: false });

    await expect(
      test.service.requestRemoteSession({
        principal: userPrincipal,
        householdId: IDS.household,
        bindingId: IDS.binding,
        media,
        idempotencyKey: 'remote-request-001',
        traceId: 'request-1',
      }),
    ).rejects.toMatchObject({
      response: { code: 'RECIPIENT_ACCESS_DENIED' },
    });
    expect(test.leases.acquire).not.toHaveBeenCalled();
  });

  it('requires current video consent before acquiring the device lease', async () => {
    const test = harness({ consents: ['REMOTE_ASSISTANCE_AUDIO'] });

    try {
      await test.service.requestRemoteSession({
        principal: userPrincipal,
        householdId: IDS.household,
        bindingId: IDS.binding,
        media,
        idempotencyKey: 'remote-request-002',
        traceId: 'request-2',
      });
      throw new Error('expected consent rejection');
    } catch (error) {
      expect(codeOf(error)).toBe('CONSENT_REQUIRED');
      expect(error).toMatchObject({
        response: {
          details: { scope: 'REMOTE_ASSISTANCE_VIDEO' },
        },
      });
    }
    expect(test.leases.acquire).not.toHaveBeenCalled();
  });

  it('returns busy when another media owner holds the Redis lease', async () => {
    const test = harness({ leaseAcquired: false });

    await expect(
      test.service.requestRemoteSession({
        principal: userPrincipal,
        householdId: IDS.household,
        bindingId: IDS.binding,
        media,
        idempotencyKey: 'remote-request-003',
        traceId: 'request-3',
      }),
    ).rejects.toMatchObject({ response: { code: 'REMOTE_DEVICE_BUSY' } });
  });

  it('keeps AI companionship running while an onsite-answer call rings', async () => {
    const test = harness({ leaseCurrent: 'AI' });

    const result = await test.service.requestRemoteSession({
      principal: userPrincipal,
      householdId: IDS.household,
      bindingId: IDS.binding,
      media,
      idempotencyKey: 'remote-request-ai-handoff',
      traceId: 'request-ai-handoff',
    });

    expect(result.status).toBe(REMOTE_SESSION_STATUS.ringing);
    expect(test.leases.acquire).not.toHaveBeenCalled();
  });

  it('reports an idempotency conflict when the key is reused with different media', async () => {
    const test = harness({ replayWithMedia: '5' });

    await expect(
      test.service.requestRemoteSession({
        principal: userPrincipal,
        householdId: IDS.household,
        bindingId: IDS.binding,
        media,
        idempotencyKey: 'remote-request-004',
        traceId: 'request-4',
      }),
    ).rejects.toMatchObject({
      response: { code: 'IDEMPOTENCY_CONFLICT' },
    });
    expect(test.leases.acquire).not.toHaveBeenCalled();
  });

  it('does not let another authorized family member take over the caller ticket', async () => {
    const test = harness({
      status: REMOTE_SESSION_STATUS.accepted,
      actingMemberId: IDS.otherMember,
    });

    await expect(
      test.service.issueFamilyJoinTicket(
        { ...userPrincipal, userId: IDS.otherUser },
        IDS.household,
        IDS.session,
        'WEB',
      ),
    ).rejects.toMatchObject({
      response: { code: 'REMOTE_CALL_NOT_ALLOWED' },
    });
    expect(test.livekit.issueJoinTicket).not.toHaveBeenCalled();
  });

  it('revokes an accepted session instead of minting after consent withdrawal', async () => {
    const test = harness({
      status: REMOTE_SESSION_STATUS.accepted,
      consents: ['REMOTE_ASSISTANCE_AUDIO'],
    });

    await expect(
      test.service.issueFamilyJoinTicket(
        userPrincipal,
        IDS.household,
        IDS.session,
        'WEB',
      ),
    ).rejects.toMatchObject({ response: { code: 'CONSENT_REQUIRED' } });
    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.revoked);
    expect(test.livekit.issueJoinTicket).not.toHaveBeenCalled();
  });

  it('revokes an accepted session after the initiating member loses membership', async () => {
    const test = harness({
      status: REMOTE_SESSION_STATUS.accepted,
      initiatingMemberActive: false,
    });

    await expect(
      test.service.issueDeviceJoinTicket(
        devicePrincipal,
        IDS.session,
        'ANDROID',
      ),
    ).rejects.toMatchObject({
      response: { code: 'REMOTE_CALL_NOT_ALLOWED' },
    });
    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.revoked);
    expect(test.livekit.issueJoinTicket).not.toHaveBeenCalled();
  });

  it('rejects a valid device token that lacks the remote-assistance capability', async () => {
    const test = harness();

    await expect(
      test.service.declineByDevice(
        { ...devicePrincipal, capabilities: ['COMPANION'] },
        IDS.session,
      ),
    ).rejects.toMatchObject({
      response: { code: 'REMOTE_CALL_NOT_ALLOWED' },
    });
    expect(
      test.transaction.remoteAssistanceSession.updateMany,
    ).not.toHaveBeenCalled();
  });
});

describe('RealtimeCommunicationApplicationService onsite lifecycle', () => {
  it('lets the onsite device decline and releases all remote media state', async () => {
    const test = harness();

    const result = await test.service.declineByDevice(
      devicePrincipal,
      IDS.session,
    );

    expect(result.status).toBe(REMOTE_SESSION_STATUS.declined);
    expect(result.endReason).toBe('DECLINED_ON_DEVICE');
    expect(test.leases.release).toHaveBeenCalledTimes(1);
    expect(test.livekit.deleteRoom).toHaveBeenCalledWith('ml_test_room');
    expect(test.outbox).toEqual([
      expect.objectContaining({ eventType: 'remote-session.ended' }),
    ]);
  });

  it('atomically stops active AI media before accepting onsite', async () => {
    const test = harness();

    const result = await test.service.acceptByDevice(
      devicePrincipal,
      IDS.session,
    );

    expect(result.status).toBe(REMOTE_SESSION_STATUS.accepted);
    expect(test.transaction.modelSession.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          endReason: 'REMOTE_ASSISTANCE_ACCEPTED',
        }),
      }),
    );
    expect(test.transaction.companionSession.updateMany).toHaveBeenCalledTimes(
      1,
    );
  });

  it('atomically transfers the AI media lease only after onsite acceptance', async () => {
    const test = harness({ leaseCurrent: 'AI' });

    const result = await test.service.acceptByDevice(
      devicePrincipal,
      IDS.session,
    );

    expect(result.status).toBe(REMOTE_SESSION_STATUS.accepted);
    expect(test.leases.transfer).toHaveBeenCalledWith(
      IDS.binding,
      {
        ownerType: 'AI_COMPANION',
        ownerId: 'ai-session',
        leaseId: 'ai-lease',
      },
      {
        ownerType: 'REMOTE_ASSISTANCE',
        ownerId: IDS.session,
        leaseId: IDS.session,
      },
      90,
    );
  });

  it('mints asymmetric least-privilege grants for family and device roles', async () => {
    const test = harness({ status: REMOTE_SESSION_STATUS.accepted });

    await test.service.issueFamilyJoinTicket(
      userPrincipal,
      IDS.household,
      IDS.session,
      'WEB',
    );
    await test.service.issueDeviceJoinTicket(
      devicePrincipal,
      IDS.session,
      'ANDROID',
    );

    expect(test.livekit.issueJoinTicket).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        roomName: 'ml_test_room',
        identity: expect.stringMatching(/^family_/),
        publishMicrophone: true,
        publishCamera: false,
        canSubscribe: true,
        ttlSeconds: 60,
        metadata: expect.objectContaining({
          role: 'FAMILY',
          recording: 'false',
          transcription: 'false',
        }),
      }),
    );
    expect(test.livekit.issueJoinTicket).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        identity: expect.stringMatching(/^device_/),
        publishMicrophone: true,
        publishCamera: true,
        canSubscribe: true,
        metadata: expect.objectContaining({ role: 'DEVICE' }),
      }),
    );
  });

  it('does not become ACTIVE until both sides join and every required track exists', async () => {
    const family = participant('FAMILY', IDS.familyParticipant);
    const device = participant('DEVICE', IDS.deviceParticipant);
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      participants: [family, device],
    });
    const familyIdentity = `family_${IDS.session}_${IDS.familyParticipant}`;
    const deviceIdentity = `device_${IDS.session}_${IDS.deviceParticipant}`;

    await test.webhook('participant_joined', familyIdentity);
    await test.webhook('track_published', familyIdentity, 'microphone');
    await test.webhook('participant_joined', deviceIdentity);
    await test.webhook('track_published', deviceIdentity, 'microphone');
    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.connecting);

    await test.webhook('track_published', deviceIdentity, 'camera');
    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.active);
    expect(test.outbox).toContainEqual(
      expect.objectContaining({ eventType: 'remote-session.connected' }),
    );
  });

  it('terminates a CONNECTING session when either participant leaves', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      joined: true,
      audio: true,
    });
    const device = participant('DEVICE', IDS.deviceParticipant, {
      joined: true,
      audio: true,
    });
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      participants: [family, device],
    });

    await test.webhook(
      'participant_left',
      `family_${IDS.session}_${IDS.familyParticipant}`,
    );

    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.cancelled);
    expect(test.currentSession().endReason).toBe('PARTICIPANT_LEFT');
    expect(test.leases.release).toHaveBeenCalledTimes(1);
    expect(test.livekit.removeParticipant).toHaveBeenCalledTimes(2);
    expect(test.livekit.deleteRoom).toHaveBeenCalledTimes(1);
  });

  it('ends an active call when a required published track is removed', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      joined: true,
      audio: true,
    });
    const device = participant('DEVICE', IDS.deviceParticipant, {
      joined: true,
      audio: true,
      video: true,
    });
    const test = harness({
      status: REMOTE_SESSION_STATUS.active,
      participants: [family, device],
    });

    await test.webhook(
      'track_unpublished',
      `device_${IDS.session}_${IDS.deviceParticipant}`,
      'camera',
    );

    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.ended);
    expect(test.currentSession().endReason).toBe('REQUIRED_TRACK_UNPUBLISHED');
  });
});

describe('RealtimeCommunicationApplicationService device discovery and sweep', () => {
  it('lets a device discover its own current incoming session without a session id', async () => {
    const test = harness({ requestedAt: new Date() });

    const result = await test.service.getCurrentDeviceSession(devicePrincipal);

    expect(result).toEqual(
      expect.objectContaining({
        id: IDS.session,
        bindingId: IDS.binding,
        householdId: IDS.household,
        recipientId: IDS.recipient,
        status: REMOTE_SESSION_STATUS.ringing,
      }),
    );
    expect(test.prisma.remoteAssistanceSession.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          bindingId: IDS.binding,
          householdId: IDS.household,
          recipientId: IDS.recipient,
        }),
      }),
    );
  });

  it('returns null when the device has no open session or only another binding does', async () => {
    const empty = harness({ sessionVisible: false });
    await expect(
      empty.service.getCurrentDeviceSession(devicePrincipal),
    ).resolves.toBeNull();

    const scoped = harness({ requestedAt: new Date() });
    await expect(
      scoped.service.getCurrentDeviceSession({
        ...devicePrincipal,
        bindingId: '01J0000000000000000000000Z',
      }),
    ).resolves.toBeNull();
    expect(scoped.leases.current).not.toHaveBeenCalled();
  });

  it('expires an unanswered RINGING session once and releases its lease', async () => {
    const test = harness({ leaseCurrent: 'REMOTE' });
    const afterDeadline = new Date(NOW.getTime() + 61_000);

    await expect(
      test.service.expireStaleSessions(afterDeadline),
    ).resolves.toEqual({ examined: 1, expired: 1, failed: 0 });
    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.expired);
    expect(test.currentSession().endReason).toBe('RING_TIMEOUT');
    expect(test.leases.release).toHaveBeenCalledTimes(1);

    await expect(
      test.service.expireStaleSessions(afterDeadline),
    ).resolves.toEqual({ examined: 0, expired: 0, failed: 0 });
    expect(test.events).toHaveLength(1);
    expect(test.outbox).toHaveLength(1);
  });

  it('fails an open session whose Redis owner is missing or replaced', async () => {
    const test = harness({
      status: REMOTE_SESSION_STATUS.accepted,
      leaseCurrent: 'AI',
    });

    await expect(
      test.service.expireStaleSessions(new Date(NOW.getTime() + 10_000)),
    ).resolves.toEqual({ examined: 1, expired: 0, failed: 1 });
    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.failed);
    expect(test.currentSession().endReason).toBe('MEDIA_LEASE_LOST');
  });
});
