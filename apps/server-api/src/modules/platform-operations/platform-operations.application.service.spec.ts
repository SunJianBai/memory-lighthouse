import { describe, expect, it, jest } from '@jest/globals';

import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { DataEncryptionPort } from '../memory/ports/data-encryption.port';
import type { DevelopmentContentInspectionPolicy } from './config/development-content-inspection.policy';
import { PlatformOperationsApplicationService } from './platform-operations.application.service';
import {
  ContentInspectionConsentRequiredException,
  InspectionGrantScopeDeniedException,
  InspectionGrantSelfApprovalException,
} from './platform-operations.errors';
import type { PlatformPrincipal } from './platform-operations.types';

type Row = Record<string, any>;

const NOW = new Date('2026-08-01T10:00:00.000Z');
const ID = {
  user: '01K1K000000000000000000001',
  approver: '01K1K000000000000000000002',
  household: '01K1K000000000000000000003',
  recipient: '01K1K000000000000000000004',
  memory: '01K1K000000000000000000005',
  revision: '01K1K000000000000000000006',
  grant: '01K1K000000000000000000007',
};

const principal: PlatformPrincipal = {
  kind: 'USER',
  userId: ID.user,
  sessionId: '01K1K000000000000000000008',
  tokenId: '01K1K000000000000000000009',
  status: 'ACTIVE',
  platformRoles: ['CONTENT_AUDITOR'],
};

class InspectionPrismaHarness {
  readonly auditLogs: Row[] = [];
  readonly inspections: Row[] = [];
  consentDecision = 'GRANTED';
  grantOverrides: Row = {};

  readonly memory = {
    findFirst: jest.fn(async () => ({
      id: ID.memory,
      householdId: ID.household,
      recipientId: ID.recipient,
      kind: 'STORY',
      title: '童年',
      sensitivity: 'HOUSEHOLD',
      verificationStatus: 'FAMILY_VERIFIED',
      currentRevisionNo: 2,
    })),
  };

  readonly memoryRevision = {
    findFirst: jest.fn(async () => null),
    findUnique: jest.fn(async () => ({
      id: ID.revision,
      memoryId: ID.memory,
      revisionNo: 2,
      contentCiphertext: Uint8Array.from([1, 2, 3]),
      contentNonce: Uint8Array.from([4, 5, 6]),
      encryptionKeyId: 'dev-key-v1',
      contentHash: Uint8Array.from([7, 8, 9]),
      source: 'FAMILY',
      createdAt: NOW,
    })),
  };

  readonly conversationUtterance = {
    findUnique: jest.fn(async () => ({
      id: '01K1K000000000000000000010',
      modelSessionId: '01K1K000000000000000000011',
      sequenceNo: 3,
      speaker: 'ASSISTANT',
      isFinal: true,
      language: 'zh-CN',
      confidence: null,
      createdAt: NOW,
      content: {
        rawTextCiphertext: Uint8Array.from([10, 11, 12]),
        nonce: Uint8Array.from([13, 14, 15]),
        encryptionKeyId: 'dev-key-v1',
        contentHash: Uint8Array.from([16, 17, 18]),
        charCount: 5,
        retentionUntil: new Date(Date.now() + 60_000),
        purgedAt: null,
      },
      modelSession: {
        companionSession: {
          householdId: ID.household,
          recipientId: ID.recipient,
        },
      },
    })),
  };

  readonly inspectionGrant = {
    findUnique: jest.fn(async () => ({
      id: ID.grant,
      environment: 'development',
      requestedByUserId: ID.user,
      approvedByUserId: ID.approver,
      householdId: ID.household,
      recipientId: ID.recipient,
      dataCategoriesJson: ['MEMORY_REVISION'],
      reason: '验证模型是否正确使用可信记忆',
      ticketReference: 'DEV-42',
      status: 'ACTIVE',
      validFrom: new Date(Date.now() - 60_000),
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      createdAt: NOW,
      ...this.grantOverrides,
    })),
    update: jest.fn(async ({ data }: Row) => ({
      ...(await this.inspectionGrant.findUnique()),
      ...data,
    })),
  };

