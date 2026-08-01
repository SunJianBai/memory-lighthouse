import { describe, expect, it, jest } from '@jest/globals';
import { ConfigService } from '@nestjs/config';

import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import { AesGcmDataEncryptionAdapter } from './crypto/aes-gcm-data-encryption.adapter';
import {
  MemoryVersionConflictException,
  TrustedContactNotFoundException,
} from './memory.errors';
import { TrustedContactApplicationService } from './trusted-contact.application.service';

const principal = {
  userId: 'user-1',
  sessionId: 'session-1',
  authVersion: 0,
  clientType: 'WEB' as const,
};

function harness() {
  const rows: Array<Record<string, any>> = [];
  const outbox: Array<Record<string, any>> = [];
  const trustedContact = {
    findMany: jest.fn(async ({ where }: any) =>
      rows.filter(
        (row) =>
          row.householdId === where.householdId &&
          row.recipientId === where.recipientId,
      ),
    ),
    findFirst: jest.fn(
      async ({ where }: any) =>
        rows.find(
          (row) => row.id === where.id && row.householdId === where.householdId,
        ) ?? null,
    ),
    findUnique: jest.fn(
      async ({ where }: any) => rows.find((row) => row.id === where.id) ?? null,
    ),
    create: jest.fn(async ({ data }: any) => {
      const now = new Date('2026-08-01T12:00:00.000Z');
      const row = { ...data, createdAt: now, updatedAt: now, version: 0 };
      rows.push(row);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const row = rows.find(
        (candidate) =>
          candidate.id === where.id &&
          candidate.householdId === where.householdId &&
          candidate.version === where.version,
      );
      if (!row) return { count: 0 };
      Object.assign(row, data, {
        version: row.version + 1,
        updatedAt: new Date('2026-08-01T12:01:00.000Z'),
      });
      return { count: 1 };
    }),
    deleteMany: jest.fn(async ({ where }: any) => {
      const index = rows.findIndex(
        (row) =>
          row.id === where.id &&
          row.householdId === where.householdId &&
          row.version === where.version,
      );
      if (index < 0) return { count: 0 };
      rows.splice(index, 1);
      return { count: 1 };
    }),
  };
  const prisma = {
    trustedContact,
    householdMember: {
      findFirst: jest.fn(async () => ({ id: 'member-1' })),
    },
    outboxEvent: {
      create: jest.fn(async ({ data }: any) => {
        outbox.push(data);
        return data;
      }),
    },
    $transaction: jest.fn(async (operation: (client: any) => unknown) =>
      operation(prisma),
    ),
  };
  const access = {
    requireRecipientAction: jest.fn(async () => ({
      id: 'member-1',
      householdId: 'household-1',
      userId: principal.userId,
      roleCodes: ['OWNER'],
    })),
  };
  const encryption = new AesGcmDataEncryptionAdapter(
    new ConfigService({
      NODE_ENV: 'test',
      DATA_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 3).toString('base64'),
      DATA_ENCRYPTION_KEY_ID: 'test-key',
    }),
  );
  const service = new TrustedContactApplicationService(
    prisma as unknown as PrismaService,
    access as unknown as HouseholdAccessPolicy,
    encryption,
  );
  return { service, rows, outbox, access };
}

describe('TrustedContactApplicationService', () => {
  it('encrypts phone/email at rest and returns the authorized plaintext view', async () => {
    const test = harness();
    const created = await test.service.create({
      principal,
      householdId: 'household-1',
      recipientId: 'recipient-1',
      householdMemberId: 'member-1',
      name: '王阿姨',
      relationshipLabel: '邻居',
      phone: '+86 138 0000 0000',
      email: 'Helper@Example.com',
      priority: 1,
      canViewEvidence: false,
    });

    expect(created).toMatchObject({
      phone: '+86 138 0000 0000',
      email: 'helper@example.com',
    });
    expect(
      Buffer.from(test.rows[0].phoneCiphertext).toString('utf8'),
    ).not.toContain('138 0000');
    expect(test.outbox[0]).not.toHaveProperty('phone');
    expect(test.outbox[0]).not.toHaveProperty('email');
  });

  it('keeps household scope in the lookup before revealing a contact', async () => {
    const test = harness();
    await expect(
      test.service.update({
        principal,
        householdId: 'another-household',
        contactId: 'missing-contact',
        name: '枚举尝试',
        version: 0,
      }),
    ).rejects.toBeInstanceOf(TrustedContactNotFoundException);
    expect(test.access.requireRecipientAction).not.toHaveBeenCalled();
  });

  it('rejects a stale optimistic version without overwriting encrypted data', async () => {
    const test = harness();
    const created = await test.service.create({
      principal,
      householdId: 'household-1',
      recipientId: 'recipient-1',
      name: '联系人',
      relationshipLabel: '家属',
      phone: '13800000000',
      priority: 1,
      canViewEvidence: true,
    });

    await expect(
      test.service.update({
        principal,
        householdId: 'household-1',
        contactId: created.id,
        phone: '13900000000',
        version: 7,
      }),
    ).rejects.toBeInstanceOf(MemoryVersionConflictException);
  });
});
