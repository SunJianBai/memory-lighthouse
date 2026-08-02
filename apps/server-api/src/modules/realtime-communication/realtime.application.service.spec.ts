import { describe, expect, it, jest } from '@jest/globals';
import { ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { CompanionMediaControlService } from '../companion-session/companion-media-control.service';
import type { DevicePrincipal } from '../device-activation/device-activation.types';
import type { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import type { IdentityApplicationService } from '../identity/identity.application.service';
import type { UserPrincipal } from '../identity/identity.types';
import type { LiveKitPort } from './ports/livekit.port';
import type { MediaLeasePort } from './ports/media-lease.port';
import { REMOTE_SESSION_STATUS } from './realtime.constants';
import { LiveKitUnavailableException } from './realtime.errors';
import { RealtimeCommunicationApplicationService } from './realtime.application.service';
import { RemoteMediaSecurityCoordinator } from './remote-media-security.coordinator';
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
    roomCleanupStatus: 'PENDING',
    roomCleanupCompletedAt: null,
    roomCleanupNotBefore: null,
    roomProvisionedAt: null,
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
  options?: {
    joined?: boolean;
    ticketIssued?: boolean;
    audio?: boolean;
    video?: boolean;
  },
) {
  const ticketStatus = options?.joined
    ? 'CONSUMED'
    : options?.ticketIssued
      ? 'ISSUED'
      : null;
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
    joinTicketId: ticketStatus ? id : null,
    joinTicketStatus: ticketStatus,
    joinTicketIssuedAt: ticketStatus ? new Date(NOW) : null,
    joinTicketExpiresAt: ticketStatus ? new Date(NOW.getTime() + 60_000) : null,
    joinTicketConsumedAt: options?.joined ? new Date(NOW) : null,
    joinTicketRevokedAt: null,
    joinTicketConsumedEventId: options?.joined ? `event-${id}` : null,
    livekitParticipantSid: options?.joined ? `PA_${id}` : null,
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
  reauthenticated?: boolean;
  roomCreationFails?: boolean;
  terminalDuringRoomCreation?: boolean;
  terminalBeforeRoomTransaction?: boolean;
  postEnsureEligibilityReadFails?: boolean;
  roomDeleteFailures?: number;
  policyOverrides?: Partial<ReturnType<typeof policy>>;
  policyTransactionFails?: boolean;
  acceptCasLostToConcurrentWinner?: boolean;
  acceptEligibilityReadFails?: boolean;
  terminateBeforeAcceptEligibilityFailure?: boolean;
  aiLeaseOwnerDurable?: boolean;
  activateBeforeConnectTimeoutTermination?: boolean;
  acceptSerializationFailures?: number;
}

function harness(options: HarnessOptions = {}) {
  let currentSession = remoteSession(
    options.status ?? REMOTE_SESSION_STATUS.ringing,
  );
  if (options.requestedAt) {
    currentSession = { ...currentSession, requestedAt: options.requestedAt };
  }
  let currentPolicy = { ...policy(), ...options.policyOverrides };
  const currentBinding = () => ({
    ...binding(),
    remoteAccessPolicy: { ...currentPolicy },
  });
  const participants = [...(options.participants ?? [])];
  const events: Array<Record<string, unknown>> = [];
  const outbox: Array<Record<string, unknown>> = [];
  let nextWebhook: VerifiedLiveKitWebhook | null = null;
  let remainingRoomDeleteFailures = options.roomDeleteFailures ?? 0;
  let acceptCasRacePending = options.acceptCasLostToConcurrentWinner ?? false;

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
      acceptCasRacePending &&
      where.id === currentSession.id &&
      where.status === REMOTE_SESSION_STATUS.ringing &&
      data.status === REMOTE_SESSION_STATUS.accepted
    ) {
      acceptCasRacePending = false;
      currentSession = {
        ...currentSession,
        status: REMOTE_SESSION_STATUS.accepted,
        acceptedAt: data.acceptedAt,
        version: currentSession.version + 1,
      };
      return { count: 0 };
    }
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
    if (
      where.roomCleanupStatus !== undefined &&
      where.roomCleanupStatus !== currentSession.roomCleanupStatus
    ) {
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
      currentSession = {
        ...currentSession,
        id: where.id,
        requestedMedia: options.replayWithMedia,
      };
      return { ...currentSession };
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
  let directAdmissionReadCount = 0;
  const directSessionFindUnique = jest.fn(async (args) => {
    if (args.select?.answerMode) {
      directAdmissionReadCount += 1;
      if (
        options.postEnsureEligibilityReadFails &&
        directAdmissionReadCount === 2
      ) {
        throw new Error('post-ensure session read failed');
      }
    }
    return sessionFindUnique(args);
  });
  let terminalBeforeRoomTransactionPending =
    options.terminalBeforeRoomTransaction ?? false;
  let transactionSessionReadCount = 0;
  const transactionSessionFindUnique = jest.fn(async (args) => {
    transactionSessionReadCount += 1;
    if (
      options.activateBeforeConnectTimeoutTermination &&
      transactionSessionReadCount === 2 &&
      currentSession.status === REMOTE_SESSION_STATUS.connecting
    ) {
      currentSession = {
        ...currentSession,
        status: REMOTE_SESSION_STATUS.active,
        connectedAt: new Date(NOW.getTime() + 180_001),
        version: currentSession.version + 1,
      };
    }
    if (terminalBeforeRoomTransactionPending && directAdmissionReadCount > 0) {
      terminalBeforeRoomTransactionPending = false;
      currentSession = {
        ...currentSession,
        status: REMOTE_SESSION_STATUS.ended,
        endedAt: new Date(NOW),
        endedByType: 'SYSTEM',
        endReason: 'CONCURRENT_TERMINATION',
        version: currentSession.version + 1,
      };
    }
    return sessionFindUnique(args);
  });

  const updateParticipants = jest.fn(async ({ where, data }) => {
    const rows = participants.filter((row) => {
      if (where.id !== undefined && row.id !== where.id) return false;
      if (where.sessionId !== undefined && row.sessionId !== where.sessionId) {
        return false;
      }
      if (where.leftAt === null && row.leftAt !== null) return false;
      if (where.joinedAt === null && row.joinedAt !== null) return false;
      if (
        where.livekitParticipantSid === null &&
        row.livekitParticipantSid !== null
      ) {
        return false;
      }
      if (
        where.OR &&
        !where.OR.some(
          (condition: { livekitParticipantSid: string | null }) =>
            condition.livekitParticipantSid === row.livekitParticipantSid,
        )
      ) {
        return false;
      }
      if (
        where.joinTicketId !== undefined &&
        row.joinTicketId !== where.joinTicketId
      ) {
        return false;
      }
      if (where.joinTicketStatus === null && row.joinTicketStatus !== null) {
        return false;
      }
      if (
        typeof where.joinTicketStatus === 'string' &&
        row.joinTicketStatus !== where.joinTicketStatus
      ) {
        return false;
      }
      if (
        where.joinTicketStatus?.in &&
        !where.joinTicketStatus.in.includes(row.joinTicketStatus)
      ) {
        return false;
      }
      if (
        where.joinTicketExpiresAt?.gte &&
        (!row.joinTicketExpiresAt ||
          row.joinTicketExpiresAt < where.joinTicketExpiresAt.gte)
      ) {
        return false;
      }
      if (
        where.joinTicketIssuedAt?.lte &&
        (!row.joinTicketIssuedAt ||
          row.joinTicketIssuedAt > where.joinTicketIssuedAt.lte)
      ) {
        return false;
      }
      return true;
    });
    rows.forEach((row) => Object.assign(row, data));
    return { count: rows.length };
  });

  const updatePolicy = jest.fn(async ({ where, data }) => {
    if (options.policyTransactionFails) {
      throw new Error('policy transaction failed');
    }
    if (
      where.id !== currentPolicy.id ||
      where.bindingId !== currentPolicy.bindingId ||
      where.householdId !== currentPolicy.householdId ||
      where.version !== currentPolicy.version ||
      where.status !== currentPolicy.status
    ) {
      return { count: 0 };
    }
    const increment = data.version?.increment ?? 0;
    const next = { ...data };
    delete next.version;
    currentPolicy = {
      ...currentPolicy,
      ...next,
      version: currentPolicy.version + increment,
      updatedAt: new Date(),
    };
    return { count: 1 };
  });
  const policyFindUnique = jest.fn(async ({ where }) =>
    where.id === currentPolicy.id ? { ...currentPolicy } : null,
  );

  const transaction = {
    $queryRaw: jest.fn(async () => [{ id: currentSession.id }]),
    companionBinding: {
      findFirst: jest.fn(async () => {
        if (options.acceptEligibilityReadFails) {
          if (options.terminateBeforeAcceptEligibilityFailure) {
            currentSession = {
              ...currentSession,
              status: REMOTE_SESSION_STATUS.ended,
              endedAt: new Date(NOW),
              endedByType: 'SYSTEM',
              endReason: 'CONCURRENT_TERMINATION',
              roomCleanupStatus: 'PENDING',
              roomCleanupCompletedAt: null,
              version: currentSession.version + 1,
            };
          }
          throw new Error('accept transaction read failed');
        }
        return currentBinding();
      }),
    },
    recipientConsentState,
    remoteAccessPolicy: {
      updateMany: updatePolicy,
      findUnique: policyFindUnique,
    },
    remoteAssistanceSession: {
      findFirst: sessionFindFirst,
      findUnique: transactionSessionFindUnique,
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
    remoteSessionParticipant: {
      updateMany: updateParticipants,
      findFirst: jest.fn(async ({ where }) => {
        const row = participants.find(
          (candidate) =>
            (!where.sessionId || candidate.sessionId === where.sessionId) &&
            (!where.joinTicketStatus ||
              candidate.joinTicketStatus === where.joinTicketStatus) &&
            (!where.joinTicketIssuedAt?.lte ||
              (candidate.joinTicketIssuedAt &&
                candidate.joinTicketIssuedAt <= where.joinTicketIssuedAt.lte)),
        );
        return row ? { id: row.id } : null;
      }),
    },
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
    updateMany: updateParticipants,
    findUnique: jest.fn(async ({ where }) => {
      const row = participants.find((candidate) => candidate.id === where.id);
      return row ? { ...row } : null;
    }),
    findFirst: jest.fn(async ({ where }) => {
      const row = participants.find((candidate) => {
        if (where.sessionId && candidate.sessionId !== where.sessionId) {
          return false;
        }
        if (
          where.joinTicketStatus &&
          candidate.joinTicketStatus !== where.joinTicketStatus
        ) {
          return false;
        }
        if (
          where.joinTicketIssuedAt?.lte &&
          (!candidate.joinTicketIssuedAt ||
            candidate.joinTicketIssuedAt > where.joinTicketIssuedAt.lte)
        ) {
          return false;
        }
        return true;
      });
      return row ? { id: row.id } : null;
    }),
    findMany: jest.fn(async () =>
      participants.map(({ id, role }) => ({ id, role })),
    ),
  };

  const transactionCommitted = jest.fn();
  let remainingAcceptSerializationFailures =
    options.acceptSerializationFailures ?? 0;
  const prisma = {
    companionBinding: { findFirst: jest.fn(async () => currentBinding()) },
    householdMember: {
      findFirst: jest.fn(async () =>
        options.initiatingMemberActive === false ? null : { userId: IDS.user },
      ),
    },
    recipientConsentState,
    remoteAccessPolicy: {
      updateMany: updatePolicy,
      findUnique: policyFindUnique,
    },
    remoteAssistanceSession: {
      findFirst: sessionFindFirst,
      findUnique: directSessionFindUnique,
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
    $transaction: jest.fn(async (work) => {
      if (remainingAcceptSerializationFailures > 0) {
        remainingAcceptSerializationFailures -= 1;
        throw Object.assign(new Error('serialization conflict'), {
          code: 'P2034',
        });
      }
      const result = await work(transaction);
      transactionCommitted();
      return result;
    }),
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
    ensureRoom: jest.fn(async () => {
      if (options.roomCreationFails) {
        throw new LiveKitUnavailableException();
      }
      if (options.terminalDuringRoomCreation) {
        currentSession = {
          ...currentSession,
          status: REMOTE_SESSION_STATUS.ended,
          endedAt: new Date(NOW),
          endReason: 'FAMILY_ENDED',
          version: currentSession.version + 1,
        };
      }
    }),
    issueJoinTicket: jest.fn(async () => ({
      token: 'livekit-token',
      url: 'wss://rtc.example.test',
      expiresAt: new Date('2026-08-01T08:02:00.000Z'),
    })),
    removeParticipant: jest.fn(async () => undefined),
    deleteRoom: jest.fn(async () => {
      if (remainingRoomDeleteFailures > 0) {
        remainingRoomDeleteFailures -= 1;
        throw new LiveKitUnavailableException();
      }
    }),
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
  const identity = {
    reauthenticateUser: jest.fn(async () => {
      if (options.reauthenticated === false) {
        throw new Error('current password rejected');
      }
    }),
  };
  const companionMedia = {
    endForConsentRevocation: jest.fn(async () => 0),
    endForBindingRevocation: jest.fn(async () => 0),
    listConsentRevokedSessionsForLeaseCleanup: jest.fn(async () => []),
    listEndedSessionsForBindingLeaseCleanup: jest.fn(async () => []),
    interruptForRemoteAssistance: jest.fn(
      async (client: typeof transaction, bindingId: string, now: Date) => {
        await client.modelSession.updateMany({
          where: {
            companionSession: { bindingId, status: 'ACTIVE' },
            status: 'ACTIVE',
          },
          data: {
            status: 'ENDED',
            endedAt: now,
            endReason: 'REMOTE_ASSISTANCE_ACCEPTED',
          },
        });
        await client.companionSession.updateMany({
          where: { bindingId, status: 'ACTIVE' },
          data: {
            status: 'ENDED',
            endedAt: now,
            endReason: 'REMOTE_ASSISTANCE_ACCEPTED',
            version: { increment: 1 },
          },
        });
      },
    ),
    isActiveLeaseOwner: jest.fn(
      async () => options.aiLeaseOwnerDurable ?? options.leaseCurrent === 'AI',
    ),
  };
  const mediaSecurity = new RemoteMediaSecurityCoordinator(
    prisma as unknown as PrismaService,
    leases as unknown as MediaLeasePort,
    livekit as unknown as LiveKitPort,
    companionMedia as unknown as CompanionMediaControlService,
  );
  const markBindingRevoked = jest
    .spyOn(mediaSecurity, 'markBindingRevoked')
    .mockResolvedValue(1);
  const cleanupPendingForBinding = jest
    .spyOn(mediaSecurity, 'cleanupPendingForBinding')
    .mockResolvedValue(undefined);

  const service = new RealtimeCommunicationApplicationService(
    prisma as unknown as PrismaService,
    householdAccess as unknown as HouseholdAccessPolicy,
    identity as unknown as IdentityApplicationService,
    companionMedia as unknown as CompanionMediaControlService,
    config as unknown as ConfigService,
    leases as unknown as MediaLeasePort,
    livekit as unknown as LiveKitPort,
    mediaSecurity,
  );

  async function webhook(
    event: string,
    participantIdentity: string | null,
    trackSource: VerifiedLiveKitWebhook['trackSource'] = null,
    connection?: {
      eventId?: string;
      participantSid?: string;
      participantId?: string | null;
      ticketId?: string | null;
    },
  ) {
    const matchedParticipant = participantIdentity
      ? participants.find((row) => participantIdentity.endsWith(`_${row.id}`))
      : null;
    nextWebhook = {
      eventId: connection?.eventId ?? `event-${event}-${Date.now()}`,
      event,
      roomName: currentSession.livekitRoomName,
      participantIdentity,
      participantSid:
        connection?.participantSid ??
        (matchedParticipant ? `PA_${matchedParticipant.id}` : null),
      participantId:
        connection?.participantId ?? matchedParticipant?.id ?? null,
      participantTicketId:
        connection?.ticketId ?? matchedParticipant?.joinTicketId ?? null,
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
    identity,
    companionMedia,
    mediaSecuritySpies: {
      markBindingRevoked,
      cleanupPendingForBinding,
    },
    transactionCommitted,
    leases,
    livekit,
    participants,
    events,
    outbox,
    currentSession: () => currentSession,
    webhook,
  };
}

describe('RealtimeCommunicationApplicationService availability', () => {
  it('keeps an AI companion lease callable while reporting companionship active', async () => {
    const test = harness({ leaseCurrent: 'AI', sessionVisible: false });

    await expect(
      test.service.getAvailability(userPrincipal, IDS.household, IDS.binding),
    ).resolves.toMatchObject({
      busy: false,
      companionActive: true,
    });
  });

  it('reports busy for a remote lease, an open remote session, or pending cleanup', async () => {
    const scenarios: HarnessOptions[] = [
      { leaseCurrent: 'REMOTE', sessionVisible: false },
      { leaseCurrent: 'NONE' },
      { leaseCurrent: 'NONE', status: REMOTE_SESSION_STATUS.ended },
    ];

    for (const options of scenarios) {
      const test = harness(options);
      await expect(
        test.service.getAvailability(userPrincipal, IDS.household, IDS.binding),
      ).resolves.toMatchObject({
        busy: true,
        companionActive: false,
      });
    }
  });
});

describe('RealtimeCommunicationApplicationService authorization and consent', () => {
  it('requires current-password reauthentication before changing remote media policy', async () => {
    const test = harness({ reauthenticated: false });

    await expect(
      test.service.updateRemoteAccessPolicy({
        principal: userPrincipal,
        householdId: IDS.household,
        bindingId: IDS.binding,
        cameraAllowed: true,
        microphoneAllowed: true,
        sendFamilyAudioAllowed: true,
        version: 0,
        currentPassword: 'wrong-current-password',
      }),
    ).rejects.toThrow('current password rejected');
    expect(test.identity.reauthenticateUser).toHaveBeenCalledWith(
      IDS.user,
      'wrong-current-password',
    );
    expect(test.prisma.companionBinding.findFirst).not.toHaveBeenCalled();
  });

  it('invalidates existing authorization snapshots inside the policy transaction even when loosening policy', async () => {
    const test = harness({
      policyOverrides: {
        cameraAllowed: false,
        microphoneAllowed: false,
        sendFamilyAudioAllowed: false,
      },
    });

    await expect(
      test.service.updateRemoteAccessPolicy({
        principal: userPrincipal,
        householdId: IDS.household,
        bindingId: IDS.binding,
        cameraAllowed: true,
        microphoneAllowed: true,
        sendFamilyAudioAllowed: true,
        version: 0,
        currentPassword: 'current-password',
      }),
    ).resolves.toMatchObject({
      cameraAllowed: true,
      microphoneAllowed: true,
      sendFamilyAudioAllowed: true,
      version: 1,
    });

    expect(test.mediaSecuritySpies.markBindingRevoked).toHaveBeenCalledWith(
      test.transaction,
      IDS.binding,
      'REMOTE_POLICY_CHANGED',
      expect.any(Date),
    );
    expect(
      test.mediaSecuritySpies.cleanupPendingForBinding,
    ).toHaveBeenCalledWith(IDS.binding);
    expect(
      test.mediaSecuritySpies.markBindingRevoked.mock.invocationCallOrder[0],
    ).toBeLessThan(test.transactionCommitted.mock.invocationCallOrder[0]!);
    expect(test.transactionCommitted.mock.invocationCallOrder[0]).toBeLessThan(
      test.mediaSecuritySpies.cleanupPendingForBinding.mock
        .invocationCallOrder[0]!,
    );
  });

  it('does not start media cleanup when the policy transaction fails', async () => {
    const test = harness({ policyTransactionFails: true });

    await expect(
      test.service.updateRemoteAccessPolicy({
        principal: userPrincipal,
        householdId: IDS.household,
        bindingId: IDS.binding,
        cameraAllowed: false,
        microphoneAllowed: false,
        sendFamilyAudioAllowed: false,
        version: 0,
        currentPassword: 'current-password',
      }),
    ).rejects.toThrow('policy transaction failed');

    expect(test.mediaSecuritySpies.markBindingRevoked).not.toHaveBeenCalled();
    expect(test.transactionCommitted).not.toHaveBeenCalled();
    expect(
      test.mediaSecuritySpies.cleanupPendingForBinding,
    ).not.toHaveBeenCalled();
  });

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
    const test = harness({ leaseCurrent: 'AI', sessionVisible: false });

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

  it('does not let a second caller displace the first ringing call while AI owns the lease', async () => {
    const test = harness({ leaseCurrent: 'AI' });

    await expect(
      test.service.requestRemoteSession({
        principal: userPrincipal,
        householdId: IDS.household,
        bindingId: IDS.binding,
        media,
        idempotencyKey: 'remote-request-second-ai-handoff',
        traceId: 'request-second-ai-handoff',
      }),
    ).rejects.toMatchObject({ response: { code: 'REMOTE_DEVICE_BUSY' } });

    expect(test.currentSession()).toMatchObject({
      id: IDS.session,
      status: REMOTE_SESSION_STATUS.ringing,
      endReason: null,
    });
    expect(
      test.transaction.remoteAssistanceSession.create,
    ).not.toHaveBeenCalled();
    expect(test.events).toHaveLength(0);
    expect(test.outbox).toHaveLength(0);
  });

  it('does not create a ringing call from an uncommitted provisional AI lease', async () => {
    const test = harness({
      leaseCurrent: 'AI',
      aiLeaseOwnerDurable: false,
      sessionVisible: false,
    });

    await expect(
      test.service.requestRemoteSession({
        principal: userPrincipal,
        householdId: IDS.household,
        bindingId: IDS.binding,
        media,
        idempotencyKey: 'remote-request-provisional-ai',
        traceId: 'request-provisional-ai',
      }),
    ).rejects.toMatchObject({ response: { code: 'REMOTE_DEVICE_BUSY' } });

    expect(test.companionMedia.isActiveLeaseOwner).toHaveBeenCalledWith(
      IDS.binding,
      'ai-session',
    );
    expect(
      test.transaction.remoteAssistanceSession.create,
    ).not.toHaveBeenCalled();
    expect(test.events).toHaveLength(0);
    expect(test.outbox).toHaveLength(0);
  });

  it('preserves a deterministic remote lease while a same-id winner can still be uncommitted', async () => {
    const test = harness({ leaseCurrent: 'NONE' });
    test.prisma.remoteAssistanceSession.findFirst.mockResolvedValueOnce(null);
    test.leases.release.mockClear();
    const reconcile = Reflect.get(
      test.service,
      'releaseProvisionalRemoteLeaseIfUnowned',
    ) as unknown as (bindingId: string, sessionId: string) => Promise<void>;
    const boundReconcile = reconcile.bind(test.service);

    await boundReconcile(IDS.binding, IDS.session);

    expect(test.prisma.remoteAssistanceSession.findFirst).toHaveBeenCalledWith({
      where: {
        id: IDS.session,
        bindingId: IDS.binding,
        status: { in: expect.arrayContaining(['RINGING', 'ACCEPTED']) },
      },
      select: { id: true },
    });
    expect(test.leases.release).not.toHaveBeenCalled();
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

  it('does not reacquire or renew the media lease for a terminal remote replay', async () => {
    const test = harness({
      status: REMOTE_SESSION_STATUS.ended,
      replayWithMedia: '7',
    });

    const result = await test.service.requestRemoteSession({
      principal: userPrincipal,
      householdId: IDS.household,
      bindingId: IDS.binding,
      media,
      idempotencyKey: 'remote-request-terminal-replay',
      traceId: 'request-terminal-replay',
    });

    expect(result.status).toBe(REMOTE_SESSION_STATUS.ended);
    expect(test.leases.renew).not.toHaveBeenCalled();
    expect(test.leases.acquire).not.toHaveBeenCalled();
  });

  it('releases the replay lease owner when authority is revoked before lease confirmation', async () => {
    const test = harness({ replayWithMedia: '7' });
    test.leases.renew.mockImplementationOnce(async () => {
      const session = test.currentSession();
      await test.transaction.remoteAssistanceSession.updateMany({
        where: {
          id: session.id,
          status: REMOTE_SESSION_STATUS.ringing,
          version: session.version,
        },
        data: {
          status: REMOTE_SESSION_STATUS.ended,
          endedAt: new Date(),
          endReason: 'REMOTE_AUTHORITY_REVOKED',
          version: { increment: 1 },
        },
      });
      return true;
    });

    const result = await test.service.requestRemoteSession({
      principal: userPrincipal,
      householdId: IDS.household,
      bindingId: IDS.binding,
      media,
      idempotencyKey: 'remote-request-revoked-during-replay',
      traceId: 'request-revoked-during-replay',
    });
    const owner = {
      ownerType: 'REMOTE_ASSISTANCE',
      ownerId: result.id,
      leaseId: result.id,
    };

    expect(result.status).toBe(REMOTE_SESSION_STATUS.ended);
    expect(test.currentSession().endReason).toBe('REMOTE_AUTHORITY_REVOKED');
    expect(test.leases.renew).toHaveBeenCalledWith(
      IDS.binding,
      owner,
      expect.any(Number),
    );
    expect(test.leases.acquire).not.toHaveBeenCalled();
    expect(test.leases.release).toHaveBeenCalledWith(IDS.binding, owner);
    expect(test.leases.renew.mock.invocationCallOrder[0]).toBeLessThan(
      test.leases.release.mock.invocationCallOrder[0]!,
    );
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
  it('returns a previously committed onsite acceptance idempotently', async () => {
    const test = harness({ status: REMOTE_SESSION_STATUS.accepted });

    await expect(
      test.service.acceptByDevice(devicePrincipal, IDS.session),
    ).resolves.toMatchObject({ status: REMOTE_SESSION_STATUS.accepted });

    expect(test.leases.renew).toHaveBeenCalledWith(
      IDS.binding,
      {
        ownerType: 'REMOTE_ASSISTANCE',
        ownerId: IDS.session,
        leaseId: IDS.session,
      },
      90,
    );
    expect(test.prisma.$transaction).not.toHaveBeenCalled();
    expect(test.transaction.modelSession.updateMany).not.toHaveBeenCalled();
    expect(test.outbox).toHaveLength(0);
  });

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

  it('uses room deletion as the first terminal media boundary', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      ticketIssued: true,
    });
    const test = harness({ participants: [family] });

    await test.service.declineByDevice(devicePrincipal, IDS.session);

    expect(test.livekit.deleteRoom).toHaveBeenCalledTimes(1);
    expect(test.livekit.removeParticipant).not.toHaveBeenCalled();
    expect(test.livekit.deleteRoom.mock.invocationCallOrder[0]).toBeLessThan(
      test.leases.release.mock.invocationCallOrder[0]!,
    );
  });

  it('keeps a continuous cleanup barrier when hang-up wins during durable room provisioning', async () => {
    const provisioning = {
      ...participant('FAMILY', IDS.familyParticipant),
      joinTicketId: IDS.familyParticipant,
      joinTicketStatus: 'PROVISIONING',
      joinTicketIssuedAt: new Date(NOW),
    };
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      participants: [provisioning],
      leaseCurrent: 'REMOTE',
    });

    await expect(
      test.service.cancelByFamily(userPrincipal, IDS.household, IDS.session),
    ).resolves.toMatchObject({ status: REMOTE_SESSION_STATUS.cancelled });

    expect(test.currentSession()).toMatchObject({
      status: REMOTE_SESSION_STATUS.cancelled,
      roomCleanupStatus: 'PENDING',
      roomCleanupNotBefore: expect.any(Date),
    });
    expect(test.participants[0]?.joinTicketStatus).toBe('REVOKED');
    expect(test.livekit.deleteRoom).toHaveBeenCalledWith('ml_test_room');
    expect(test.leases.release).not.toHaveBeenCalled();
  });

  it('terminalizes the latest locked state after acceptance, connecting and activation all outrun a stale caller', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      ticketIssued: true,
    });
    const test = harness({ participants: [family] });
    const staleRinging = { ...test.currentSession() };

    for (const nextStatus of [
      REMOTE_SESSION_STATUS.accepted,
      REMOTE_SESSION_STATUS.connecting,
      REMOTE_SESSION_STATUS.active,
    ]) {
      const current = test.currentSession();
      await test.transaction.remoteAssistanceSession.updateMany({
        where: {
          id: current.id,
          status: current.status,
          version: current.version,
        },
        data: {
          status: nextStatus,
          ...(nextStatus === REMOTE_SESSION_STATUS.accepted
            ? { acceptedAt: new Date(NOW) }
            : {}),
          ...(nextStatus === REMOTE_SESSION_STATUS.active
            ? { connectedAt: new Date(NOW) }
            : {}),
          version: { increment: 1 },
        },
      });
    }
    const finish = Reflect.get(test.service, 'finishSession') as unknown as (
      session: typeof staleRinging,
      command: {
        targetStatus: string;
        actorType: 'USER';
        actorId: string;
        reason: string;
      },
    ) => Promise<{ status: string }>;
    const boundFinish = finish.bind(test.service);

    await expect(
      boundFinish(staleRinging, {
        targetStatus: REMOTE_SESSION_STATUS.cancelled,
        actorType: 'USER',
        actorId: IDS.user,
        reason: 'FAMILY_CANCELLED',
      }),
    ).resolves.toMatchObject({ status: REMOTE_SESSION_STATUS.ended });

    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.ended);
    expect(test.participants[0]?.joinTicketStatus).toBe('REVOKED');
    expect(test.livekit.deleteRoom).toHaveBeenCalledWith('ml_test_room');
    expect(test.prisma.$transaction).toHaveBeenLastCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: 'Serializable',
        timeout: 15_000,
      }),
    );
  });

  it('falls back to participant removal and retries deletion when the first room delete fails', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      ticketIssued: true,
    });
    const device = participant('DEVICE', IDS.deviceParticipant, {
      ticketIssued: true,
    });
    const test = harness({
      participants: [family, device],
      roomDeleteFailures: 1,
    });

    await test.service.declineByDevice(devicePrincipal, IDS.session);

    expect(test.livekit.deleteRoom).toHaveBeenCalledTimes(2);
    expect(test.livekit.removeParticipant).toHaveBeenCalledTimes(2);
    expect(test.livekit.deleteRoom.mock.invocationCallOrder[0]).toBeLessThan(
      test.livekit.removeParticipant.mock.invocationCallOrder[0]!,
    );
    expect(
      test.livekit.removeParticipant.mock.invocationCallOrder[1],
    ).toBeLessThan(test.livekit.deleteRoom.mock.invocationCallOrder[1]!);
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

  it('retries a serializable onsite acceptance after a MySQL deadlock', async () => {
    const test = harness({ acceptSerializationFailures: 1 });

    await expect(
      test.service.acceptByDevice(devicePrincipal, IDS.session),
    ).resolves.toMatchObject({ status: REMOTE_SESSION_STATUS.accepted });

    expect(test.prisma.$transaction).toHaveBeenCalledTimes(2);
    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.accepted);
    expect(test.leases.release).not.toHaveBeenCalled();
    expect(test.outbox).toHaveLength(1);
  });

  it('reclassifies an AI owner that wins after an empty acceptance lease read', async () => {
    const test = harness({
      leaseCurrent: 'NONE',
      leaseAcquired: false,
      aiLeaseOwnerDurable: true,
    });
    const aiOwner = {
      ownerType: 'AI_COMPANION' as const,
      ownerId: 'ai-session-race-winner',
      leaseId: 'ai-session-race-winner',
    };
    test.leases.current
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(aiOwner);

    await expect(
      test.service.acceptByDevice(devicePrincipal, IDS.session),
    ).resolves.toMatchObject({ status: REMOTE_SESSION_STATUS.accepted });

    expect(test.leases.acquire).toHaveBeenCalledTimes(1);
    expect(test.leases.transfer).toHaveBeenCalledWith(
      IDS.binding,
      aiOwner,
      {
        ownerType: 'REMOTE_ASSISTANCE',
        ownerId: IDS.session,
        leaseId: IDS.session,
      },
      90,
    );
  });

  it('returns one accepted session when two answers race the same AI handoff', async () => {
    const test = harness({
      leaseCurrent: 'AI',
      aiLeaseOwnerDurable: true,
    });
    type Owner = {
      ownerType: 'AI_COMPANION' | 'REMOTE_ASSISTANCE';
      ownerId: string;
      leaseId: string;
    };
    let redisOwner: Owner = {
      ownerType: 'AI_COMPANION',
      ownerId: 'ai-session',
      leaseId: 'ai-lease',
    };
    test.leases.current.mockImplementation(async () => ({ ...redisOwner }));
    test.leases.transfer.mockImplementation(
      async (_bindingId, current: Owner, next: Owner) => {
        if (
          current.ownerType !== redisOwner.ownerType ||
          current.ownerId !== redisOwner.ownerId ||
          current.leaseId !== redisOwner.leaseId
        ) {
          return false;
        }
        redisOwner = { ...next };
        return true;
      },
    );
    test.leases.renew.mockImplementation(async (_bindingId, owner: Owner) =>
      Boolean(
        owner.ownerType === redisOwner.ownerType &&
        owner.ownerId === redisOwner.ownerId &&
        owner.leaseId === redisOwner.leaseId,
      ),
    );

    const results = await Promise.all([
      test.service.acceptByDevice(devicePrincipal, IDS.session),
      test.service.acceptByDevice(devicePrincipal, IDS.session),
    ]);

    expect(results).toEqual([
      expect.objectContaining({ status: REMOTE_SESSION_STATUS.accepted }),
      expect.objectContaining({ status: REMOTE_SESSION_STATUS.accepted }),
    ]);
    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.accepted);
    expect(test.transaction.modelSession.updateMany).toHaveBeenCalledTimes(1);
    expect(test.outbox).toHaveLength(1);
    expect(test.leases.release).not.toHaveBeenCalled();
  });

  it('keeps the call ringing when acceptance races an uncommitted AI reservation', async () => {
    const test = harness({
      leaseCurrent: 'AI',
      aiLeaseOwnerDurable: false,
    });

    await expect(
      test.service.acceptByDevice(devicePrincipal, IDS.session),
    ).rejects.toMatchObject({ response: { code: 'REMOTE_DEVICE_BUSY' } });

    expect(test.currentSession()).toMatchObject({
      status: REMOTE_SESSION_STATUS.ringing,
      endReason: null,
    });
    expect(test.leases.transfer).not.toHaveBeenCalled();
    expect(test.livekit.deleteRoom).not.toHaveBeenCalled();
    expect(test.outbox).toHaveLength(0);
  });

  it('returns the concurrent onsite acceptance winner idempotently', async () => {
    const test = harness({ acceptCasLostToConcurrentWinner: true });

    await expect(
      test.service.acceptByDevice(devicePrincipal, IDS.session),
    ).resolves.toMatchObject({ status: REMOTE_SESSION_STATUS.accepted });

    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.accepted);
    expect(test.leases.release).not.toHaveBeenCalled();
    expect(test.transaction.modelSession.updateMany).not.toHaveBeenCalled();
    expect(test.outbox).toHaveLength(0);
  });

  it('does not release a provisional answer lease while the durable call is still ringing', async () => {
    const test = harness({
      leaseCurrent: 'AI',
      acceptEligibilityReadFails: true,
    });

    await expect(
      test.service.acceptByDevice(devicePrincipal, IDS.session),
    ).rejects.toThrow('accept transaction read failed');

    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.ringing);
    expect(test.leases.transfer).toHaveBeenCalledTimes(1);
    expect(test.leases.release).not.toHaveBeenCalled();
    expect(test.leases.acquire).not.toHaveBeenCalled();
  });

  it('compare-releases a restored AI lease when that AI session ends during failed-accept compensation', async () => {
    const test = harness({
      leaseCurrent: 'AI',
      acceptEligibilityReadFails: true,
      terminateBeforeAcceptEligibilityFailure: true,
    });
    test.companionMedia.isActiveLeaseOwner
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    await expect(
      test.service.acceptByDevice(devicePrincipal, IDS.session),
    ).rejects.toThrow('accept transaction read failed');

    const aiOwner = {
      ownerType: 'AI_COMPANION',
      ownerId: 'ai-session',
      leaseId: 'ai-lease',
    } as const;
    expect(test.leases.acquire).toHaveBeenCalledWith(IDS.binding, aiOwner, 90);
    expect(test.leases.release).toHaveBeenNthCalledWith(1, IDS.binding, {
      ownerType: 'REMOTE_ASSISTANCE',
      ownerId: IDS.session,
      leaseId: IDS.session,
    });
    expect(test.leases.release).toHaveBeenNthCalledWith(
      2,
      IDS.binding,
      aiOwner,
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

  it('durably provisions the private room once before minting participant tickets', async () => {
    const test = harness({ status: REMOTE_SESSION_STATUS.accepted });

    await test.service.issueFamilyJoinTicket(
      userPrincipal,
      IDS.household,
      IDS.session,
      'WEB',
    );
    const firstTicketOrder =
      test.livekit.issueJoinTicket.mock.invocationCallOrder[0]!;
    await test.service.issueDeviceJoinTicket(
      devicePrincipal,
      IDS.session,
      'ANDROID',
    );

    expect(test.livekit.ensureRoom).toHaveBeenCalledTimes(1);
    expect(test.livekit.ensureRoom).toHaveBeenCalledWith('ml_test_room');
    expect(test.currentSession().roomProvisionedAt).toEqual(expect.any(Date));
    expect(test.livekit.ensureRoom.mock.invocationCallOrder[0]).toBeLessThan(
      firstTicketOrder,
    );
  });

  it('commits the unique owner before CreateRoom and room readiness before minting', async () => {
    const test = harness({ status: REMOTE_SESSION_STATUS.accepted });

    await test.service.issueFamilyJoinTicket(
      userPrincipal,
      IDS.household,
      IDS.session,
      'WEB',
    );

    expect(test.prisma.$transaction).toHaveBeenCalledWith(
      expect.any(Function),
      expect.objectContaining({
        isolationLevel: 'Serializable',
        timeout: 8_000,
      }),
    );
    expect(test.transactionCommitted).toHaveBeenCalledTimes(2);
    expect(test.transactionCommitted.mock.invocationCallOrder[0]).toBeLessThan(
      test.livekit.ensureRoom.mock.invocationCallOrder[0]!,
    );
    expect(test.livekit.ensureRoom.mock.invocationCallOrder[0]).toBeLessThan(
      test.transactionCommitted.mock.invocationCallOrder[1]!,
    );
    expect(test.transactionCommitted.mock.invocationCallOrder[1]).toBeLessThan(
      test.livekit.issueJoinTicket.mock.invocationCallOrder[0]!,
    );
  });

  it('allows only one session-wide first-room provisioner', async () => {
    const test = harness({ status: REMOTE_SESSION_STATUS.accepted });
    let releaseRoom!: () => void;
    let roomStarted!: () => void;
    const roomGate = new Promise<void>((resolve) => {
      releaseRoom = resolve;
    });
    const roomReached = new Promise<void>((resolve) => {
      roomStarted = resolve;
    });
    test.livekit.ensureRoom.mockImplementationOnce(async () => {
      roomStarted();
      await roomGate;
    });

    const familyIssuing = test.service.issueFamilyJoinTicket(
      userPrincipal,
      IDS.household,
      IDS.session,
      'WEB',
    );
    await roomReached;

    await expect(
      test.service.issueDeviceJoinTicket(
        devicePrincipal,
        IDS.session,
        'ANDROID',
      ),
    ).rejects.toMatchObject({
      response: { code: 'REMOTE_DEVICE_BUSY' },
    });
    expect(test.livekit.ensureRoom).toHaveBeenCalledTimes(1);
    expect(
      test.participants.find((candidate) => candidate.role === 'DEVICE'),
    ).toMatchObject({ joinTicketId: null, joinTicketStatus: null });

    releaseRoom();
    await familyIssuing;
    await expect(
      test.service.issueDeviceJoinTicket(
        devicePrincipal,
        IDS.session,
        'ANDROID',
      ),
    ).resolves.toMatchObject({ recording: false, transcription: false });
    expect(test.livekit.ensureRoom).toHaveBeenCalledTimes(1);
  });

  it('fails the session without minting when the provider cannot create the room', async () => {
    const test = harness({
      status: REMOTE_SESSION_STATUS.accepted,
      roomCreationFails: true,
    });

    await expect(
      test.service.issueFamilyJoinTicket(
        userPrincipal,
        IDS.household,
        IDS.session,
        'WEB',
      ),
    ).rejects.toMatchObject({
      response: { code: 'MEDIA_PROVIDER_UNAVAILABLE' },
    });

    expect(test.livekit.issueJoinTicket).not.toHaveBeenCalled();
    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.failed);
    expect(test.currentSession().endReason).toBe('MEDIA_PROVIDER_UNAVAILABLE');
    expect(test.participants[0]?.joinTicketStatus).toBe('REVOKED');
  });

  it('never creates a room for a terminal session', async () => {
    const test = harness({ status: REMOTE_SESSION_STATUS.ended });

    await expect(
      test.service.issueFamilyJoinTicket(
        userPrincipal,
        IDS.household,
        IDS.session,
        'WEB',
      ),
    ).rejects.toMatchObject({
      response: { code: 'REMOTE_SESSION_STATE_CONFLICT' },
    });

    expect(test.livekit.ensureRoom).not.toHaveBeenCalled();
    expect(test.livekit.issueJoinTicket).not.toHaveBeenCalled();
  });

  it('does not add a provisioning grace fence when termination wins before the LiveKit RPC starts', async () => {
    const test = harness({
      status: REMOTE_SESSION_STATUS.accepted,
      terminalBeforeRoomTransaction: true,
    });

    await expect(
      test.service.issueFamilyJoinTicket(
        userPrincipal,
        IDS.household,
        IDS.session,
        'WEB',
      ),
    ).rejects.toMatchObject({
      response: { code: 'REMOTE_SESSION_STATE_CONFLICT' },
    });

    expect(test.livekit.ensureRoom).not.toHaveBeenCalled();
    expect(test.currentSession()).toMatchObject({
      status: REMOTE_SESSION_STATUS.ended,
      roomCleanupStatus: 'COMPLETED',
      roomCleanupNotBefore: null,
    });
  });

  it('deletes a room and withholds the token when termination races with room creation', async () => {
    const test = harness({
      status: REMOTE_SESSION_STATUS.accepted,
      terminalDuringRoomCreation: true,
    });

    await expect(
      test.service.issueFamilyJoinTicket(
        userPrincipal,
        IDS.household,
        IDS.session,
        'WEB',
      ),
    ).rejects.toMatchObject({
      response: { code: 'REMOTE_SESSION_STATE_CONFLICT' },
    });

    expect(test.livekit.ensureRoom).toHaveBeenCalledWith('ml_test_room');
    expect(test.livekit.issueJoinTicket).not.toHaveBeenCalled();
    expect(test.livekit.deleteRoom).toHaveBeenCalledWith('ml_test_room');
    expect(test.participants[0]?.joinTicketStatus).toBe('REVOKED');
  });

  it('keeps a shared room open and makes an unminted ticket retryable after a transient post-ensure read', async () => {
    const device = participant('DEVICE', IDS.deviceParticipant, {
      ticketIssued: true,
    });
    const test = harness({
      status: REMOTE_SESSION_STATUS.accepted,
      participants: [device],
      postEnsureEligibilityReadFails: true,
    });

    await expect(
      test.service.issueFamilyJoinTicket(
        userPrincipal,
        IDS.household,
        IDS.session,
        'WEB',
      ),
    ).rejects.toThrow('post-ensure session read failed');

    expect(test.livekit.deleteRoom).not.toHaveBeenCalled();
    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.connecting);
    expect(
      test.participants.find((row) => row.id === IDS.deviceParticipant)
        ?.joinTicketStatus,
    ).toBe('ISSUED');
    expect(
      test.participants.find((row) => row.role === 'FAMILY')?.joinTicketStatus,
    ).toBeNull();

    await expect(
      test.service.issueFamilyJoinTicket(
        userPrincipal,
        IDS.household,
        IDS.session,
        'WEB',
      ),
    ).resolves.toMatchObject({ sessionId: IDS.session });
    expect(test.livekit.deleteRoom).not.toHaveBeenCalled();
    expect(
      test.participants.find((row) => row.role === 'FAMILY')?.joinTicketStatus,
    ).toBe('ISSUED');
  });

  it('reserves one join ticket per session participant and rejects re-issuance', async () => {
    const test = harness({ status: REMOTE_SESSION_STATUS.accepted });

    const first = await test.service.issueFamilyJoinTicket(
      userPrincipal,
      IDS.household,
      IDS.session,
      'WEB',
    );

    expect(first.ticketId).toHaveLength(26);
    await expect(
      test.service.issueFamilyJoinTicket(
        userPrincipal,
        IDS.household,
        IDS.session,
        'WEB',
      ),
    ).rejects.toMatchObject({
      response: { code: 'REMOTE_JOIN_TICKET_ALREADY_ISSUED' },
    });
    expect(test.livekit.issueJoinTicket).toHaveBeenCalledTimes(1);
  });

  it('accepts a redelivery of the exact participant_joined webhook idempotently', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      ticketIssued: true,
    });
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      participants: [family],
    });
    const identity = `family_${IDS.session}_${IDS.familyParticipant}`;
    const originalConnection = {
      eventId: 'EV_join_family_original',
      participantSid: 'PA_family_original',
    };

    await test.webhook(
      'participant_joined',
      identity,
      null,
      originalConnection,
    );
    await test.webhook(
      'participant_joined',
      identity,
      null,
      originalConnection,
    );

    expect(test.livekit.removeParticipant).not.toHaveBeenCalled();
    expect(test.participants[0]).toEqual(
      expect.objectContaining({
        joinTicketStatus: 'CONSUMED',
        joinTicketConsumedEventId: originalConnection.eventId,
        livekitParticipantSid: originalConnection.participantSid,
      }),
    );
  });

  it('preserves a legitimate track event delivered before participant_joined for the same connection', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      ticketIssued: true,
    });
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      participants: [family],
    });
    const identity = `family_${IDS.session}_${IDS.familyParticipant}`;
    const participantSid = 'PA_family_out_of_order';

    await test.webhook('track_published', identity, 'microphone', {
      eventId: 'EV_track_family_early',
      participantSid,
    });
    await test.webhook('participant_joined', identity, null, {
      eventId: 'EV_join_family_late',
      participantSid,
    });

    expect(test.livekit.removeParticipant).not.toHaveBeenCalled();
    expect(test.participants[0]).toEqual(
      expect.objectContaining({
        joinedAt: expect.any(Date),
        publishedAudio: true,
        joinTicketStatus: 'CONSUMED',
        joinTicketConsumedEventId: 'EV_join_family_late',
        livekitParticipantSid: participantSid,
      }),
    );
  });

  it('preserves a same-connection track event racing participant_joined', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      ticketIssued: true,
    });
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      participants: [family],
    });
    const identity = `family_${IDS.session}_${IDS.familyParticipant}`;
    const participantSid = 'PA_family_concurrent';

    await Promise.all([
      test.webhook('track_published', identity, 'microphone', {
        eventId: 'EV_track_family_concurrent',
        participantSid,
      }),
      test.webhook('participant_joined', identity, null, {
        eventId: 'EV_join_family_concurrent',
        participantSid,
      }),
    ]);

    expect(test.livekit.removeParticipant).not.toHaveBeenCalled();
    expect(test.participants[0]).toEqual(
      expect.objectContaining({
        publishedAudio: true,
        joinTicketStatus: 'CONSUMED',
        joinTicketConsumedEventId: 'EV_join_family_concurrent',
        livekitParticipantSid: participantSid,
      }),
    );
  });

  it('accepts an early track after the same-SID join wins the consumption CAS', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      ticketIssued: true,
    });
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      participants: [family],
    });
    const identity = `family_${IDS.session}_${IDS.familyParticipant}`;
    const participantSid = 'PA_family_join_wins';
    const updateParticipant = test.prisma.remoteSessionParticipant.updateMany;
    const updateParticipantNormally =
      updateParticipant.getMockImplementation()!;
    let releaseReservation!: () => void;
    let markReservationReached!: () => void;
    const reservationBlocked = new Promise<void>((resolve) => {
      releaseReservation = resolve;
    });
    const reservationReached = new Promise<void>((resolve) => {
      markReservationReached = resolve;
    });
    let delayedReservation = false;
    updateParticipant.mockImplementation(async (command) => {
      if (
        !delayedReservation &&
        command.data.livekitParticipantSid === participantSid &&
        command.data.joinTicketStatus === undefined
      ) {
        delayedReservation = true;
        markReservationReached();
        await reservationBlocked;
      }
      return updateParticipantNormally(command);
    });

    const trackWebhook = test.webhook(
      'track_published',
      identity,
      'microphone',
      {
        eventId: 'EV_track_family_join_wins',
        participantSid,
      },
    );
    await reservationReached;
    await test.webhook('participant_joined', identity, null, {
      eventId: 'EV_join_family_wins',
      participantSid,
    });
    releaseReservation();
    await trackWebhook;

    expect(test.livekit.removeParticipant).not.toHaveBeenCalled();
    expect(test.participants[0]).toEqual(
      expect.objectContaining({
        publishedAudio: true,
        joinTicketStatus: 'CONSUMED',
        joinTicketConsumedEventId: 'EV_join_family_wins',
        livekitParticipantSid: participantSid,
      }),
    );
  });

  it('does not let a later join with another SID replace an out-of-order connection reservation', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      ticketIssued: true,
    });
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      participants: [family],
    });
    const identity = `family_${IDS.session}_${IDS.familyParticipant}`;

    await test.webhook('track_published', identity, 'microphone', {
      eventId: 'EV_track_family_original',
      participantSid: 'PA_family_original',
    });
    await test.webhook('participant_joined', identity, null, {
      eventId: 'EV_join_family_replay',
      participantSid: 'PA_family_replay',
    });

    expect(test.livekit.removeParticipant).toHaveBeenCalledTimes(1);
    expect(test.participants[0]).toEqual(
      expect.objectContaining({
        joinTicketStatus: 'ISSUED',
        joinTicketConsumedEventId: null,
        livekitParticipantSid: 'PA_family_original',
      }),
    );
  });

  it('rejects a different participant_joined event even when it repeats the admitted SID', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      ticketIssued: true,
    });
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      participants: [family],
    });
    const identity = `family_${IDS.session}_${IDS.familyParticipant}`;
    const participantSid = 'PA_family_original';

    await test.webhook('participant_joined', identity, null, {
      eventId: 'EV_join_family_original',
      participantSid,
    });
    await test.webhook('participant_joined', identity, null, {
      eventId: 'EV_join_family_different',
      participantSid,
    });

    expect(test.livekit.removeParticipant).toHaveBeenCalledTimes(1);
    expect(test.participants[0]).toEqual(
      expect.objectContaining({
        joinTicketConsumedEventId: 'EV_join_family_original',
        livekitParticipantSid: participantSid,
      }),
    );
  });

  it('atomically consumes only one of two concurrent joins for different SIDs', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      ticketIssued: true,
    });
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      participants: [family],
    });
    const identity = `family_${IDS.session}_${IDS.familyParticipant}`;

    await Promise.all([
      test.webhook('participant_joined', identity, null, {
        eventId: 'EV_join_family_concurrent_a',
        participantSid: 'PA_family_concurrent_a',
      }),
      test.webhook('participant_joined', identity, null, {
        eventId: 'EV_join_family_concurrent_b',
        participantSid: 'PA_family_concurrent_b',
      }),
    ]);

    const admittedPair = `${test.participants[0]?.joinTicketConsumedEventId}:${test.participants[0]?.livekitParticipantSid}`;
    expect([
      'EV_join_family_concurrent_a:PA_family_concurrent_a',
      'EV_join_family_concurrent_b:PA_family_concurrent_b',
    ]).toContain(admittedPair);
    expect(test.livekit.removeParticipant).toHaveBeenCalledTimes(1);
  });

  it('removes a second physical connection that replays the consumed JWT and identity', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      ticketIssued: true,
    });
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      participants: [family],
    });
    const identity = `family_${IDS.session}_${IDS.familyParticipant}`;

    await test.webhook('participant_joined', identity, null, {
      eventId: 'EV_join_family_original',
      participantSid: 'PA_family_original',
    });
    await test.webhook('participant_joined', identity, null, {
      eventId: 'EV_join_family_replay',
      participantSid: 'PA_family_replay',
    });

    expect(test.livekit.removeParticipant).toHaveBeenCalledTimes(1);
    expect(test.livekit.removeParticipant).toHaveBeenCalledWith(
      'ml_test_room',
      identity,
    );
    expect(test.participants[0]).toEqual(
      expect.objectContaining({
        joinTicketConsumedEventId: 'EV_join_family_original',
        livekitParticipantSid: 'PA_family_original',
      }),
    );
  });

  it('ignores leave events from a rejected replay connection', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      ticketIssued: true,
    });
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      participants: [family],
    });
    const identity = `family_${IDS.session}_${IDS.familyParticipant}`;

    await test.webhook('participant_joined', identity, null, {
      eventId: 'EV_join_family_original',
      participantSid: 'PA_family_original',
    });
    await test.webhook('participant_left', identity, null, {
      eventId: 'EV_left_family_replay',
      participantSid: 'PA_family_replay',
    });

    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.connecting);
    expect(test.participants[0]?.leftAt).toBeNull();
  });

  it('rejects a join whose signed participant metadata does not match the persisted ticket', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      ticketIssued: true,
    });
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      participants: [family],
    });
    const identity = `family_${IDS.session}_${IDS.familyParticipant}`;

    await test.webhook('participant_joined', identity, null, {
      eventId: 'EV_join_family_forged',
      participantSid: 'PA_family_forged',
      ticketId: '01J0000000000000000000000Z',
    });

    expect(test.livekit.removeParticipant).toHaveBeenCalledWith(
      'ml_test_room',
      identity,
    );
    expect(test.participants[0]?.joinTicketStatus).toBe('ISSUED');
  });

  it('does not become ACTIVE until both sides join and every required track exists', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      ticketIssued: true,
    });
    const device = participant('DEVICE', IDS.deviceParticipant, {
      ticketIssued: true,
    });
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
    expect(test.participants.map((item) => item.joinTicketStatus)).toEqual([
      'CONSUMED',
      'CONSUMED',
    ]);
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
    expect(test.livekit.removeParticipant).not.toHaveBeenCalled();
    expect(test.livekit.deleteRoom).toHaveBeenCalledTimes(1);
  });

  it('terminates instead of silently reusing a ticket after an admitted connection aborts', async () => {
    const family = participant('FAMILY', IDS.familyParticipant, {
      joined: true,
      audio: true,
    });
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      participants: [family],
    });

    await test.webhook(
      'participant_connection_aborted',
      `family_${IDS.session}_${IDS.familyParticipant}`,
    );

    expect(test.currentSession().status).toBe(REMOTE_SESSION_STATUS.cancelled);
    expect(test.currentSession().endReason).toBe('PARTICIPANT_LEFT');
    expect(test.participants[0]?.leftAt).not.toBeNull();
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

  it('recovers a crashed room-provisioning saga from its stale PROVISIONING ticket', async () => {
    const issuing = {
      ...participant('FAMILY', IDS.familyParticipant),
      joinTicketId: IDS.familyParticipant,
      joinTicketStatus: 'PROVISIONING',
      joinTicketIssuedAt: new Date(NOW),
    };
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      participants: [issuing],
      leaseCurrent: 'REMOTE',
    });
    const sweepAt = new Date(NOW.getTime() + 16_000);

    await expect(test.service.expireStaleSessions(sweepAt)).resolves.toEqual({
      examined: 1,
      expired: 0,
      failed: 1,
    });

    expect(test.currentSession()).toMatchObject({
      status: REMOTE_SESSION_STATUS.failed,
      endReason: 'ROOM_PROVISIONING_STALLED',
      roomCleanupStatus: 'PENDING',
      roomCleanupNotBefore: expect.any(Date),
    });
    expect(test.participants[0]?.joinTicketStatus).toBe('REVOKED');
    expect(test.livekit.deleteRoom).toHaveBeenCalledWith('ml_test_room');
    expect(test.leases.release).not.toHaveBeenCalled();
  });

  it.each(['ISSUING', 'ROOM_READY'])(
    'releases a stale unminted %s reservation without failing the open call',
    async (joinTicketStatus) => {
      const stranded = {
        ...participant('FAMILY', IDS.familyParticipant),
        joinTicketId: IDS.familyParticipant,
        joinTicketStatus,
        joinTicketIssuedAt: new Date(NOW),
      };
      const test = harness({
        status: REMOTE_SESSION_STATUS.connecting,
        participants: [stranded],
        leaseCurrent: 'REMOTE',
      });

      await expect(
        test.service.expireStaleSessions(new Date(NOW.getTime() + 16_000)),
      ).resolves.toEqual({ examined: 1, expired: 0, failed: 0 });

      expect(test.currentSession().status).toBe(
        REMOTE_SESSION_STATUS.connecting,
      );
      expect(test.participants[0]).toMatchObject({
        joinTicketId: null,
        joinTicketStatus: null,
        joinTicketIssuedAt: null,
      });
      expect(test.livekit.deleteRoom).not.toHaveBeenCalled();
    },
  );

  it('does not fail a healthy call when provisioning advances before the locked stale check', async () => {
    const provisioning = {
      ...participant('FAMILY', IDS.familyParticipant),
      joinTicketId: IDS.familyParticipant,
      joinTicketStatus: 'PROVISIONING',
      joinTicketIssuedAt: new Date(NOW),
    };
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      participants: [provisioning],
      leaseCurrent: 'REMOTE',
    });
    test.transaction.remoteSessionParticipant.findFirst.mockImplementationOnce(
      async () => {
        test.participants[0]!.joinTicketStatus = 'ROOM_READY';
        return null;
      },
    );

    await expect(
      test.service.expireStaleSessions(new Date(NOW.getTime() + 16_000)),
    ).resolves.toEqual({ examined: 1, expired: 0, failed: 0 });

    expect(test.currentSession()).toMatchObject({
      status: REMOTE_SESSION_STATUS.connecting,
      endReason: null,
    });
    expect(test.events).toHaveLength(0);
    expect(test.outbox).toHaveLength(0);
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

  it('does not apply a stale connect timeout after the session becomes ACTIVE', async () => {
    const test = harness({
      status: REMOTE_SESSION_STATUS.connecting,
      leaseCurrent: 'REMOTE',
      activateBeforeConnectTimeoutTermination: true,
    });

    await expect(
      test.service.expireStaleSessions(new Date(NOW.getTime() + 181_000)),
    ).resolves.toEqual({ examined: 1, expired: 0, failed: 0 });

    expect(test.currentSession()).toMatchObject({
      status: REMOTE_SESSION_STATUS.active,
      endReason: null,
    });
    expect(test.livekit.deleteRoom).not.toHaveBeenCalled();
  });

  it('does not fail a ringing call when an AI lease appears between an empty read and failed acquire', async () => {
    const test = harness({
      leaseCurrent: 'NONE',
      leaseAcquired: false,
    });
    test.leases.current.mockResolvedValueOnce(null).mockResolvedValueOnce({
      ownerType: 'AI_COMPANION',
      ownerId: 'ai-session-race-winner',
      leaseId: 'ai-session-race-winner',
    });

    await expect(
      test.service.expireStaleSessions(new Date(NOW.getTime() + 10_000)),
    ).resolves.toEqual({ examined: 1, expired: 0, failed: 0 });

    expect(test.leases.acquire).toHaveBeenCalledTimes(1);
    expect(test.leases.current).toHaveBeenCalledTimes(2);
    expect(test.currentSession()).toMatchObject({
      status: REMOTE_SESSION_STATUS.ringing,
      endReason: null,
    });
  });
});
