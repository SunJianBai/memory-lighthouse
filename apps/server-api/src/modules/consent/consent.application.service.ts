import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { ulid } from 'ulid';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { Prisma } from '../../infrastructure/database/generated/prisma/client';
import {
  CONSENT_ACCESS_PORT,
  CONSENT_DECISIONS,
  CONSENT_EVENT_PAGE_DEFAULT,
  CONSENT_EVENT_PAGE_MAX,
  CONSENT_SCOPES,
  type ConsentScope,
  type PersistedConsentDecision,
} from './consent.constants';
import {
  ConsentDocumentVersionInvalidException,
  ConsentWriteConflictException,
  IdempotencyConflictException,
  IdempotencyKeyRequiredException,
  InvalidConsentEventCursorException,
  InvalidConsentScopeException,
} from './consent.errors';
import type {
  ConsentEventPage,
  ConsentEventView,
  ConsentStateView,
  DecideConsentCommand,
  ListConsentEventsQuery,
} from './consent.types';
import type { ConsentAccessPort } from './ports/consent-access.port';

interface ConsentDocumentRecord {
  id: string;
  code: string;
  version: number;
  publishedAt: Date;
}

interface ConsentEventRecord {
  id: string;
  householdId: string;
  recipientId: string;
  scope: string;
  decision: string;
  documentVersionId: string;
  decidedByMemberId: string;
  reason: string | null;
  supersedesEventId: string | null;
  occurredAt: Date;
  documentVersion: ConsentDocumentRecord;
}

interface ConsentStateRecord {
  scope: string;
  decision: string;
  version: number;
  lastEvent: ConsentEventRecord | null;
}

const IDEMPOTENCY_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SERIALIZABLE_RETRY_LIMIT = 3;

