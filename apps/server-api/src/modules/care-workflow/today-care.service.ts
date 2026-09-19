import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import type { UserPrincipal } from '../identity/identity.types';
import { CARE_WORKFLOW_CLOCK } from './care-workflow.constants';
import type { CareWorkflowClock } from './ports/care-workflow-clock.port';
import { localDayWindow } from './domain/local-day-window';

@Injectable()
export class TodayCareService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: HouseholdAccessPolicy,
    @Inject(CARE_WORKFLOW_CLOCK) private readonly clock: CareWorkflowClock,
  ) {}

  async read(
    principal: UserPrincipal,
    householdId: string,
    recipientId: string,
  ) {
    return this.prisma.$transaction(
      async (transaction) => {
        await this.policy.requireRecipientAction(
          transaction,
          principal.userId,
          householdId,
          recipientId,
          'VIEW_EVENTS',
        );
        const recipient = await transaction.careRecipient.findFirstOrThrow({
          where: {
            id: recipientId,
            householdId,
            deletedAt: null,
            status: 'ACTIVE',
          },
          select: { timezone: true },
        });
        const now = this.clock.now();
        const { localDate, from, to } = localDayWindow(now, recipient.timezone);
        const where = {
          householdId,
          recipientId,
          scheduledAtUtc: { gte: from, lt: to },
        };
        const select = {
          id: true,
          scheduledAtUtc: true,
          status: true,
          routine: { select: { title: true } },
        } as const;
        const orderBy = [{ scheduledAtUtc: 'asc' }, { id: 'asc' }] as const;
        const [groups, review, pending, openTaskCount] = await Promise.all([
          transaction.routineOccurrence.groupBy({
            by: ['status'],
            where,
            _count: { _all: true },
          }),
          transaction.routineOccurrence.findMany({
            where: { ...where, status: 'NEEDS_FAMILY_REVIEW' },
            select,
            orderBy: [...orderBy],
            take: 5,
          }),
          transaction.routineOccurrence.findMany({
            where: {
              ...where,
              status: { in: ['DUE', 'AWAITING_CONFIRMATION'] },
            },
            select,
            orderBy: [...orderBy],
            take: 5,
          }),
          transaction.familyTask.count({
            where: {
              householdId,
              recipientId,
              status: { in: ['OPEN', 'CLAIMED'] },
            },
          }),
        ]);
        const count = (status: string) =>
          groups.find((group) => group.status === status)?._count._all ?? 0;
        return {
          householdId,
          recipientId,
          localDate,
          timezone: recipient.timezone,
          generatedAt: now.toISOString(),
          counts: {
            total: groups.reduce((sum, group) => sum + group._count._all, 0),
            confirmed: count('CONFIRMED'),
            needsReview: count('NEEDS_FAMILY_REVIEW'),
            pending: count('DUE') + count('AWAITING_CONFIRMATION'),
            expired: count('EXPIRED'),
          },
          openTaskCount,
          items: [...review, ...pending].slice(0, 5).map((item) => ({
            id: item.id,
            title: item.routine.title,
            scheduledAt: item.scheduledAtUtc.toISOString(),
            status: item.status,
          })),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
