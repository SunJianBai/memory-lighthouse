import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import type { UserPrincipal } from '../identity/identity.types';
import { CARE_WORKFLOW_CONTENT_CIPHER } from './care-workflow.constants';
import type { CareWorkflowContentCipher } from './ports/content-cipher.port';

/** A recipient-authorized read projection. Commands remain in the existing workflow. */
@Injectable()
export class FamilyTaskBoardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: HouseholdAccessPolicy,
    @Inject(CARE_WORKFLOW_CONTENT_CIPHER)
    private readonly cipher: CareWorkflowContentCipher,
  ) {}

  read(principal: UserPrincipal, householdId: string, recipientId: string) {
    return this.prisma.$transaction(
      async (tx) => {
        const viewer = await this.policy.requireRecipientAction(
          tx,
          principal.userId,
          householdId,
          recipientId,
          'VIEW_EVENTS',
        );
        const tasks = await tx.familyTask.findMany({
          where: { householdId, recipientId },
          orderBy: [{ dueAt: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }],
          include: {
            sourceEvent: {
              select: {
                householdId: true,
                recipientId: true,
                titleCiphertext: true,
                summaryCiphertext: true,
                contentNonce: true,
                encryptionKeyId: true,
              },
            },
          },
        });
        const assigneeIds = [
          ...new Set(
            tasks.flatMap((task) =>
              task.assigneeMemberId ? [task.assigneeMemberId] : [],
            ),
          ),
        ];
        const members = assigneeIds.length
          ? await tx.householdMember.findMany({
              where: {
                householdId,
                id: { in: assigneeIds },
                status: 'ACTIVE',
                user: { status: 'ACTIVE', deletedAt: null },
              },
              select: { id: true, user: { select: { displayName: true } } },
            })
          : [];
        const names = new Map(
          members.map((member) => [member.id, member.user.displayName]),
        );
        return {
          householdId,
          recipientId,
          tasks: tasks.map((task) => {
            const source = task.sourceEvent;
            // Foreign-key presence alone does not prove that an event shares the task's scope.
            if (
              source.householdId !== householdId ||
              source.recipientId !== recipientId
            ) {
              throw new Error('Task source scope does not match');
            }
            const content: unknown = JSON.parse(
              this.cipher.decrypt({
                ciphertext: Buffer.concat([
                  Buffer.from(source.titleCiphertext),
                  Buffer.from(source.summaryCiphertext),
                ]),
                nonce: Buffer.from(source.contentNonce),
                encryptionKeyId: source.encryptionKeyId,
              }),
            );
            if (
              !Array.isArray(content) ||
              content.length !== 2 ||
              !content.every((part) => typeof part === 'string')
            ) {
              throw new Error('Protected task source content is invalid');
            }
            const assignedToMe = task.assigneeMemberId === viewer.id;
            const unfinished =
              task.status === 'OPEN' || task.status === 'CLAIMED';
            const resolutionNote =
              task.resolutionNoteCiphertext &&
              task.resolutionNoteNonce &&
              task.encryptionKeyId
                ? this.cipher.decrypt({
                    ciphertext: Buffer.from(task.resolutionNoteCiphertext),
                    nonce: Buffer.from(task.resolutionNoteNonce),
                    encryptionKeyId: task.encryptionKeyId,
                  })
                : null;
            return {
              id: task.id,
              householdId,
              recipientId,
              sourceEventId: task.sourceEventId,
              assigneeMemberId: task.assigneeMemberId,
              status: task.status,
              priority: task.priority,
              dueAt: task.dueAt?.toISOString() ?? null,
              resolvedAt: task.resolvedAt?.toISOString() ?? null,
              resolutionCode: task.resolutionCode,
              resolutionNote,
              createdAt: task.createdAt.toISOString(),
              updatedAt: task.updatedAt.toISOString(),
              version: task.version,
              sourceTitle: content[0],
              sourceSummary: content[1],
              assigneeDisplayName: task.assigneeMemberId
                ? names.get(task.assigneeMemberId)?.trim() || '原家庭成员'
                : null,
              assignedToMe,
              canClaim: task.status === 'OPEN' && !task.assigneeMemberId,
              canFinish: unfinished && (!task.assigneeMemberId || assignedToMe),
            };
          }),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
