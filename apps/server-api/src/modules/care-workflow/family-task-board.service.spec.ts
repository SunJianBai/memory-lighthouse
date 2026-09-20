import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import type { HouseholdApplicationService } from '../household/household.application.service';
import type { UserPrincipal } from '../identity/identity.types';
import { FamilyTaskBoardService } from './family-task-board.service';

const principal = { userId: 'user' } as UserPrincipal;
function task(status = 'OPEN', assigneeMemberId: string | null = null) {
  return {
    id: 'task',
    householdId: 'home',
    recipientId: 'elder',
    sourceEventId: 'event',
    status,
    assigneeMemberId,
    priority: 'NORMAL',
    dueAt: null,
    resolvedAt: null,
    resolutionCode: null,
    resolutionNoteCiphertext: null,
    resolutionNoteNonce: null,
    encryptionKeyId: null,
    createdAt: new Date('2026-09-01'),
    updatedAt: new Date('2026-09-01'),
    version: 0,
    sourceEvent: {
      householdId: 'home',
      recipientId: 'elder',
      titleCiphertext: Buffer.from('first'),
      summaryCiphertext: Buffer.from('second'),
      contentNonce: Buffer.from('nonce'),
      encryptionKeyId: 'test',
    },
  };
}
function harness() {
  const tx = {
    familyTask: { findMany: jest.fn().mockResolvedValue([task()]) },
  };
  const prisma = {
    $transaction: jest.fn((read: (db: typeof tx) => unknown) => read(tx)),
  };
  const policy = {
    requireRecipientAction: jest.fn().mockResolvedValue({ id: 'me' }),
  };
  const cipher = {
    encrypt: jest.fn(),
    decrypt: jest.fn().mockReturnValue('["需要联系家属","请核对长者的请求"]'),
  };
  const households = {
    readTaskAssigneeNames: jest
      .fn()
      .mockResolvedValue(new Map([['other', '测试家属']])),
  };
  const service = new FamilyTaskBoardService(
    prisma as unknown as PrismaService,
    policy as unknown as HouseholdAccessPolicy,
    households as unknown as HouseholdApplicationService,
    cipher,
  );
  return { tx, prisma, policy, households, cipher, service };
}
describe('FamilyTaskBoardService', () => {
  it('authorizes before reading tasks, names or decrypting content', async () => {
    const h = harness();
    h.policy.requireRecipientAction.mockRejectedValue(new ForbiddenException());
    await expect(h.service.read(principal, 'home', 'elder')).rejects.toThrow(
      ForbiddenException,
    );
    expect(h.tx.familyTask.findMany).not.toHaveBeenCalled();
    expect(h.households.readTaskAssigneeNames).not.toHaveBeenCalled();
    expect(h.cipher.decrypt).not.toHaveBeenCalled();
  });
  it('reads only the selected household and recipient in one repeatable snapshot', async () => {
    const h = harness();
    const result = await h.service.read(principal, 'home', 'elder');
    expect(h.policy.requireRecipientAction).toHaveBeenCalledWith(
      h.tx,
      'user',
      'home',
      'elder',
      'VIEW_EVENTS',
    );
    expect(h.tx.familyTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { householdId: 'home', recipientId: 'elder' },
      }),
    );
    expect(h.prisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: 'RepeatableRead',
    });
    expect(result.tasks[0]).toMatchObject({
      sourceTitle: '需要联系家属',
      assigneeDisplayName: null,
      canClaim: true,
      canFinish: true,
    });
  });
  it('returns truthful ownership and operations for all task states', async () => {
    const h = harness();
    h.tx.familyTask.findMany.mockResolvedValue([
      task('OPEN'),
      task('CLAIMED', 'me'),
      task('CLAIMED', 'other'),
      task('RESOLVED', 'me'),
      task('DISMISSED', 'other'),
    ]);
    const { tasks } = await h.service.read(principal, 'home', 'elder');
    expect(
      tasks.map(({ canClaim, canFinish, assignedToMe }) => [
        canClaim,
        canFinish,
        assignedToMe,
      ]),
    ).toEqual([
      [true, true, false],
      [false, true, true],
      [false, false, false],
      [false, false, true],
      [false, false, false],
    ]);
    expect(tasks[2].assigneeDisplayName).toBe('测试家属');
  });
  it('batch-resolves only active names in the same household and safely labels former members', async () => {
    const h = harness();
    h.tx.familyTask.findMany.mockResolvedValue([
      task('CLAIMED', 'left'),
      task('CLAIMED', 'left'),
    ]);
    h.households.readTaskAssigneeNames.mockResolvedValue(new Map());
    const { tasks } = await h.service.read(principal, 'home', 'elder');
    expect(h.households.readTaskAssigneeNames).toHaveBeenCalledTimes(1);
    expect(h.households.readTaskAssigneeNames).toHaveBeenCalledWith(
      h.tx,
      principal,
      'home',
      'elder',
      ['left'],
    );
    expect(tasks[0]).toMatchObject({
      assigneeDisplayName: '原家庭成员',
      canFinish: false,
    });
  });
  it('never decrypts a source event from another recipient', async () => {
    const h = harness();
    h.tx.familyTask.findMany.mockResolvedValue([
      {
        ...task(),
        sourceEvent: { ...task().sourceEvent, recipientId: 'foreign' },
      },
    ]);
    await expect(h.service.read(principal, 'home', 'elder')).rejects.toThrow(
      'scope',
    );
    expect(h.cipher.decrypt).not.toHaveBeenCalled();
  });
  it('rejects invalid encrypted pairs instead of silently hiding tasks', async () => {
    const h = harness();
    h.cipher.decrypt.mockReturnValue('["only one value"]');
    await expect(h.service.read(principal, 'home', 'elder')).rejects.toThrow(
      'invalid',
    );
  });
});
