import {
  Inject,
  Injectable,
  InternalServerErrorException,
} from '@nestjs/common';

import type { Prisma } from '../../infrastructure/database/generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import { newUlid } from '../identity/domain/ulid';
import {
  DATA_ENCRYPTION_PORT,
  MEMORY_PAGE_DEFAULT,
  MEMORY_PAGE_MAX,
  MEMORY_STATUS,
} from './memory.constants';
import {
  InvalidMemoryCursorException,
  MemoryNotFoundException,
  MemoryVersionConflictException,
} from './memory.errors';
import type {
  CreateMemoryCommand,
  ListMemoriesQuery,
  MemoryPage,
  MemoryRevisionView,
  MemoryView,
  UpdateMemoryCommand,
} from './memory.types';
import type { DataEncryptionPort } from './ports/data-encryption.port';

type DatabaseClient = PrismaService | Prisma.TransactionClient;

interface MemoryRevisionRecord {
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

interface MemoryRecord {
  id: string;
  householdId: string;
  recipientId: string;
  kind: string;
  title: string;
  sensitivity: string;
  verificationStatus: string;
  status: string;
  currentRevisionNo: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
  version: number;
  revisions: MemoryRevisionRecord[];
}

@Injectable()
export class MemoryApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: HouseholdAccessPolicy,
    @Inject(DATA_ENCRYPTION_PORT)
    private readonly encryption: DataEncryptionPort,
  ) {}

  async list(query: ListMemoriesQuery): Promise<MemoryPage> {
    await this.policy.requireRecipientAction(
      this.prisma,
      query.principal.userId,
      query.householdId,
      query.recipientId,
      'VIEW_RECIPIENT',
    );
    const limit = Math.min(
      Math.max(query.limit ?? MEMORY_PAGE_DEFAULT, 1),
      MEMORY_PAGE_MAX,
    );
    if (query.cursor) {
      const cursor = await this.prisma.memory.findFirst({
        where: {
          id: query.cursor,
          householdId: query.householdId,
          recipientId: query.recipientId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (!cursor) {
        throw new InvalidMemoryCursorException();
      }
    }

    const records = (await this.prisma.memory.findMany({
      where: {
        householdId: query.householdId,
        recipientId: query.recipientId,
        deletedAt: null,
      },
      include: {
        revisions: { orderBy: { revisionNo: 'desc' }, take: 1 },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })) as MemoryRecord[];
    const hasNextPage = records.length > limit;
    const page = hasNextPage ? records.slice(0, limit) : records;

    return {
      items: page.map((memory) => this.toMemoryView(memory)),
      nextCursor: hasNextPage ? (page.at(-1)?.id ?? null) : null,
    };
  }

  async create(command: CreateMemoryCommand): Promise<MemoryView> {
    const now = new Date();
    const memoryId = newUlid(now.getTime());
    const revisionId = newUlid(now.getTime());
    const sealed = this.encryption.sealFields(
      { content: command.content.trim() },
      this.revisionContext(memoryId, 1),
    );

    const created = await this.prisma.$transaction(async (transaction) => {
      const actor = await this.policy.requireRecipientAction(
        transaction,
        command.principal.userId,
        command.householdId,
        command.recipientId,
        'MANAGE_RECIPIENT',
      );
      await transaction.memory.create({
        data: {
          id: memoryId,
          householdId: command.householdId,
          recipientId: command.recipientId,
          kind: command.kind.trim(),
          title: command.title.trim(),
          sensitivity: command.sensitivity,
          verificationStatus: command.verificationStatus,
          status: MEMORY_STATUS.active,
          currentRevisionNo: 1,
          createdByMemberId: actor.id,
          createdAt: now,
          updatedAt: now,
        },
      });
      await transaction.memoryRevision.create({
        data: {
          id: revisionId,
          memoryId,
          revisionNo: 1,
          contentCiphertext: this.toPrismaBytes(
            this.requireBuffer(sealed.ciphertexts.content),
          ),
          contentNonce: this.toPrismaBytes(sealed.nonceSeed),
          encryptionKeyId: sealed.keyId,
          contentHash: this.toPrismaBytes(
            this.requireBuffer(sealed.contentHashes.content),
          ),
          source: command.source?.trim() || 'FAMILY',
          changeReason: null,
          createdByMemberId: actor.id,
          createdAt: now,
        },
      });

      return this.requireMemory(transaction, command.householdId, memoryId);
    });

    return this.toMemoryView(created);
  }

  async get(
    userId: string,
    householdId: string,
    memoryId: string,
  ): Promise<MemoryView> {
    const memory = await this.requirePathOwnedMemory(
      this.prisma,
      userId,
      householdId,
      memoryId,
      'VIEW_RECIPIENT',
    );
    return this.toMemoryView(memory);
  }

  async update(command: UpdateMemoryCommand): Promise<MemoryView> {
    const updatedMemory = await this.prisma.$transaction(
      async (transaction) => {
        const current = await this.requirePathOwnedMemory(
          transaction,
          command.principal.userId,
          command.householdId,
          command.memoryId,
          'MANAGE_RECIPIENT',
        );
        if (current.version !== command.version) {
          throw new MemoryVersionConflictException();
        }
        const currentRevision = this.currentRevision(current);
        const currentPlaintext = this.openRevision(currentRevision).content;
        const revisionNo = current.currentRevisionNo + 1;
        const now = new Date();
        const sealed = this.encryption.sealFields(
          { content: command.content?.trim() ?? currentPlaintext },
          this.revisionContext(current.id, revisionNo),
        );

        const updated = await transaction.memory.updateMany({
          where: {
            id: current.id,
            householdId: command.householdId,
            version: command.version,
            deletedAt: null,
          },
          data: {
            ...(command.kind === undefined
              ? {}
              : { kind: command.kind.trim() }),
            ...(command.title === undefined
              ? {}
              : { title: command.title.trim() }),
            ...(command.sensitivity === undefined
              ? {}
              : { sensitivity: command.sensitivity }),
            ...(command.verificationStatus === undefined
              ? {}
              : { verificationStatus: command.verificationStatus }),
            currentRevisionNo: revisionNo,
            updatedAt: now,
            version: { increment: 1 },
          },
        });
        if (updated.count !== 1) {
          throw new MemoryVersionConflictException();
        }
        const actor = await this.policy.requireRecipientAction(
          transaction,
          command.principal.userId,
          command.householdId,
          current.recipientId,
          'MANAGE_RECIPIENT',
        );
        await transaction.memoryRevision.create({
          data: {
            id: newUlid(now.getTime()),
            memoryId: current.id,
            revisionNo,
            contentCiphertext: this.toPrismaBytes(
              this.requireBuffer(sealed.ciphertexts.content),
            ),
            contentNonce: this.toPrismaBytes(sealed.nonceSeed),
            encryptionKeyId: sealed.keyId,
            contentHash: this.toPrismaBytes(
              this.requireBuffer(sealed.contentHashes.content),
            ),
            source: 'FAMILY',
            changeReason: command.changeReason?.trim() || null,
            createdByMemberId: actor.id,
            createdAt: now,
          },
        });
        return this.requireMemory(transaction, command.householdId, current.id);
      },
      { isolationLevel: 'Serializable' },
    );
    return this.toMemoryView(updatedMemory);
  }

  async remove(
    userId: string,
    householdId: string,
    memoryId: string,
    version: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const memory = await this.requirePathOwnedMemory(
        transaction,
        userId,
        householdId,
        memoryId,
        'MANAGE_RECIPIENT',
      );
      if (memory.version !== version) {
        throw new MemoryVersionConflictException();
      }
      const removed = await transaction.memory.updateMany({
        where: { id: memoryId, householdId, version, deletedAt: null },
        data: {
          status: MEMORY_STATUS.deleted,
          deletedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (removed.count !== 1) {
        throw new MemoryVersionConflictException();
      }
    });
  }

  async listRevisions(
    userId: string,
    householdId: string,
    memoryId: string,
  ): Promise<MemoryRevisionView[]> {
    const memory = await this.requirePathOwnedMemory(
      this.prisma,
      userId,
      householdId,
      memoryId,
      'VIEW_RECIPIENT',
      true,
    );
    return memory.revisions
      .slice()
      .sort((left, right) => right.revisionNo - left.revisionNo)
      .map((revision) => this.toRevisionView(revision));
  }

  private async requirePathOwnedMemory(
    client: DatabaseClient,
    userId: string,
    householdId: string,
    memoryId: string,
    action: 'VIEW_RECIPIENT' | 'MANAGE_RECIPIENT',
    allRevisions = false,
  ): Promise<MemoryRecord> {
    await this.policy.requireHouseholdAction(
      client,
      userId,
      householdId,
      'VIEW_HOUSEHOLD',
    );
    const memory = (await client.memory.findFirst({
      where: { id: memoryId, householdId, deletedAt: null },
      include: {
        revisions: allRevisions
          ? { orderBy: { revisionNo: 'desc' } }
          : { orderBy: { revisionNo: 'desc' }, take: 1 },
      },
    })) as MemoryRecord | null;
    if (!memory) {
      throw new MemoryNotFoundException();
    }
    await this.policy.requireRecipientAction(
      client,
      userId,
      householdId,
      memory.recipientId,
      action,
    );
    return memory;
  }

  private async requireMemory(
    client: DatabaseClient,
    householdId: string,
    memoryId: string,
  ): Promise<MemoryRecord> {
    const memory = (await client.memory.findFirst({
      where: { id: memoryId, householdId, deletedAt: null },
      include: {
        revisions: { orderBy: { revisionNo: 'desc' }, take: 1 },
      },
    })) as MemoryRecord | null;
    if (!memory) {
      throw new MemoryNotFoundException();
    }
    return memory;
  }

  private currentRevision(memory: MemoryRecord): MemoryRevisionRecord {
    const revision = memory.revisions.find(
      (candidate) => candidate.revisionNo === memory.currentRevisionNo,
    );
    if (!revision) {
      throw new InternalServerErrorException({
        code: 'MEMORY_REVISION_MISSING',
        message: '记忆版本数据不完整',
      });
    }
    return revision;
  }

  private toMemoryView(memory: MemoryRecord): MemoryView {
    return {
      id: memory.id,
      householdId: memory.householdId,
      recipientId: memory.recipientId,
      kind: memory.kind,
      title: memory.title,
      sensitivity: memory.sensitivity,
      verificationStatus: memory.verificationStatus,
      status: memory.status,
      currentRevision: this.toRevisionView(this.currentRevision(memory)),
      createdAt: memory.createdAt.toISOString(),
      updatedAt: memory.updatedAt.toISOString(),
      version: memory.version,
    };
  }

  private toRevisionView(revision: MemoryRevisionRecord): MemoryRevisionView {
    return {
      id: revision.id,
      revisionNo: revision.revisionNo,
      content: this.openRevision(revision).content,
      source: revision.source,
      changeReason: revision.changeReason,
      createdByMemberId: revision.createdByMemberId,
      createdAt: revision.createdAt.toISOString(),
    };
  }

  private openRevision(revision: MemoryRevisionRecord): { content: string } {
    const opened = this.encryption.openFields(
      {
        ciphertexts: { content: Buffer.from(revision.contentCiphertext) },
        contentHashes: { content: Buffer.from(revision.contentHash) },
        nonceSeed: Buffer.from(revision.contentNonce),
        keyId: revision.encryptionKeyId,
      },
      this.revisionContext(revision.memoryId, revision.revisionNo),
    );
    if (opened.content === null) {
      throw new InternalServerErrorException({
        code: 'MEMORY_REVISION_CONTENT_MISSING',
        message: '记忆正文缺失',
      });
    }
    return { content: opened.content };
  }

  private revisionContext(memoryId: string, revisionNo: number): string {
    return `memory:${memoryId}:revision:${revisionNo}`;
  }

  private requireBuffer(value: Buffer | null): Buffer {
    if (!value) {
      throw new InternalServerErrorException({
        code: 'DATA_ENCRYPTION_FAILED',
        message: '敏感数据加密失败',
      });
    }
    return value;
  }

  private toPrismaBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(value);
  }
}
