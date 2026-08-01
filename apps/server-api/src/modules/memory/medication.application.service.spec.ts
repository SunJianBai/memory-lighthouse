/* Test doubles implement promise-based ports without real asynchronous work. */

import { describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../../infrastructure/database/prisma.service';
import { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import { HouseholdAccessDeniedException } from '../household/household.errors';
import type { UserPrincipal } from '../identity/identity.types';
import { AesGcmDataEncryptionAdapter } from './crypto/aes-gcm-data-encryption.adapter';
import { MedicationApplicationService } from './medication.application.service';
import { MemoryVersionConflictException } from './memory.errors';

interface MedicationStateRow {
  id: string;
  householdId: string;
  recipientId: string;
  name: string;
  alias: string | null;
  purposeCiphertext: Uint8Array | null;
  requirementsCiphertext: Uint8Array | null;
  contentNonce: Uint8Array | null;
  encryptionKeyId: string | null;
  containerLabel: string | null;
  containerLocation: string | null;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
}

interface MedicationWhere {
  id?: string;
  householdId?: string;
  recipientId?: string;
  deletedAt?: null;
  version?: number;
}

function createMedicationPrisma(): {
  prisma: PrismaService;
  rows: MedicationStateRow[];
} {
  const rows: MedicationStateRow[] = [];
  const matches = (row: MedicationStateRow, where: MedicationWhere): boolean =>
    (where.id === undefined || row.id === where.id) &&
    (where.householdId === undefined ||
      row.householdId === where.householdId) &&
    (where.recipientId === undefined ||
      row.recipientId === where.recipientId) &&
    (where.deletedAt !== null || row.deletedAt === null) &&
    (where.version === undefined || row.version === where.version);
  const raw = {
    medication: {
      create: jest.fn(
        async ({
          data,
        }: {
          data: Omit<MedicationStateRow, 'deletedAt' | 'version'>;
        }) => {
          const row: MedicationStateRow = {
            ...data,
            deletedAt: null,
            version: 0,
          };
          rows.push(row);
          return { ...row };
        },
      ),
      findMany: jest.fn(async ({ where }: { where: MedicationWhere }) =>
        rows.filter((row) => matches(row, where)),
      ),
      findFirst: jest.fn(
        async ({ where }: { where: MedicationWhere }) =>
          rows.find((row) => matches(row, where)) ?? null,
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: MedicationWhere;
          data: Record<string, unknown>;
        }) => {
          const row = rows.find((candidate) => matches(candidate, where));
          if (!row) return { count: 0 };
          for (const [key, value] of Object.entries(data)) {
            if (key === 'version') row.version += 1;
            else if (key in row) Object.assign(row, { [key]: value });
          }
          return { count: 1 };
        },
      ),
    },
  };
  return {
    prisma: {
      ...raw,
      $transaction: jest.fn(
        async (work: (transaction: typeof raw) => Promise<unknown>) =>
          work(raw),
      ),
    } as unknown as PrismaService,
    rows,
  };
}

describe('MedicationApplicationService', () => {
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
    const { prisma, rows } = createMedicationPrisma();
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
          return { id: '01MEMBER0000000000000000000' };
        },
      ),
    } as unknown as HouseholdAccessPolicy;
    const config = {
      get: (name: string): string | undefined =>
        (
          ({
            NODE_ENV: 'test',
            DATA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 0x13).toString(
              'base64',
            ),
            DATA_ENCRYPTION_KEY_ID: 'medication-test-v1',
          }) as Record<string, string>
        )[name],
    } as ConfigService;
    return {
      service: new MedicationApplicationService(
        prisma,
        policy,
        new AesGcmDataEncryptionAdapter(config),
      ),
      rows,
    };
  }

  it('stores family-entered purpose/requirements encrypted and never claims clinical judgment', async () => {
    const { service, rows } = setup();
    const created = await service.create({
      principal,
      householdId,
      recipientId,
      name: '家属录入的白色药盒',
      purpose: '家属备注：用于控制血压',
      requirements: '家属备注：遵照处方，饭后服用',
      containerLocation: '餐边柜左侧',
    });

    expect(created).toMatchObject({
      purpose: '家属备注：用于控制血压',
      requirements: '家属备注：遵照处方，饭后服用',
      recordOrigin: 'FAMILY_ENTERED',
      clinicalAssessmentPerformed: false,
    });
    expect(
      Buffer.from(rows[0].purposeCiphertext!).includes(
        Buffer.from('用于控制血压'),
      ),
    ).toBe(false);
    expect(
      Buffer.from(rows[0].requirementsCiphertext!).includes(
        Buffer.from('遵照处方'),
      ),
    ).toBe(false);

    const updated = await service.update({
      principal,
      householdId,
      medicationId: created.id,
      requirements: '家属更新：以最新处方为准',
      version: 0,
    });
    expect(updated.version).toBe(1);
    expect(updated.purpose).toBe('家属备注：用于控制血压');
    expect(updated.requirements).toBe('家属更新：以最新处方为准');

    await expect(
      service.update({
        principal,
        householdId,
        medicationId: created.id,
        alias: '过期修改',
        version: 0,
      }),
    ).rejects.toBeInstanceOf(MemoryVersionConflictException);
  });

  it('denies cross-household medication reads', async () => {
    const { service } = setup();
    await expect(
      service.list(
        principal.userId,
        '01OTHERHOUSEHOLD00000000000',
        recipientId,
      ),
    ).rejects.toBeInstanceOf(HouseholdAccessDeniedException);
  });
});
