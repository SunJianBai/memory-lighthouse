/* eslint-disable @typescript-eslint/only-throw-error */
import { describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '../../infrastructure/database/prisma.service';
import { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import {
  HouseholdAccessDeniedException,
  RecipientAccessDeniedException,
} from '../household/household.errors';
import { HouseholdConsentAccessAdapter } from './adapters/household-consent-access.adapter';
import { ConsentApplicationService } from './consent.application.service';
import { CONSENT_SCOPES } from './consent.constants';
import {
  ConsentDocumentVersionInvalidException,
  IdempotencyConflictException,
  InvalidConsentScopeException,
} from './consent.errors';

// These tests exercise the Module Interface with an in-memory transaction
// Adapter, so construction of the concrete Prisma database Adapter is blocked.
jest.mock('../../infrastructure/database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

type Row = Record<string, any>;

const DOCUMENT_ID = 'consent-document-version-1';
const ASR_DOCUMENT_ID = 'consent-document-version-asr-1';

class ConsentPrismaHarness {
  readonly members: Row[] = [
    {
      id: 'member-owner',
      householdId: 'household-1',
      userId: 'user-owner',
      status: 'ACTIVE',
      roleCodes: ['OWNER'],
    },
  ];
  readonly recipients: Row[] = [
    {
      id: 'recipient-1',
      householdId: 'household-1',
      status: 'ACTIVE',
      deletedAt: null,
    },
    {
      id: 'recipient-2',
      householdId: 'household-2',
      status: 'ACTIVE',
      deletedAt: null,
    },
  ];
  readonly authorities: Row[] = [
    {
      householdId: 'household-1',
      recipientId: 'recipient-1',
      householdMemberId: 'member-owner',
      status: 'ACTIVE',
      canManageProfile: true,
      canManageConsent: true,
    },
  ];
  readonly documents: Row[] = [
    {
      id: DOCUMENT_ID,
      code: 'CAMERA_CAPTURE',
      version: 1,
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
    {
      id: ASR_DOCUMENT_ID,
      code: 'MODEL_INPUT_TRANSCRIPTION',
      version: 1,
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    },
  ];
  readonly states: Row[] = [];
  readonly events: Row[] = [];
  readonly outboxEvents: Row[] = [];
  readonly transactionOptions: Row[] = [];

  readonly householdMember = {
    findFirst: jest.fn(async ({ where }: Row) => {
      const member = this.members.find(
        (candidate) =>
          candidate.householdId === where.householdId &&
          candidate.userId === where.userId &&
          candidate.status === where.status,
      );
      return member
        ? {
            id: member.id,
            householdId: member.householdId,
            userId: member.userId,
            roles: member.roleCodes.map((code: string) => ({ role: { code } })),
          }
        : null;
    }),
  };

  readonly careRecipient = {
    findFirst: jest.fn(
      async ({ where }: Row) =>
        this.recipients.find(
          (candidate) =>
            candidate.id === where.id &&
            candidate.householdId === where.householdId &&
            candidate.status === where.status &&
            candidate.deletedAt === where.deletedAt,
        ) ?? null,
    ),
  };

  readonly recipientMember = {
    findFirst: jest.fn(async ({ where }: Row) => {
      const authority = this.authorities.find(
        (candidate) =>
          candidate.householdId === where.householdId &&
          candidate.recipientId === where.recipientId &&
          candidate.householdMemberId === where.householdMemberId &&
          candidate.status === where.status,
      );
      if (!authority) {
        return null;
      }
      return {
        canManageProfile: authority.canManageProfile,
        canManageConsent: authority.canManageConsent ?? false,
        canManageRoutine: authority.canManageRoutine ?? false,
        canViewEvents: authority.canViewEvents ?? false,
        canViewConversation: authority.canViewConversation ?? false,
        canActivateDevice: authority.canActivateDevice ?? false,
        canRemoteCall: authority.canRemoteCall ?? false,
      };
    }),
  };

  readonly consentDocumentVersion = {
    findUnique: jest.fn(
      async ({ where }: Row) =>
        this.documents.find((document) => document.id === where.id) ?? null,
    ),
  };

  readonly recipientConsentState = {
    findMany: jest.fn(async ({ where }: Row) =>
      this.states
        .filter(
          (state) =>
            state.householdId === where.householdId &&
            state.recipientId === where.recipientId,
        )
        .map((state) => ({
          ...state,
          lastEvent: state.lastEventId
            ? this.enrichEvent(
                this.events.find((event) => event.id === state.lastEventId)!,
              )
            : null,
        })),
    ),
    findUnique: jest.fn(async ({ where }: Row) => {
      const key = where.recipientId_scope;
      return (
        this.states.find(
          (state) =>
            state.recipientId === key.recipientId && state.scope === key.scope,
        ) ?? null
      );
    }),
    upsert: jest.fn(async ({ where, create, update }: Row) => {
      const key = where.recipientId_scope;
      const current = this.states.find(
        (state) =>
          state.recipientId === key.recipientId && state.scope === key.scope,
      );
      if (!current) {
        const inserted = { version: 0, ...create };
        this.states.push(inserted);
        return inserted;
      }
      current.decision = update.decision;
      current.lastEventId = update.lastEventId;
      current.version += update.version.increment;
      return current;
    }),
  };

  readonly recipientConsentEvent = {
    findUnique: jest.fn(async ({ where }: Row) => {
      const event = this.events.find((candidate) => candidate.id === where.id);
      return event ? this.enrichEvent(event) : null;
    }),
    findFirst: jest.fn(async ({ where }: Row) => {
      const event = this.events.find(
        (candidate) =>
          candidate.id === where.id &&
          candidate.householdId === where.householdId &&
          candidate.recipientId === where.recipientId,
      );
      return event ? { id: event.id } : null;
    }),
    findMany: jest.fn(async (query: Row) => {
      let events = this.events
        .filter(
          (event) =>
            event.householdId === query.where.householdId &&
            event.recipientId === query.where.recipientId,
        )
        .sort((left, right) => {
          const time = right.occurredAt.getTime() - left.occurredAt.getTime();
          return time || right.id.localeCompare(left.id);
        });
      if (query.cursor) {
        const cursorIndex = events.findIndex(
          (event) => event.id === query.cursor.id,
        );
        events = cursorIndex < 0 ? [] : events.slice(cursorIndex + query.skip);
      }
      return events
        .slice(0, query.take)
        .map((event) => this.enrichEvent(event));
    }),
    create: jest.fn(async ({ data }: Row) => {
      if (this.events.some((event) => event.id === data.id)) {
        throw { code: 'P2002' };
      }
      const inserted = { ...data };
      this.events.push(inserted);
      return this.enrichEvent(inserted);
    }),
  };

  readonly outboxEvent = {
    create: jest.fn(async ({ data }: Row) => {
      this.outboxEvents.push({ ...data });
      return data;
    }),
  };

  readonly $transaction = jest.fn(
    async (
      work: (transaction: ConsentPrismaHarness) => Promise<unknown>,
      options: Row,
    ) => {
      this.transactionOptions.push(options);
      return work(this);
    },
  );

  private enrichEvent(event: Row): Row {
    return {
      ...event,
      documentVersion: this.documents.find(
        (document) => document.id === event.documentVersionId,
      ),
    };
  }
}

function makeHarness() {
  const prisma = new ConsentPrismaHarness();
  const access = new HouseholdConsentAccessAdapter(new HouseholdAccessPolicy());
  const mediaSecurity = {
    markRecipientRevoked: jest.fn(async () => 0),
    markCompanionConsentRevoked: jest.fn(async () => 0),
    cleanupPendingForRecipient: jest.fn(async () => undefined),
    cleanupCompanionLeasesForRecipient: jest.fn(async () => undefined),
  };
  const consent = new ConsentApplicationService(
    prisma as unknown as PrismaService,
    access,
    mediaSecurity as never,
  );
  const command = {
    userId: 'user-owner',
    householdId: 'household-1',
    recipientId: 'recipient-1',
    scope: 'CAMERA_CAPTURE' as const,
    documentVersionId: DOCUMENT_ID,
    reason: '陪伴端提供视频能力',
    idempotencyKey: 'grant-camera-0001',
  };
  return { prisma, consent, command, mediaSecurity };
}

describe('ConsentApplicationService', () => {
  it('renders an empty projection as eight explicit, not-granted scopes', async () => {
    const { consent } = makeHarness();

    const result = await consent.listConsents(
      'user-owner',
      'household-1',
      'recipient-1',
    );
    const history = await consent.listConsentEvents({
      userId: 'user-owner',
      householdId: 'household-1',
      recipientId: 'recipient-1',
    });

    expect(result.map(({ scope }) => scope)).toEqual(CONSENT_SCOPES);
    expect(result).toHaveLength(8);
    expect(result.every(({ granted }) => !granted)).toBe(true);
    expect(result.every(({ decision }) => decision === 'NOT_GRANTED')).toBe(
      true,
    );
    expect(history).toEqual({ items: [], nextCursor: null });
  });

  it('grants in a Serializable transaction and replays one idempotent event', async () => {
    const { consent, command, prisma } = makeHarness();

    const first = await consent.grantConsent(command);
    const replay = await consent.grantConsent(command);

    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      scope: 'CAMERA_CAPTURE',
      decision: 'GRANTED',
      decidedByMemberId: 'member-owner',
      reason: '陪伴端提供视频能力',
    });
    expect(prisma.events).toHaveLength(1);
    expect(prisma.states).toHaveLength(1);
    expect(prisma.outboxEvents).toHaveLength(1);
    expect(prisma.transactionOptions).toEqual([
      { isolationLevel: 'Serializable' },
      { isolationLevel: 'Serializable' },
    ]);
  });

  it('revokes immediately, appends immutable history, and supersedes the grant', async () => {
    const { consent, command, prisma } = makeHarness();
    const grant = await consent.grantConsent(command);

    const revoke = await consent.revokeConsent({
      ...command,
      reason: '长者要求停止摄像头',
      idempotencyKey: 'revoke-camera-0001',
    });
    const states = await consent.listConsents(
      command.userId,
      command.householdId,
      command.recipientId,
    );

    expect(revoke).toMatchObject({
      decision: 'REVOKED',
      supersedesEventId: grant.id,
      reason: '长者要求停止摄像头',
    });
    expect(prisma.events).toHaveLength(2);
    expect(prisma.events[0]).toMatchObject({ decision: 'GRANTED' });
    expect(prisma.events[1]).toMatchObject({ decision: 'REVOKED' });
    expect(
      states.find(({ scope }) => scope === 'CAMERA_CAPTURE'),
    ).toMatchObject({ granted: false, decision: 'REVOKED' });
    expect(prisma.outboxEvents.at(-1)).toMatchObject({
      eventType: 'consent.revoked',
      payloadJson: { scope: 'CAMERA_CAPTURE' },
    });
  });

  it('does not let an old revoke replay terminate media created after a later grant', async () => {
    const { consent, command, prisma, mediaSecurity } = makeHarness();
    await consent.grantConsent(command);
    const revokeCommand = {
      ...command,
      reason: '长者暂时停止摄像头',
      idempotencyKey: 'revoke-camera-replay-0001',
    };
    const revoked = await consent.revokeConsent(revokeCommand);
    await consent.grantConsent({
      ...command,
      reason: '长者重新允许摄像头',
      idempotencyKey: 'grant-camera-after-revoke-0001',
    });
    mediaSecurity.markCompanionConsentRevoked.mockClear();
    mediaSecurity.cleanupCompanionLeasesForRecipient.mockClear();

    await expect(consent.revokeConsent(revokeCommand)).resolves.toEqual(
      revoked,
    );

    expect(mediaSecurity.markCompanionConsentRevoked).not.toHaveBeenCalled();
    expect(
      mediaSecurity.cleanupCompanionLeasesForRecipient,
    ).toHaveBeenCalledTimes(1);
    expect(prisma.events).toHaveLength(3);
    expect(
      prisma.states.find((state) => state.scope === command.scope)?.decision,
    ).toBe('GRANTED');
  });

  it('rejects a caregiver without the mapped canManageConsent capability', async () => {
    const { consent, command, prisma } = makeHarness();
    prisma.members.push({
      id: 'member-caregiver',
      householdId: 'household-1',
      userId: 'user-caregiver',
      status: 'ACTIVE',
      roleCodes: ['CAREGIVER'],
    });
    prisma.authorities.push({
      householdId: 'household-1',
      recipientId: 'recipient-1',
      householdMemberId: 'member-caregiver',
      status: 'ACTIVE',
      canManageProfile: false,
      canManageConsent: false,
    });

    await expect(
      consent.grantConsent({ ...command, userId: 'user-caregiver' }),
    ).rejects.toBeInstanceOf(RecipientAccessDeniedException);
    expect(prisma.events).toHaveLength(0);
  });

  it('rejects both a cross-household recipient and a missing household membership', async () => {
    const { consent, command, prisma } = makeHarness();

    await expect(
      consent.grantConsent({ ...command, recipientId: 'recipient-2' }),
    ).rejects.toBeInstanceOf(RecipientAccessDeniedException);
    await expect(
      consent.grantConsent({
        ...command,
        householdId: 'household-2',
        recipientId: 'recipient-2',
      }),
    ).rejects.toBeInstanceOf(HouseholdAccessDeniedException);
    expect(prisma.events).toHaveLength(0);
  });

  it('keeps model-input transcription independent from microphone and model consent', async () => {
    const { consent, command } = makeHarness();
    await consent.grantConsent({
      ...command,
      scope: 'MODEL_INPUT_TRANSCRIPTION',
      documentVersionId: ASR_DOCUMENT_ID,
      reason: '单独验证 ASR 能力',
      idempotencyKey: 'grant-asr-000001',
    });

    const states = await consent.listConsents(
      command.userId,
      command.householdId,
      command.recipientId,
    );
    const decisions = Object.fromEntries(
      states.map(({ scope, granted }) => [scope, granted]),
    );

    expect(decisions.MODEL_INPUT_TRANSCRIPTION).toBe(true);
    expect(decisions.MICROPHONE_CAPTURE).toBe(false);
    expect(decisions.MODEL_PROCESSING).toBe(false);
  });

  it('rejects grant and revoke when the document belongs to another scope', async () => {
    const { consent, command, prisma } = makeHarness();

    await expect(
      consent.grantConsent({
        ...command,
        documentVersionId: ASR_DOCUMENT_ID,
      }),
    ).rejects.toBeInstanceOf(ConsentDocumentVersionInvalidException);
    await expect(
      consent.revokeConsent({
        ...command,
        documentVersionId: ASR_DOCUMENT_ID,
        idempotencyKey: 'revoke-wrong-document-0001',
      }),
    ).rejects.toBeInstanceOf(ConsentDocumentVersionInvalidException);

    expect(prisma.events).toHaveLength(0);
    expect(prisma.states).toHaveLength(0);
    expect(prisma.outboxEvents).toHaveLength(0);
  });

  it('does not accept recording or remote-call transcription scopes', async () => {
    const { consent, command, prisma } = makeHarness();

    await expect(
      consent.grantConsent({
        ...command,
        scope: 'REMOTE_ASSISTANCE_RECORDING',
      }),
    ).rejects.toBeInstanceOf(InvalidConsentScopeException);
    expect(prisma.events).toHaveLength(0);
  });

  it('rejects reusing an idempotency key for a different decision', async () => {
    const { consent, command, prisma } = makeHarness();
    await consent.grantConsent(command);

    await expect(consent.revokeConsent(command)).rejects.toBeInstanceOf(
      IdempotencyConflictException,
    );
    expect(prisma.events).toHaveLength(1);
  });
});
