/* Test doubles implement promise-based ports without real asynchronous work. */

import { describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import { HouseholdAccessDeniedException } from '../household/household.errors';
import type { UserPrincipal } from '../identity/identity.types';
import { AesGcmDataEncryptionAdapter } from './crypto/aes-gcm-data-encryption.adapter';
import { MemoryApplicationService } from './memory.application.service';
import { MemoryVersionConflictException } from './memory.errors';

interface MemoryStateRow {
  id: string;
  householdId: string;
  recipientId: string;
  kind: string;
  title: string;
  sensitivity: string;
  verificationStatus: string;
  status: string;
  currentRevisionNo: number;
  createdByMemberId: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

interface RevisionStateRow {
  id: string;
  memoryId: string;
  revisionNo: number;
  contentCiphertext: Uint8Array;
  contentNonce: Uint8Array;
  encryptionKeyId: string;
  contentHash: Uint8Array;
  source: string;
  changeReason: string | null;
  createdByMemberId: string;
  createdAt: Date;
}

interface MemoryFakeState {
  memories: MemoryStateRow[];
  revisions: RevisionStateRow[];
  findFirstCalls: number;
}

interface FindMemoryArgs {
  where: {
    id?: string;
    householdId?: string;
    recipientId?: string;
    deletedAt?: null;
    version?: number;
  };
  include?: { revisions?: { take?: number } };
}

function createMemoryPrisma(): {
  prisma: PrismaService;
  state: MemoryFakeState;
} {
  const state: MemoryFakeState = {
    memories: [],
    revisions: [],
    findFirstCalls: 0,
  };

  const withRevisions = (
    row: MemoryStateRow,
    take?: number,
  ): MemoryStateRow & { revisions: RevisionStateRow[] } => {
    const revisions = state.revisions
      .filter((revision) => revision.memoryId === row.id)
      .sort((left, right) => right.revisionNo - left.revisionNo);
    return { ...row, revisions: take ? revisions.slice(0, take) : revisions };
  };
  const matches = (
    row: MemoryStateRow,
    where: FindMemoryArgs['where'],
  ): boolean =>
    (where.id === undefined || row.id === where.id) &&
    (where.householdId === undefined ||
      row.householdId === where.householdId) &&
    (where.recipientId === undefined ||
      row.recipientId === where.recipientId) &&
    (where.deletedAt !== null || row.deletedAt === null) &&
    (where.version === undefined || row.version === where.version);

  const raw = {
    memory: {
      create: jest.fn(
        async ({
          data,
        }: {
          data: Omit<MemoryStateRow, 'deletedAt' | 'version'>;
        }) => {
          const row: MemoryStateRow = { ...data, deletedAt: null, version: 0 };
          state.memories.push(row);
          return { ...row };
        },
      ),
      findFirst: jest.fn(async (args: FindMemoryArgs) => {
        state.findFirstCalls += 1;
        const row = state.memories.find((candidate) =>
          matches(candidate, args.where),
        );
        return row ? withRevisions(row, args.include?.revisions?.take) : null;
      }),
      findMany: jest.fn(async () => []),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: FindMemoryArgs['where'];
          data: Record<string, unknown>;
        }) => {
          const row = state.memories.find((candidate) =>
            matches(candidate, where),
          );
          if (!row) return { count: 0 };
          for (const [key, value] of Object.entries(data)) {
            if (key === 'version') {
              row.version += 1;
            } else if (key in row) {
              Object.assign(row, { [key]: value });
            }
          }
          return { count: 1 };
        },
      ),
    },
    memoryRevision: {
      create: jest.fn(async ({ data }: { data: RevisionStateRow }) => {
        state.revisions.push({ ...data });
        return data;
      }),
    },
  };
  const prisma = {
    ...raw,
    $transaction: jest.fn(
      async (work: (transaction: typeof raw) => Promise<unknown>) => work(raw),
    ),
  } as unknown as PrismaService;
  return { prisma, state };
}

