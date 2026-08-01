import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';

import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../../infrastructure/database/prisma.service';
import { OCCURRENCE_STATUS } from '../care-workflow/care-workflow.constants';
import type { CareWorkflowContentCipher } from '../care-workflow/ports/content-cipher.port';
import type { DataEncryptionPort } from '../memory/ports/data-encryption.port';
import type { MediaLeasePort } from '../realtime-communication/ports/media-lease.port';
import { CompanionSessionApplicationService } from './companion-session.application.service';

jest.mock('../../infrastructure/database/prisma.service', () => ({
  PrismaService: class PrismaService {},
}));

const NOW = new Date('2026-08-01T08:00:00.000Z');
const principal = {
  kind: 'DEVICE' as const,
  tokenId: '01J00000000000000000000001',
  credentialId: '01J00000000000000000000002',
  credentialFamilyId: '01J00000000000000000000003',
  deviceId: '01J00000000000000000000004',
  bindingId: '01J00000000000000000000005',
  householdId: '01J00000000000000000000006',
  recipientId: '01J00000000000000000000007',
  bindingVersion: 1,
  capabilities: ['COMPANION' as const],
};

const binding = {
  id: principal.bindingId,
  bindingVersion: principal.bindingVersion,
  householdId: principal.householdId,
  recipientId: principal.recipientId,
  status: 'ACTIVE',
  device: { id: principal.deviceId, status: 'ACTIVE' },
  recipient: {
    id: principal.recipientId,
    status: 'ACTIVE',
    preferredName: '王奶奶',
    timezone: 'Asia/Shanghai',
  },
};

function protectedPair(instructions: string, confirmationQuestion: string) {
  const bytes = Buffer.from(
    JSON.stringify([instructions, confirmationQuestion]),
    'utf8',
  );
  const splitAt = Math.ceil(bytes.length / 2);
  return {
    instructionsCiphertext: Uint8Array.from(bytes.subarray(0, splitAt)),
    confirmationQuestionCiphertext: Uint8Array.from(bytes.subarray(splitAt)),
    contentNonce: Uint8Array.from(Buffer.alloc(24, 1)),
    encryptionKeyId: 'care-test-key',
  };
}

function careOccurrence(options: {
  id: string;
  status: string;
  scheduledAtUtc: string;
  version?: number;
}) {
  return {
    id: options.id,
    routineId: `routine-${options.id}`,
    scheduledAtUtc: new Date(options.scheduledAtUtc),
    status: options.status,
    confirmationDeadlineAt: new Date('2026-08-01T08:20:00.000Z'),
    escalationAt: new Date('2026-08-01T08:30:00.000Z'),
    version: options.version ?? 0,
    routine: {
      title: `家属日程 ${options.id}`,
      type: 'MEDICATION',
      ...protectedPair('早餐后按家属记录提醒', '已经完成了吗？'),
    },
  };
}

function snapshotHarness(rows: ReturnType<typeof careOccurrence>[]) {
  const findOccurrences = jest.fn(async () => rows);
  const prisma = {
    companionBinding: { findFirst: jest.fn(async () => binding) },
    recipientConsentState: { findMany: jest.fn(async () => []) },
    routineOccurrence: { findMany: findOccurrences },
  };
  const config = { get: jest.fn(() => undefined) };
  const encryption = {
    sealFields: jest.fn(),
    openFields: jest.fn(),
  };
  const leases = {
    acquire: jest.fn(async () => true),
    renew: jest.fn(async () => true),
    transfer: jest.fn(async () => true),
    release: jest.fn(async () => undefined),
    current: jest.fn(async () => null),
  };
  const careCipher = {
    encrypt: jest.fn(),
    decrypt: jest.fn((content: { ciphertext: Buffer }) =>
      content.ciphertext.toString('utf8'),
    ),
  };
  const service = new CompanionSessionApplicationService(
    prisma as unknown as PrismaService,
    config as unknown as ConfigService,
    encryption as unknown as DataEncryptionPort,
    leases as unknown as MediaLeasePort,
    careCipher as unknown as CareWorkflowContentCipher,
  );
  return { service, findOccurrences, careCipher };
}

describe('CompanionSessionApplicationService care occurrence snapshot', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('includes actionable and near-future family-entered occurrences in device context', async () => {
    const test = snapshotHarness([
      careOccurrence({
        id: 'due-soon',
        status: OCCURRENCE_STATUS.due,
        scheduledAtUtc: '2026-08-02T07:59:00.000Z',
        version: 2,
      }),
      careOccurrence({
        id: 'awaiting',
        status: OCCURRENCE_STATUS.awaitingConfirmation,
        scheduledAtUtc: '2026-07-31T08:00:00.000Z',
      }),
      careOccurrence({
        id: 'family-review',
        status: OCCURRENCE_STATUS.needsFamilyReview,
        scheduledAtUtc: '2026-07-30T08:00:00.000Z',
      }),
      careOccurrence({
        id: 'due-later',
        status: OCCURRENCE_STATUS.due,
        scheduledAtUtc: '2026-08-02T08:01:00.000Z',
      }),
      careOccurrence({
        id: 'confirmed',
        status: OCCURRENCE_STATUS.confirmed,
        scheduledAtUtc: '2026-08-01T07:00:00.000Z',
      }),
      careOccurrence({
        id: 'expired',
        status: OCCURRENCE_STATUS.expired,
        scheduledAtUtc: '2026-08-01T07:00:00.000Z',
      }),
    ]);

    const context = await test.service.getDeviceContext(principal);

    expect(context.careSnapshot.occurrences.map((row) => row.id)).toEqual([
      'due-soon',
      'awaiting',
      'family-review',
    ]);
    expect(context.careSnapshot.occurrences[0]).toEqual({
      id: 'due-soon',
      routineId: 'routine-due-soon',
      routineTitle: '家属日程 due-soon',
      routineType: 'MEDICATION',
      instructions: '早餐后按家属记录提醒',
      confirmationQuestion: '已经完成了吗？',
      scheduledAtUtc: '2026-08-02T07:59:00.000Z',
      status: OCCURRENCE_STATUS.due,
      confirmationDeadlineAt: '2026-08-01T08:20:00.000Z',
      escalationAt: '2026-08-01T08:30:00.000Z',
      version: 2,
    });
    expect(test.careCipher.decrypt).toHaveBeenCalledTimes(3);
    expect(test.findOccurrences).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          householdId: principal.householdId,
          recipientId: principal.recipientId,
          routine: { status: 'ACTIVE', deletedAt: null },
          schedule: { active: true },
        }),
        take: 32,
      }),
    );
  });

  it('returns an explicit empty occurrence list when no care item is actionable', async () => {
    const test = snapshotHarness([]);

    const context = await test.service.getDeviceContext(principal);

    expect(context.careSnapshot.occurrences).toEqual([]);
    expect(test.careCipher.decrypt).not.toHaveBeenCalled();
  });
});
