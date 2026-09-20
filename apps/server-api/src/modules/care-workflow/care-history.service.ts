import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import type { UserPrincipal } from '../identity/identity.types';
import {
  CARE_WORKFLOW_CLOCK,
  CARE_WORKFLOW_CONTENT_CIPHER,
} from './care-workflow.constants';
import { careEventView, occurrenceView } from './care-record.projection';
import {
  careHistoryWindow,
  type CareHistoryKind,
  type CareHistoryQuery,
} from './domain/care-history-query';
import type { CareWorkflowClock } from './ports/care-workflow-clock.port';
import type { CareWorkflowContentCipher } from './ports/content-cipher.port';

/** Bounded read path; every page reauthorizes and decrypts only its returned records. */
@Injectable()
export class CareHistoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: HouseholdAccessPolicy,
    @Inject(CARE_WORKFLOW_CLOCK) private readonly clock: CareWorkflowClock,
    @Inject(CARE_WORKFLOW_CONTENT_CIPHER)
    private readonly cipher: CareWorkflowContentCipher,
  ) {}

  read(
    principal: UserPrincipal,
    householdId: string,
    recipientId: string,
    kind: CareHistoryKind,
    query: CareHistoryQuery,
  ) {
    return this.prisma.$transaction(
      async (tx) => {
        await this.policy.requireRecipientAction(
          tx,
          principal.userId,
          householdId,
          recipientId,
          'VIEW_EVENTS',
        );
        const { timezone } = await tx.careRecipient.findFirstOrThrow({
          where: {
            id: recipientId,
            householdId,
            deletedAt: null,
            status: 'ACTIVE',
          },
          select: { timezone: true },
        });
        const page = careHistoryWindow(
          kind,
          householdId,
          recipientId,
          timezone,
          query,
          this.clock.now(),
          this.cipher,
        );
        const timeRange =
          page.from && page.to ? { gte: page.from, lt: page.to } : undefined;
        const meta = {
          timezone,
          from: page.from?.toISOString() ?? null,
          to: page.to?.toISOString() ?? null,
        };
        if (kind === 'occurrences') {
          const records = await tx.routineOccurrence.findMany({
            where: {
              householdId,
              recipientId,
              ...(query.status ? { status: query.status } : {}),
              ...(timeRange ? { scheduledAtUtc: timeRange } : {}),
              ...(page.after
                ? {
                    OR: [
                      { scheduledAtUtc: { lt: page.after.at } },
                      {
                        scheduledAtUtc: page.after.at,
                        id: { lt: page.after.id },
                      },
                    ],
                  }
                : {}),
            },
            include: { routine: true },
            orderBy: [{ scheduledAtUtc: 'desc' }, { id: 'desc' }],
            take: page.limit + 1,
          });
          const visible = records.slice(0, page.limit);
          const last = visible.at(-1);
          return {
            ...meta,
            items: visible.map((record) => occurrenceView(this.cipher, record)),
            nextCursor:
              records.length > page.limit && last
                ? page.nextCursor(last.scheduledAtUtc, last.id)
                : null,
          };
        }
        const records = await tx.careEvent.findMany({
          where: {
            householdId,
            recipientId,
            ...(timeRange ? { occurredAt: timeRange } : {}),
            ...(page.after
              ? {
                  OR: [
                    { occurredAt: { lt: page.after.at } },
                    { occurredAt: page.after.at, id: { lt: page.after.id } },
                  ],
                }
              : {}),
          },
          orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
          take: page.limit + 1,
        });
        const visible = records.slice(0, page.limit);
        const last = visible.at(-1);
        return {
          ...meta,
          items: visible.map((record) => careEventView(this.cipher, record)),
          nextCursor:
            records.length > page.limit && last
              ? page.nextCursor(last.occurredAt, last.id)
              : null,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