  readonly recipientConsentState = {
    findUnique: jest.fn(async () => ({
      householdId: ID.household,
      decision: this.consentDecision,
    })),
  };

  readonly contentInspection = {
    create: jest.fn(async ({ data }: Row) => {
      this.inspections.push(data);
      return data;
    }),
  };

  readonly auditLog = {
    findFirst: jest.fn(async () => {
      const previous = this.auditLogs.at(-1);
      return previous ? { eventHash: previous.eventHash } : null;
    }),
    create: jest.fn(async ({ data }: Row) => {
      this.auditLogs.push(data);
      return data;
    }),
  };

  readonly $transaction = jest.fn(
    async (work: (transaction: InspectionPrismaHarness) => Promise<unknown>) =>
      work(this),
  );
}

function makeService() {
  const prisma = new InspectionPrismaHarness();
  const policy = { requireEnabled: jest.fn() };
  const encryption = {
    openFields: jest.fn((sealed: Row) =>
      'rawText' in sealed.ciphertexts
        ? { rawText: '今天阳光很好。' }
        : { content: '奶奶小时候住在江边。' },
    ),
    sealFields: jest.fn(),
  };
  const service = new PlatformOperationsApplicationService(
    prisma as unknown as PrismaService,
    policy as unknown as DevelopmentContentInspectionPolicy,
    encryption as unknown as DataEncryptionPort,
  );
  return { prisma, policy, encryption, service };
}

