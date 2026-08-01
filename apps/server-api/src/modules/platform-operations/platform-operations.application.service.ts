import { createHash } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';

import {
  Prisma,
  type InspectionGrant,
} from '../../infrastructure/database/generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { utteranceEncryptionContext } from '../companion-session/companion-session.constants';
import { newUlid } from '../identity/domain/ulid';
import { DATA_ENCRYPTION_PORT } from '../memory/memory.constants';
import type { DataEncryptionPort } from '../memory/ports/data-encryption.port';
import { NotificationApplicationService } from '../notification';
import { DevelopmentContentInspectionPolicy } from './config/development-content-inspection.policy';
import {
  AUDIT_SERIALIZABLE_RETRY_LIMIT,
  CONTENT_INSPECTION_CONSENT_SCOPE,
  CONTENT_INSPECTION_ENVIRONMENT,
  CONTENT_INSPECTION_MAX_TTL_SECONDS,
  INSPECTION_GRANT_STATUS,
  PLATFORM_PAGE_DEFAULT,
  PLATFORM_PAGE_MAX,
  type InspectionDataCategory,
} from './platform-operations.constants';
import {
  ContentInspectionConsentRequiredException,
  InspectionContentUnavailableException,
  InspectionGrantNotFoundException,
  InspectionGrantScopeDeniedException,
  InspectionGrantSelfApprovalException,
  InspectionGrantStateException,
  InspectionResourceNotFoundException,
} from './platform-operations.errors';
import type {
  GrantMutationCommand,
  InspectMemoryCommand,
  InspectUtteranceCommand,
  InspectionWatermark,
  PlatformPage,
  PlatformPageQuery,
  PlatformPrincipal,
  PlatformRequestMetadata,
  RequestInspectionGrantCommand,
} from './platform-operations.types';

interface AuditAppendInput {
  principal: PlatformPrincipal;
  request: PlatformRequestMetadata;
  action: string;
  resourceType: string;
  resourceId: string;
  householdId?: string;
  recipientId?: string;
  grant?: Pick<
    InspectionGrant,
    'id' | 'reason' | 'approvedByUserId' | 'ticketReference'
  >;
}

interface InspectionAuditInput extends AuditAppendInput {
  householdId: string;
  grant: Pick<
    InspectionGrant,
    'id' | 'reason' | 'approvedByUserId' | 'ticketReference'
  >;
}