describe('MemoryApplicationService', () => {
  const principal: UserPrincipal = {
    kind: 'USER',
    userId: '01USER00000000000000000000',
    sessionId: '01SESSION00000000000000000',
    tokenId: '01TOKEN0000000000000000000',
    status: 'ACTIVE',
  };
  const householdId = '01HOUSEHOLD000000000000000';
  const recipientId = '01RECIPIENT000000000000000';

  function setup() {
    const { prisma, state } = createMemoryPrisma();
    const policy = {
      requireHouseholdAction: jest.fn(
        async (
          _client: unknown,
          _userId: string,
          requestedHousehold: string,
        ) => {
          if (requestedHousehold !== householdId) {
            throw new HouseholdAccessDeniedException();
          }
          return { id: '01MEMBER0000000000000000000' };
        },
      ),
      requireRecipientAction: jest.fn(
        async (
          _client: unknown,
          _userId: string,
          requestedHousehold: string,
          requestedRecipient: string,
        ) => {
          if (
            requestedHousehold !== householdId ||
            requestedRecipient !== recipientId
          ) {
            throw new HouseholdAccessDeniedException();
          }
          return {
            id: '01MEMBER0000000000000000000',
            householdId,
            userId: principal.userId,
            roleCodes: ['OWNER'],
          };
        },
      ),
    } as unknown as HouseholdAccessPolicy;
    const config = {
      get: (name: string): string | undefined =>
        (
          ({
            NODE_ENV: 'test',
            DATA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 7).toString('base64'),
            DATA_ENCRYPTION_KEY_ID: 'test-v1',
          }) as Record<string, string>
        )[name],
    } as ConfigService;
    const service = new MemoryApplicationService(
      prisma,
      policy,
      new AesGcmDataEncryptionAdapter(config),
    );
    return { service, state };
  }

  it('appends an encrypted immutable revision for every update', async () => {
    const { service, state } = setup();
    const created = await service.create({
      principal,
      householdId,
      recipientId,
      kind: 'LIFE_EVENT',
      title: '西湖散步',
      content: '每周日下午和女儿散步',
      sensitivity: 'SENSITIVE',
      verificationStatus: 'FAMILY_REPORTED',
    });

    expect(created.currentRevision.content).toBe('每周日下午和女儿散步');
    expect(state.revisions).toHaveLength(1);
    expect(
      Buffer.from(state.revisions[0].contentCiphertext).includes(
        Buffer.from('每周日下午和女儿散步'),
      ),
    ).toBe(false);

    const updated = await service.update({
      principal,
      householdId,
      memoryId: created.id,
      title: '西湖边散步',
      changeReason: '修正标题',
      version: 0,
    });

    expect(updated.version).toBe(1);
    expect(updated.currentRevision.revisionNo).toBe(2);
    expect(updated.currentRevision.content).toBe('每周日下午和女儿散步');
    expect(state.revisions).toHaveLength(2);
    expect(
      Buffer.from(state.revisions[0].contentNonce).equals(
        Buffer.from(state.revisions[1].contentNonce),
      ),
    ).toBe(false);
    await expect(
      service.update({
        principal,
        householdId,
        memoryId: created.id,
        content: '过期客户端的修改',
        version: 0,
      }),
    ).rejects.toBeInstanceOf(MemoryVersionConflictException);
    expect(state.revisions).toHaveLength(2);

    const history = await service.listRevisions(
      principal.userId,
      householdId,
      created.id,
    );
    expect(history.map((revision) => revision.revisionNo)).toEqual([2, 1]);
  });

  it('denies a cross-household path before loading a memory', async () => {
    const { service, state } = setup();
    const callsBefore = state.findFirstCalls;

    await expect(
      service.get(
        principal.userId,
        '01OTHERHOUSEHOLD00000000000',
        '01MEMORY0000000000000000000',
      ),
    ).rejects.toBeInstanceOf(HouseholdAccessDeniedException);
    expect(state.findFirstCalls).toBe(callsBefore);
  });
});