describe('PlatformOperationsApplicationService content inspection', () => {
  it('decrypts one revision only after grant + consent checks and atomically appends inspection/audit records', async () => {
    const { prisma, encryption, service } = makeService();

    const result = await service.inspectMemoryRevision({
      principal,
      grantId: ID.grant,
      memoryId: ID.memory,
      request: { requestId: 'request-42', userAgent: 'test-agent' },
    });

    expect(result).toMatchObject({
      id: ID.revision,
      memoryId: ID.memory,
      content: '奶奶小时候住在江边。',
      watermark: {
        operatorUserId: ID.user,
        grantId: ID.grant,
        requestId: 'request-42',
      },
    });
    expect(encryption.openFields).toHaveBeenCalledWith(
      expect.objectContaining({ keyId: 'dev-key-v1' }),
      `memory:${ID.memory}:revision:2`,
    );
    expect(prisma.inspections).toHaveLength(1);
    expect(prisma.auditLogs).toHaveLength(1);
    expect(prisma.auditLogs[0]).toMatchObject({
      action: 'MEMORY_REVISION_ORIGINAL_READ',
      resourceId: ID.revision,
      householdId: ID.household,
      recipientId: ID.recipient,
      ticketId: ID.grant,
      decision: 'ALLOW',
    });
    const persisted = JSON.stringify({
      inspection: prisma.inspections,
      audit: prisma.auditLogs,
    });
    expect(persisted).not.toContain('奶奶小时候住在江边');
    expect(Buffer.from(prisma.auditLogs[0].eventHash)).toHaveLength(32);
  });

  it('chains each audit entry to the previous event hash', async () => {
    const { prisma, service } = makeService();
    const command = {
      principal,
      grantId: ID.grant,
      memoryId: ID.memory,
      request: { requestId: 'request-chain' },
    };

    await service.inspectMemoryRevision(command);
    await service.inspectMemoryRevision(command);

    expect(prisma.auditLogs).toHaveLength(2);
    expect(Buffer.from(prisma.auditLogs[1].previousEventHash)).toEqual(
      Buffer.from(prisma.auditLogs[0].eventHash),
    );
    expect(Buffer.from(prisma.auditLogs[1].eventHash)).not.toEqual(
      Buffer.from(prisma.auditLogs[0].eventHash),
    );
  });

  it('refuses decryption and audit when current CONTENT_INSPECTION consent is absent', async () => {
    const { prisma, encryption, service } = makeService();
    prisma.consentDecision = 'REVOKED';

    await expect(
      service.inspectMemoryRevision({
        principal,
        grantId: ID.grant,
        memoryId: ID.memory,
        request: { requestId: 'request-denied' },
      }),
    ).rejects.toBeInstanceOf(ContentInspectionConsentRequiredException);
    expect(encryption.openFields).not.toHaveBeenCalled();
    expect(prisma.inspections).toHaveLength(0);
    expect(prisma.auditLogs).toHaveLength(0);
  });

  it('binds a grant to its requesting auditor, household, recipient, and category', async () => {
    const { prisma, encryption, service } = makeService();
    prisma.grantOverrides = { dataCategoriesJson: ['CONVERSATION_UTTERANCE'] };

    await expect(
      service.inspectMemoryRevision({
        principal,
        grantId: ID.grant,
        memoryId: ID.memory,
        request: { requestId: 'request-wrong-category' },
      }),
    ).rejects.toBeInstanceOf(InspectionGrantScopeDeniedException);
    expect(encryption.openFields).not.toHaveBeenCalled();
  });

  it('requires a different person to approve a pending grant', async () => {
    const { prisma, service } = makeService();
    prisma.grantOverrides = {
      status: 'PENDING',
      approvedByUserId: null,
      expiresAt: new Date(Date.now() + 60_000),
    };

    await expect(
      service.approveInspectionGrant({
        principal,
        grantId: ID.grant,
        request: { requestId: 'request-self-approval' },
      }),
    ).rejects.toBeInstanceOf(InspectionGrantSelfApprovalException);
    expect(prisma.inspectionGrant.update).not.toHaveBeenCalled();
  });

  it('allows a separate ADMIN to approve and records the approval actor', async () => {
    const { prisma, service } = makeService();
    prisma.grantOverrides = {
      status: 'PENDING',
      approvedByUserId: null,
      expiresAt: new Date(Date.now() + 60_000),
    };
    const approver: PlatformPrincipal = {
      ...principal,
      userId: ID.approver,
      platformRoles: ['ADMIN'],
    };

    const result = await service.approveInspectionGrant({
      principal: approver,
      grantId: ID.grant,
      request: { requestId: 'request-approved' },
    });

    expect(result).toMatchObject({
      id: ID.grant,
      status: 'ACTIVE',
      approvedByUserId: ID.approver,
    });
    expect(prisma.auditLogs.at(-1)).toMatchObject({
      action: 'INSPECTION_GRANT_APPROVED',
      actorUserId: ID.approver,
      approvalActorId: ID.approver,
    });
  });

  it('uses the companion-session encryption context for one retained utterance', async () => {
    const { prisma, encryption, service } = makeService();
    prisma.grantOverrides = {
      dataCategoriesJson: ['CONVERSATION_UTTERANCE'],
    };

    const result = await service.inspectUtterance({
      principal,
      grantId: ID.grant,
      utteranceId: '01K1K000000000000000000010',
      request: { requestId: 'request-utterance' },
    });

    expect(result).toMatchObject({
      id: '01K1K000000000000000000010',
      rawText: '今天阳光很好。',
      watermark: { grantId: ID.grant, requestId: 'request-utterance' },
    });
    expect(encryption.openFields).toHaveBeenCalledWith(
      expect.objectContaining({ keyId: 'dev-key-v1' }),
      'conversation-utterance:01K1K000000000000000000010:content:v1',
    );
    expect(prisma.inspections.at(-1)).toMatchObject({
      resourceType: 'CONVERSATION_UTTERANCE',
      resourceId: '01K1K000000000000000000010',
    });
    expect(JSON.stringify(prisma.auditLogs)).not.toContain('今天阳光很好');
  });
});