@Injectable()
export class PlatformOperationsApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly inspectionPolicy: DevelopmentContentInspectionPolicy,
    @Inject(DATA_ENCRYPTION_PORT)
    private readonly encryption: DataEncryptionPort,
    private readonly notifications: NotificationApplicationService,
  ) {}

  async dashboard(): Promise<Record<string, unknown>> {
    const now = new Date();
    const lastDay = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const [
      users,
      activeUsers,
      households,
      devices,
      boundDevices,
      modelSessionsLast24Hours,
      failedModelSessionsLast24Hours,
      remoteSessionsLast24Hours,
      pendingInspectionGrants,
    ] = await Promise.all([
      this.prisma.user.count({ where: { deletedAt: null } }),
      this.prisma.user.count({
        where: { deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.household.count(),
      this.prisma.device.count(),
      this.prisma.companionBinding.count({ where: { status: 'ACTIVE' } }),
      this.prisma.modelSession.count({
        where: { startedAt: { gte: lastDay } },
      }),
      this.prisma.modelSession.count({
        where: { startedAt: { gte: lastDay }, status: 'FAILED' },
      }),
      this.prisma.remoteAssistanceSession.count({
        where: { requestedAt: { gte: lastDay } },
      }),
      this.prisma.inspectionGrant.count({
        where: {
          environment: CONTENT_INSPECTION_ENVIRONMENT,
          status: INSPECTION_GRANT_STATUS.pending,
          expiresAt: { gt: now },
        },
      }),
    ]);

    return {
      generatedAt: now.toISOString(),
      users: { total: users, active: activeUsers },
      households: { total: households },
      devices: { total: devices, activelyBound: boundDevices },
      modelSessions: {
        last24Hours: modelSessionsLast24Hours,
        failedLast24Hours: failedModelSessionsLast24Hours,
      },
      remoteSessions: { last24Hours: remoteSessionsLast24Hours },
      inspectionGrants: { pending: pendingInspectionGrants },
    };
  }

  async listUsers(query: PlatformPageQuery): Promise<PlatformPage<unknown>> {
    const pagination = this.pagination(query);
    const search = query.search?.trim();
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search } },
              { displayName: { contains: search } },
              {
                loginIdentities: {
                  some: { normalizedValue: { contains: search } },
                },
              },
            ],
          }
        : {}),
    };
    const [total, records] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: pagination.skip,
        take: pagination.limit,
        select: {
          id: true,
          displayName: true,
          status: true,
          locale: true,
          timezone: true,
          createdAt: true,
          updatedAt: true,
          loginIdentities: {
            orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }],
            select: {
              type: true,
              value: true,
              verifiedAt: true,
              isPrimary: true,
            },
          },
          _count: { select: { householdMemberships: true, sessions: true } },
        },
      }),
    ]);

    return this.pageResult(
      records.map((record) => ({
        id: record.id,
        displayName: record.displayName,
        status: record.status,
        locale: record.locale,
        timezone: record.timezone,
        identities: record.loginIdentities.map((identity) => ({
          type: identity.type,
          maskedValue: this.maskIdentity(identity.type, identity.value),
          verifiedAt: identity.verifiedAt?.toISOString() ?? null,
          isPrimary: identity.isPrimary,
        })),
        householdMembershipCount: record._count.householdMemberships,
        sessionCount: record._count.sessions,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      })),
      total,
      pagination,
    );
  }

  async listHouseholds(
    query: PlatformPageQuery,
  ): Promise<PlatformPage<unknown>> {
    const pagination = this.pagination(query);
    const search = query.search?.trim();
    const where: Prisma.HouseholdWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? { OR: [{ id: { contains: search } }, { name: { contains: search } }] }
        : {}),
    };
    const [total, records] = await Promise.all([
      this.prisma.household.count({ where }),
      this.prisma.household.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: pagination.skip,
        take: pagination.limit,
        select: {
          id: true,
          name: true,
          timezone: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              members: true,
              careRecipients: true,
              companionBindings: true,
            },
          },
        },
      }),
    ]);

    return this.pageResult(
      records.map((record) => ({
        id: record.id,
        name: record.name,
        timezone: record.timezone,
        status: record.status,
        memberCount: record._count.members,
        recipientCount: record._count.careRecipients,
        companionBindingCount: record._count.companionBindings,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      })),
      total,
      pagination,
    );
  }

  async listDevices(query: PlatformPageQuery): Promise<PlatformPage<unknown>> {
    const pagination = this.pagination(query);
    const search = query.search?.trim();
    const where: Prisma.DeviceWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search } },
              { manufacturer: { contains: search } },
              { model: { contains: search } },
            ],
          }
        : {}),
    };
    const [total, records] = await Promise.all([
      this.prisma.device.count({ where }),
      this.prisma.device.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: pagination.skip,
        take: pagination.limit,
        select: {
          id: true,
          platform: true,
          manufacturer: true,
          model: true,
          osVersion: true,
          appVersion: true,
          lastSeenAt: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          companionBinding: {
            select: {
              id: true,
              householdId: true,
              recipientId: true,
              displayName: true,
              status: true,
              activatedAt: true,
              revokedAt: true,
            },
          },
        },
      }),
    ]);

    return this.pageResult(
      records.map((record) => ({
        id: record.id,
        platform: record.platform,
        manufacturer: record.manufacturer,
        model: record.model,
        osVersion: record.osVersion,
        appVersion: record.appVersion,
        lastSeenAt: record.lastSeenAt?.toISOString() ?? null,
        status: record.status,
        binding: record.companionBinding
          ? {
              ...record.companionBinding,
              activatedAt: record.companionBinding.activatedAt.toISOString(),
              revokedAt:
                record.companionBinding.revokedAt?.toISOString() ?? null,
            }
          : null,
        createdAt: record.createdAt.toISOString(),
        updatedAt: record.updatedAt.toISOString(),
      })),
      total,
      pagination,
    );
  }

  async listModelSessions(
    query: PlatformPageQuery,
  ): Promise<PlatformPage<unknown>> {
    const pagination = this.pagination(query);
    const search = query.search?.trim();
    const where: Prisma.ModelSessionWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search } },
              { provider: { contains: search } },
              { model: { contains: search } },
              { errorCode: { contains: search } },
            ],
          }
        : {}),
    };
    const [total, records] = await Promise.all([
      this.prisma.modelSession.count({ where }),
      this.prisma.modelSession.findMany({
        where,
        orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
        skip: pagination.skip,
        take: pagination.limit,
        select: {
          id: true,
          provider: true,
          model: true,
          providerSessionId: true,
          status: true,
          startedAt: true,
          firstResponseAt: true,
          endedAt: true,
          endReason: true,
          errorCode: true,
          companionSession: {
            select: {
              id: true,
              householdId: true,
              recipientId: true,
              bindingId: true,
              mode: true,
            },
          },
          promptVersion: { select: { code: true, version: true } },
          _count: { select: { utterances: true, events: true } },
        },
      }),
    ]);

    return this.pageResult(
      records.map((record) => ({
        id: record.id,
        companionSession: record.companionSession,
        provider: record.provider,
        model: record.model,
        providerSessionId: record.providerSessionId,
        promptVersion: record.promptVersion,
        status: record.status,
        utteranceCount: record._count.utterances,
        eventCount: record._count.events,
        startedAt: record.startedAt.toISOString(),
        firstResponseAt: record.firstResponseAt?.toISOString() ?? null,
        endedAt: record.endedAt?.toISOString() ?? null,
        endReason: record.endReason,
        errorCode: record.errorCode,
      })),
      total,
      pagination,
    );
  }

  async listRemoteSessions(
    query: PlatformPageQuery,
  ): Promise<PlatformPage<unknown>> {
    const pagination = this.pagination(query);
    const search = query.search?.trim();
    const where: Prisma.RemoteAssistanceSessionWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { id: { contains: search } },
              { householdId: { contains: search } },
              { recipientId: { contains: search } },
              { bindingId: { contains: search } },
              { endReason: { contains: search } },
            ],
          }
        : {}),
    };
    const [total, records] = await Promise.all([
      this.prisma.remoteAssistanceSession.count({ where }),
      this.prisma.remoteAssistanceSession.findMany({
        where,
        orderBy: [{ requestedAt: 'desc' }, { id: 'desc' }],
        skip: pagination.skip,
        take: pagination.limit,
        select: {
          id: true,
          householdId: true,
          recipientId: true,
          bindingId: true,
          initiatedByMemberId: true,
          answerMode: true,
          requestedMedia: true,
          status: true,
          requestedAt: true,
          acceptedAt: true,
          connectedAt: true,
          endedAt: true,
          endedByType: true,
          endedById: true,
          endReason: true,
          traceId: true,
          _count: { select: { participants: true, events: true } },
        },
      }),
    ]);

    return this.pageResult(
      records.map((record) => ({
        id: record.id,
        householdId: record.householdId,
        recipientId: record.recipientId,
        bindingId: record.bindingId,
        initiatedByMemberId: record.initiatedByMemberId,
        answerMode: record.answerMode,
        requestedMedia: record.requestedMedia,
        status: record.status,
        participantCount: record._count.participants,
        eventCount: record._count.events,
        requestedAt: record.requestedAt.toISOString(),
        acceptedAt: record.acceptedAt?.toISOString() ?? null,
        connectedAt: record.connectedAt?.toISOString() ?? null,
        endedAt: record.endedAt?.toISOString() ?? null,
        endedByType: record.endedByType,
        endedById: record.endedById,
        endReason: record.endReason,
        traceId: record.traceId,
      })),
      total,
      pagination,
    );
  }

  async listAuditLogs(
    query: PlatformPageQuery,
  ): Promise<PlatformPage<unknown>> {
    const pagination = this.pagination(query);
    const search = query.search?.trim();
    const where: Prisma.AuditLogWhereInput = {
      ...(search
        ? {
            OR: [
              { id: { contains: search } },
              { action: { contains: search } },
              { resourceType: { contains: search } },
              { resourceId: { contains: search } },
              { requestId: { contains: search } },
            ],
          }
        : {}),
      ...(query.status ? { decision: query.status } : {}),
    };
    const [total, records] = await Promise.all([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        skip: pagination.skip,
        take: pagination.limit,
        select: {
          id: true,
          occurredAt: true,
          environment: true,
          actorType: true,
          actorUserId: true,
          actorSessionId: true,
          actorRoleSnapshot: true,
          action: true,
          resourceType: true,
          resourceId: true,
          householdId: true,
          recipientId: true,
          requestId: true,
          traceId: true,
          purpose: true,
          reasonCode: true,
          ticketId: true,
          approvalActorId: true,
          decision: true,
          failureCode: true,
          policyVersion: true,
          previousEventHash: true,
          eventHash: true,
        },
      }),
    ]);

    return this.pageResult(
      records.map((record) => ({
        ...record,
        occurredAt: record.occurredAt.toISOString(),
        previousEventHash: record.previousEventHash
          ? Buffer.from(record.previousEventHash).toString('hex')
          : null,
        eventHash: Buffer.from(record.eventHash).toString('hex'),
      })),
      total,
      pagination,
    );
  }

  async listInspectionGrants(
    query: PlatformPageQuery & { householdId?: string },
  ): Promise<PlatformPage<unknown>> {
    this.inspectionPolicy.requireEnabled();
    const pagination = this.pagination(query);
    const where: Prisma.InspectionGrantWhereInput = {
      environment: CONTENT_INSPECTION_ENVIRONMENT,
      ...(query.status ? { status: query.status } : {}),
      ...(query.householdId ? { householdId: query.householdId } : {}),
    };
    const [total, records] = await Promise.all([
      this.prisma.inspectionGrant.count({ where }),
      this.prisma.inspectionGrant.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: pagination.skip,
        take: pagination.limit,
      }),
    ]);
    return this.pageResult(
      records.map((grant) => this.grantView(grant)),
      total,
      pagination,
    );
  }

  async requestInspectionGrant(
    command: RequestInspectionGrantCommand,
  ): Promise<Record<string, unknown>> {
    this.inspectionPolicy.requireEnabled();
    const now = new Date();
    const ttlSeconds = Math.min(
      Math.max(
        command.expiresInSeconds ?? CONTENT_INSPECTION_MAX_TTL_SECONDS,
        60,
      ),
      CONTENT_INSPECTION_MAX_TTL_SECONDS,
    );
    const id = newUlid(now.getTime());

    const grant = await this.retrySerializable(async (transaction) => {
      const household = await transaction.household.findUnique({
        where: { id: command.householdId },
        select: { id: true },
      });
      if (!household) {
        throw new InspectionResourceNotFoundException();
      }
      if (command.recipientId) {
        const recipient = await transaction.careRecipient.findFirst({
          where: {
            id: command.recipientId,
            householdId: command.householdId,
            deletedAt: null,
          },
          select: { id: true },
        });
        if (!recipient) {
          throw new InspectionResourceNotFoundException();
        }
      }

      const created = await transaction.inspectionGrant.create({
        data: {
          id,
          environment: CONTENT_INSPECTION_ENVIRONMENT,
          requestedByUserId: command.principal.userId,
          approvedByUserId: null,
          householdId: command.householdId,
          recipientId: command.recipientId ?? null,
          dataCategoriesJson: [...new Set(command.dataCategories)],
          reason: command.reason.trim(),
          ticketReference: command.ticketReference?.trim() || null,
          status: INSPECTION_GRANT_STATUS.pending,
          validFrom: now,
          expiresAt: new Date(now.getTime() + ttlSeconds * 1000),
          revokedAt: null,
          createdAt: now,
        },
      });
      await this.appendAudit(transaction, {
        principal: command.principal,
        request: command.request,
        action: 'INSPECTION_GRANT_REQUESTED',
        resourceType: 'INSPECTION_GRANT',
        resourceId: created.id,
        householdId: created.householdId,
        recipientId: created.recipientId ?? undefined,
        grant: created,
      });
      return created;
    });

    return this.grantView(grant);
  }

  async approveInspectionGrant(
    command: GrantMutationCommand,
  ): Promise<Record<string, unknown>> {
    this.inspectionPolicy.requireEnabled();
    const now = new Date();
    const grant = await this.retrySerializable(async (transaction) => {
      const current = await transaction.inspectionGrant.findUnique({
        where: { id: command.grantId },
      });
      if (!current || current.environment !== CONTENT_INSPECTION_ENVIRONMENT) {
        throw new InspectionGrantNotFoundException();
      }
      if (current.requestedByUserId === command.principal.userId) {
        throw new InspectionGrantSelfApprovalException();
      }
      if (
        current.status !== INSPECTION_GRANT_STATUS.pending ||
        current.revokedAt !== null ||
        current.expiresAt <= now
      ) {
        throw new InspectionGrantStateException();
      }

      const updated = await transaction.inspectionGrant.update({
        where: { id: current.id },
        data: {
          status: INSPECTION_GRANT_STATUS.active,
          approvedByUserId: command.principal.userId,
          validFrom: now,
        },
      });
      await this.appendAudit(transaction, {
        principal: command.principal,
        request: command.request,
        action: 'INSPECTION_GRANT_APPROVED',
        resourceType: 'INSPECTION_GRANT',
        resourceId: updated.id,
        householdId: updated.householdId,
        recipientId: updated.recipientId ?? undefined,
        grant: updated,
      });
      return updated;
    });
    return this.grantView(grant);
  }

  async revokeInspectionGrant(
    command: GrantMutationCommand,
  ): Promise<Record<string, unknown>> {
    this.inspectionPolicy.requireEnabled();
    const now = new Date();
    const grant = await this.retrySerializable(async (transaction) => {
      const current = await transaction.inspectionGrant.findUnique({
        where: { id: command.grantId },
      });
      if (!current || current.environment !== CONTENT_INSPECTION_ENVIRONMENT) {
        throw new InspectionGrantNotFoundException();
      }
      if (
        current.status === INSPECTION_GRANT_STATUS.revoked ||
        current.revokedAt !== null
      ) {
        throw new InspectionGrantStateException();
      }

      const updated = await transaction.inspectionGrant.update({
        where: { id: current.id },
        data: {
          status: INSPECTION_GRANT_STATUS.revoked,
          revokedAt: now,
        },
      });
      await this.appendAudit(transaction, {
        principal: command.principal,
        request: command.request,
        action: 'INSPECTION_GRANT_REVOKED',
        resourceType: 'INSPECTION_GRANT',
        resourceId: updated.id,
        householdId: updated.householdId,
        recipientId: updated.recipientId ?? undefined,
        grant: updated,
      });
      return updated;
    });
    return this.grantView(grant);
  }

  async inspectMemoryRevision(
    command: InspectMemoryCommand,
  ): Promise<Record<string, unknown>> {
    this.inspectionPolicy.requireEnabled();
    return this.retrySerializable(async (transaction) => {
      const memory = await transaction.memory.findFirst({
        where: { id: command.memoryId, deletedAt: null, status: 'ACTIVE' },
        select: {
          id: true,
          householdId: true,
          recipientId: true,
          kind: true,
          title: true,
          sensitivity: true,
          verificationStatus: true,
          currentRevisionNo: true,
        },
      });
      if (!memory) {
        throw new InspectionResourceNotFoundException();
      }
      const revision = command.revisionId
        ? await transaction.memoryRevision.findFirst({
            where: { id: command.revisionId, memoryId: memory.id },
          })
        : await transaction.memoryRevision.findUnique({
            where: {
              memoryId_revisionNo: {
                memoryId: memory.id,
                revisionNo: memory.currentRevisionNo,
              },
            },
          });
      if (!revision) {
        throw new InspectionResourceNotFoundException();
      }

      const grant = await this.requireEffectiveGrant(
        transaction,
        command.principal.userId,
        command.grantId,
        memory.householdId,
        memory.recipientId,
        'MEMORY_REVISION',
        new Date(),
      );
      const opened = this.encryption.openFields(
        {
          ciphertexts: {
            content: Buffer.from(revision.contentCiphertext),
          },
          contentHashes: { content: Buffer.from(revision.contentHash) },
          nonceSeed: Buffer.from(revision.contentNonce),
          keyId: revision.encryptionKeyId,
        },
        `memory:${memory.id}:revision:${revision.revisionNo}`,
      );
      if (opened.content === null) {
        throw new InspectionContentUnavailableException();
      }

      const watermark = await this.recordContentInspection(transaction, {
        principal: command.principal,
        request: command.request,
        action: 'MEMORY_REVISION_ORIGINAL_READ',
        resourceType: 'MEMORY_REVISION',
        resourceId: revision.id,
        householdId: memory.householdId,
        recipientId: memory.recipientId,
        grant,
      });
      return {
        id: revision.id,
        memoryId: memory.id,
        revisionNo: revision.revisionNo,
        kind: memory.kind,
        title: memory.title,
        sensitivity: memory.sensitivity,
        verificationStatus: memory.verificationStatus,
        source: revision.source,
        content: opened.content,
        createdAt: revision.createdAt.toISOString(),
        watermark,
      };
    });
  }

  async inspectUtterance(
    command: InspectUtteranceCommand,
  ): Promise<Record<string, unknown>> {
    this.inspectionPolicy.requireEnabled();
    return this.retrySerializable(async (transaction) => {
      const utterance = await transaction.conversationUtterance.findUnique({
        where: { id: command.utteranceId },
        select: {
          id: true,
          modelSessionId: true,
          sequenceNo: true,
          speaker: true,
          isFinal: true,
          language: true,
          confidence: true,
          createdAt: true,
          content: true,
          modelSession: {
            select: {
              companionSession: {
                select: { householdId: true, recipientId: true },
              },
            },
          },
        },
      });
      if (!utterance) {
        throw new InspectionResourceNotFoundException();
      }
      const content = utterance.content;
      const now = new Date();
      if (
        !content ||
        content.purgedAt !== null ||
        (content.retentionUntil !== null && content.retentionUntil <= now) ||
        content.rawTextCiphertext === null ||
        content.contentHash === null ||
        content.nonce === null ||
        content.encryptionKeyId === null
      ) {
        throw new InspectionContentUnavailableException();
      }
      const scope = utterance.modelSession.companionSession;
      const grant = await this.requireEffectiveGrant(
        transaction,
        command.principal.userId,
        command.grantId,
        scope.householdId,
        scope.recipientId,
        'CONVERSATION_UTTERANCE',
        now,
      );
      const opened = this.encryption.openFields(
        {
          ciphertexts: {
            rawText: Buffer.from(content.rawTextCiphertext),
          },
          contentHashes: { rawText: Buffer.from(content.contentHash) },
          nonceSeed: Buffer.from(content.nonce),
          keyId: content.encryptionKeyId,
        },
        utteranceEncryptionContext(utterance.id),
      );
      if (opened.rawText === null) {
        throw new InspectionContentUnavailableException();
      }

      const watermark = await this.recordContentInspection(transaction, {
        principal: command.principal,
        request: command.request,
        action: 'CONVERSATION_UTTERANCE_ORIGINAL_READ',
        resourceType: 'CONVERSATION_UTTERANCE',
        resourceId: utterance.id,
        householdId: scope.householdId,
        recipientId: scope.recipientId,
        grant,
      });
      return {
        id: utterance.id,
        modelSessionId: utterance.modelSessionId,
        sequenceNo: utterance.sequenceNo,
        speaker: utterance.speaker,
        isFinal: utterance.isFinal,
        language: utterance.language,
        confidence: utterance.confidence,
        rawText: opened.rawText,
        charCount: content.charCount,
        createdAt: utterance.createdAt.toISOString(),
        watermark,
      };
    });
  }

  private async requireEffectiveGrant(
    transaction: Prisma.TransactionClient,
    operatorUserId: string,
    grantId: string,
    householdId: string,
    recipientId: string,
    category: InspectionDataCategory,
    now: Date,
  ): Promise<InspectionGrant> {
    const grant = await transaction.inspectionGrant.findUnique({
      where: { id: grantId },
    });
    if (!grant) {
      throw new InspectionGrantNotFoundException();
    }
    const categories = this.inspectionCategories(grant.dataCategoriesJson);
    if (
      grant.environment !== CONTENT_INSPECTION_ENVIRONMENT ||
      grant.requestedByUserId !== operatorUserId ||
      grant.householdId !== householdId ||
      (grant.recipientId !== null && grant.recipientId !== recipientId) ||
      !categories.includes(category)
    ) {
      throw new InspectionGrantScopeDeniedException();
    }
    if (
      grant.status !== INSPECTION_GRANT_STATUS.active ||
      grant.approvedByUserId === null ||
      grant.approvedByUserId === grant.requestedByUserId ||
      grant.revokedAt !== null ||
      grant.validFrom > now ||
      grant.expiresAt <= now
    ) {
      throw new InspectionGrantStateException(
        '内容检查授权尚未批准、已撤销或已过期',
      );
    }

    const consent = await transaction.recipientConsentState.findUnique({
      where: {
        recipientId_scope: {
          recipientId,
          scope: CONTENT_INSPECTION_CONSENT_SCOPE,
        },
      },
      select: { householdId: true, decision: true },
    });
    if (
      !consent ||
      consent.householdId !== householdId ||
      consent.decision !== 'GRANTED'
    ) {
      throw new ContentInspectionConsentRequiredException();
    }
    return grant;
  }

  private async recordContentInspection(
    transaction: Prisma.TransactionClient,
    input: InspectionAuditInput,
  ): Promise<InspectionWatermark> {
    const occurredAt = new Date();
    const requestId = this.auditRequestId(input.request.requestId);
    const inspectionId = newUlid(occurredAt.getTime());
    await transaction.contentInspection.create({
      data: {
        id: inspectionId,
        grantId: input.grant.id,
        operatorUserId: input.principal.userId,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        originalRevealed: true,
        requestId,
        occurredAt,
      },
    });
    await this.appendAudit(transaction, input, occurredAt);
    await this.notifications.enqueueInspectionPerformed(transaction, {
      inspectionId,
      householdId: input.householdId,
      recipientId: input.recipientId,
      category: input.resourceType,
      reason: input.grant.reason,
      occurredAt,
    });
    return {
      operatorUserId: input.principal.userId,
      grantId: input.grant.id,
      requestId,
      occurredAt: occurredAt.toISOString(),
    };
  }

  private async appendAudit(
    transaction: Prisma.TransactionClient,
    input: AuditAppendInput,
    occurredAt = new Date(),
  ): Promise<void> {
    const previous = await transaction.auditLog.findFirst({
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
      select: { eventHash: true },
    });
    const id = newUlid(occurredAt.getTime());
    const roles = [...input.principal.platformRoles].sort();
    const requestId = this.auditRequestId(input.request.requestId);
    if (input.request.sourceIpHash.byteLength !== 32) {
      throw new Error('Platform audit source IP hash must be 32 bytes');
    }
    const sourceIpHash = Uint8Array.from(input.request.sourceIpHash);
    const hashPayload = {
      id,
      occurredAt: occurredAt.toISOString(),
      environment: CONTENT_INSPECTION_ENVIRONMENT,
      actorType: 'USER',
      actorUserId: input.principal.userId,
      actorSessionId: input.principal.sessionId,
      actorRoles: roles,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      householdId: input.householdId ?? null,
      recipientId: input.recipientId ?? null,
      requestId,
      sourceIpHash: Buffer.from(sourceIpHash).toString('base64url'),
      grantId: input.grant?.id ?? null,
      approvalActorId: input.grant?.approvedByUserId ?? null,
      decision: 'ALLOW',
      policyVersion: 'development-content-inspection-v1',
    };
    const previousHash = previous
      ? Buffer.from(previous.eventHash)
      : Buffer.alloc(32);
    const eventHash = createHash('sha256')
      .update(previousHash)
      .update(JSON.stringify(hashPayload), 'utf8')
      .digest();

    await transaction.auditLog.create({
      data: {
        id,
        occurredAt,
        environment: CONTENT_INSPECTION_ENVIRONMENT,
        actorType: 'USER',
        actorUserId: input.principal.userId,
        actorBindingId: null,
        actorSessionId: input.principal.sessionId,
        actorRoleSnapshot: roles,
        sourceIpHash,
        userAgent: input.request.userAgent?.slice(0, 512) ?? null,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        householdId: input.householdId ?? null,
        recipientId: input.recipientId ?? null,
        targetDeviceId: null,
        requestId,
        traceId: null,
        purpose: input.grant?.reason.slice(0, 100) ?? null,
        reasonCode: null,
        ticketId: input.grant?.id ?? null,
        approvalActorId: input.grant?.approvedByUserId ?? null,
        decision: 'ALLOW',
        failureCode: null,
        policyVersion: 'development-content-inspection-v1',
        beforeHash: null,
        afterHash: null,
        previousEventHash: previous
          ? Uint8Array.from(previous.eventHash)
          : null,
        eventHash: Uint8Array.from(eventHash),
        retentionUntil: null,
      },
    });
  }

  private inspectionCategories(value: Prisma.JsonValue): string[] {
    if (!Array.isArray(value)) {
      return [];
    }
    return value.filter((item): item is string => typeof item === 'string');
  }

  private grantView(grant: InspectionGrant): Record<string, unknown> {
    const now = new Date();
    const effectiveStatus =
      grant.status !== INSPECTION_GRANT_STATUS.revoked && grant.expiresAt <= now
        ? 'EXPIRED'
        : grant.status;
    return {
      id: grant.id,
      environment: grant.environment,
      requestedByUserId: grant.requestedByUserId,
      approvedByUserId: grant.approvedByUserId,
      householdId: grant.householdId,
      recipientId: grant.recipientId,
      dataCategories: this.inspectionCategories(grant.dataCategoriesJson),
      reason: grant.reason,
      ticketReference: grant.ticketReference,
      status: effectiveStatus,
      validFrom: grant.validFrom.toISOString(),
      expiresAt: grant.expiresAt.toISOString(),
      revokedAt: grant.revokedAt?.toISOString() ?? null,
      createdAt: grant.createdAt.toISOString(),
    };
  }

  private pagination(query: PlatformPageQuery): {
    page: number;
    limit: number;
    skip: number;
  } {
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(
      Math.max(query.limit ?? PLATFORM_PAGE_DEFAULT, 1),
      PLATFORM_PAGE_MAX,
    );
    return { page, limit, skip: (page - 1) * limit };
  }

  private pageResult<T>(
    items: T[],
    total: number,
    pagination: { page: number; limit: number },
  ): PlatformPage<T> {
    return {
      items,
      page: pagination.page,
      limit: pagination.limit,
      total,
      hasNext: pagination.page * pagination.limit < total,
    };
  }

  private maskIdentity(type: string, value: string): string {
    if (type === 'EMAIL') {
      const separator = value.lastIndexOf('@');
      if (separator > 0) {
        return `${value.slice(0, 1)}***${value.slice(separator)}`;
      }
    }
    if (value.length <= 2) {
      return '**';
    }
    return `${value.slice(0, 2)}***`;
  }

  private auditRequestId(requestId: string): string {
    if (requestId.length <= 64) {
      return requestId;
    }
    const digest = createHash('sha256').update(requestId).digest('hex');
    return `${requestId.slice(0, 31)}:${digest.slice(0, 32)}`;
  }

  private async retrySerializable<T>(
    operation: (transaction: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let lastError: unknown;
    for (
      let attempt = 0;
      attempt < AUDIT_SERIALIZABLE_RETRY_LIMIT;
      attempt += 1
    ) {
      try {
        return await this.prisma.$transaction(operation, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        });
      } catch (error) {
        lastError = error;
        if (!this.isSerializableConflict(error)) {
          throw error;
        }
      }
    }
    throw lastError;
  }

  private isSerializableConflict(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'P2034'
    );
  }
}