@Injectable()
export class ConsentApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CONSENT_ACCESS_PORT)
    private readonly access: ConsentAccessPort,
  ) {}

  async listConsents(
    userId: string,
    householdId: string,
    recipientId: string,
  ): Promise<ConsentStateView[]> {
    await this.access.requireCanReadConsent(
      this.prisma,
      userId,
      householdId,
      recipientId,
    );
    const states = (await this.prisma.recipientConsentState.findMany({
      where: { householdId, recipientId },
      include: { lastEvent: { include: { documentVersion: true } } },
    })) as ConsentStateRecord[];
    const byScope = new Map(states.map((state) => [state.scope, state]));

    // Missing rows are intentionally rendered as NOT_GRANTED. The database is
    // sparse, while the Interface always exposes the complete allowlist.
    return CONSENT_SCOPES.map((scope) => {
      const state = byScope.get(scope);
      if (!state?.lastEvent) {
        return {
          scope,
          granted: false,
          decision: CONSENT_DECISIONS.notGranted,
          lastEvent: null,
          version: 0,
        };
      }
      return {
        scope,
        granted: state.decision === CONSENT_DECISIONS.granted,
        decision: this.requirePersistedDecision(state.decision),
        lastEvent: this.toEventView(state.lastEvent),
        version: state.version,
      };
    });
  }

  grantConsent(command: DecideConsentCommand): Promise<ConsentEventView> {
    return this.decideConsent(command, CONSENT_DECISIONS.granted);
  }

  revokeConsent(command: DecideConsentCommand): Promise<ConsentEventView> {
    return this.decideConsent(command, CONSENT_DECISIONS.revoked);
  }

  async listConsentEvents(
    query: ListConsentEventsQuery,
  ): Promise<ConsentEventPage> {
    await this.access.requireCanReadConsent(
      this.prisma,
      query.userId,
      query.householdId,
      query.recipientId,
    );
    const limit = Math.min(
      Math.max(query.limit ?? CONSENT_EVENT_PAGE_DEFAULT, 1),
      CONSENT_EVENT_PAGE_MAX,
    );

    if (query.cursor) {
      const cursor = await this.prisma.recipientConsentEvent.findFirst({
        where: {
          id: query.cursor,
          householdId: query.householdId,
          recipientId: query.recipientId,
        },
        select: { id: true },
      });
      if (!cursor) {
        throw new InvalidConsentEventCursorException();
      }
    }

    const events = (await this.prisma.recipientConsentEvent.findMany({
      where: {
        householdId: query.householdId,
        recipientId: query.recipientId,
      },
      include: { documentVersion: true },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })) as ConsentEventRecord[];
    const hasNextPage = events.length > limit;
    const page = hasNextPage ? events.slice(0, limit) : events;

    return {
      items: page.map((event) => this.toEventView(event)),
      nextCursor: hasNextPage ? (page.at(-1)?.id ?? null) : null,
    };
  }

  private async decideConsent(
    command: DecideConsentCommand,
    decision: PersistedConsentDecision,
  ): Promise<ConsentEventView> {
    const scope = this.requireScope(command.scope);
    const idempotencyKey = this.requireIdempotencyKey(command.idempotencyKey);
    const documentVersionId = command.documentVersionId.trim();
    if (!documentVersionId) {
      throw new ConsentDocumentVersionInvalidException();
    }
    const reason = command.reason?.trim() || null;
    const eventId = this.idempotentEventId(command, idempotencyKey);

    for (let attempt = 1; attempt <= SERIALIZABLE_RETRY_LIMIT; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (transaction) => {
            const actor = await this.access.requireCanManageConsent(
              transaction,
              command.userId,
              command.householdId,
              command.recipientId,
            );
            const now = new Date();
            const replay = (await transaction.recipientConsentEvent.findUnique({
              where: { id: eventId },
              include: { documentVersion: true },
            })) as ConsentEventRecord | null;
            if (replay) {
              this.assertIdempotentReplay(replay, {
                ...command,
                scope,
                documentVersionId,
                reason,
                memberId: actor.memberId,
                decision,
              });
              this.requireDocumentVersionForScope(
                replay.documentVersion,
                scope,
                now,
              );
              return this.toEventView(replay);
            }

            this.requireDocumentVersionForScope(
              await transaction.consentDocumentVersion.findUnique({
                where: { id: documentVersionId },
              }),
              scope,
              now,
            );

            const current = await transaction.recipientConsentState.findUnique({
              where: {
                recipientId_scope: { recipientId: command.recipientId, scope },
              },
              select: { lastEventId: true },
            });
            const event = (await transaction.recipientConsentEvent.create({
              data: {
                id: eventId,
                householdId: command.householdId,
                recipientId: command.recipientId,
                scope,
                decision,
                documentVersionId,
                decidedByMemberId: actor.memberId,
                reason,
                supersedesEventId: current?.lastEventId ?? null,
                occurredAt: now,
              },
              include: { documentVersion: true },
            })) as ConsentEventRecord;

            await transaction.recipientConsentState.upsert({
              where: {
                recipientId_scope: { recipientId: command.recipientId, scope },
              },
              create: {
                id: ulid(now.getTime()),
                householdId: command.householdId,
                recipientId: command.recipientId,
                scope,
                decision,
                lastEventId: event.id,
              },
              update: {
                decision,
                lastEventId: event.id,
                version: { increment: 1 },
              },
            });
            await transaction.outboxEvent.create({
              data: {
                id: ulid(now.getTime()),
                aggregateType: 'CONSENT',
                aggregateId: event.id,
                eventType:
                  decision === CONSENT_DECISIONS.revoked
                    ? 'consent.revoked'
                    : 'consent.granted',
                payloadJson: {
                  householdId: command.householdId,
                  recipientId: command.recipientId,
                  scope,
                  consentEventId: event.id,
                },
                occurredAt: now,
                availableAt: now,
              },
            });

            return this.toEventView(event);
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        if (
          this.isRetryableWriteConflict(error) &&
          attempt < SERIALIZABLE_RETRY_LIMIT
        ) {
          continue;
        }
        if (this.isRetryableWriteConflict(error)) {
          throw new ConsentWriteConflictException();
        }
        throw error;
      }
    }

    throw new ConsentWriteConflictException();
  }

  private requireScope(candidate: string): ConsentScope {
    if (!(CONSENT_SCOPES as readonly string[]).includes(candidate)) {
      throw new InvalidConsentScopeException();
    }
    return candidate as ConsentScope;
  }

  private requireDocumentVersionForScope(
    documentVersion: ConsentDocumentRecord | null,
    scope: ConsentScope,
    now: Date,
  ): ConsentDocumentRecord {
    if (
      !documentVersion ||
      documentVersion.code !== scope ||
      documentVersion.publishedAt > now
    ) {
      throw new ConsentDocumentVersionInvalidException();
    }

    return documentVersion;
  }

  private requireIdempotencyKey(candidate: string): string {
    const normalized = candidate.trim();
    if (normalized.length < 8 || normalized.length > 128) {
      throw new IdempotencyKeyRequiredException();
    }
    return normalized;
  }

  private idempotentEventId(
    command: DecideConsentCommand,
    idempotencyKey: string,
  ): string {
    const digest = createHash('sha256')
      .update('memory-lighthouse:consent-event:v1\0')
      .update(command.userId)
      .update('\0')
      .update(command.householdId)
      .update('\0')
      .update(command.recipientId)
      .update('\0')
      .update(idempotencyKey)
      .digest()
      .subarray(0, 16);
    let value = 0n;
    for (const byte of digest) {
      value = (value << 8n) | BigInt(byte);
    }
    let encoded = '';
    for (let index = 0; index < 26; index += 1) {
      encoded = IDEMPOTENCY_ALPHABET[Number(value & 31n)] + encoded;
      value >>= 5n;
    }
    return encoded;
  }

  private assertIdempotentReplay(
    event: ConsentEventRecord,
    expected: {
      householdId: string;
      recipientId: string;
      scope: ConsentScope;
      documentVersionId: string;
      reason: string | null;
      memberId: string;
      decision: PersistedConsentDecision;
    },
  ): void {
    if (
      event.householdId !== expected.householdId ||
      event.recipientId !== expected.recipientId ||
      event.scope !== expected.scope ||
      event.decision !== expected.decision ||
      event.documentVersionId !== expected.documentVersionId ||
      event.decidedByMemberId !== expected.memberId ||
      event.reason !== expected.reason
    ) {
      throw new IdempotencyConflictException();
    }
  }

  private requirePersistedDecision(value: string): PersistedConsentDecision {
    if (
      value !== CONSENT_DECISIONS.granted &&
      value !== CONSENT_DECISIONS.revoked
    ) {
      // A malformed projection must never be interpreted as authorization.
      return CONSENT_DECISIONS.revoked;
    }
    return value;
  }

  private toEventView(event: ConsentEventRecord): ConsentEventView {
    return {
      id: event.id,
      householdId: event.householdId,
      recipientId: event.recipientId,
      scope: this.requireScope(event.scope),
      decision: this.requirePersistedDecision(event.decision),
      documentVersion: {
        id: event.documentVersion.id,
        code: event.documentVersion.code,
        version: event.documentVersion.version,
        publishedAt: event.documentVersion.publishedAt.toISOString(),
      },
      decidedByMemberId: event.decidedByMemberId,
      reason: event.reason,
      supersedesEventId: event.supersedesEventId,
      occurredAt: event.occurredAt.toISOString(),
    };
  }

  private isRetryableWriteConflict(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error.code === 'P2002' || error.code === 'P2034')
    );
  }
}
