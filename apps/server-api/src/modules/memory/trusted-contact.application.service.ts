import { Inject, Injectable } from '@nestjs/common';

import {
  Prisma,
  type TrustedContact,
} from '../../infrastructure/database/generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import { newUlid } from '../identity/domain/ulid';
import { DATA_ENCRYPTION_PORT } from './memory.constants';
import {
  MemoryVersionConflictException,
  TrustedContactNotFoundException,
} from './memory.errors';
import type {
  CreateTrustedContactCommand,
  TrustedContactView,
  UpdateTrustedContactCommand,
} from './memory.types';
import type { DataEncryptionPort } from './ports/data-encryption.port';

const context = (id: string) => `trusted-contact:${id}`;

@Injectable()
export class TrustedContactApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly householdAccess: HouseholdAccessPolicy,
    @Inject(DATA_ENCRYPTION_PORT)
    private readonly encryption: DataEncryptionPort,
  ) {}

  async list(
    userId: string,
    householdId: string,
    recipientId: string,
  ): Promise<TrustedContactView[]> {
    await this.householdAccess.requireRecipientAction(
      this.prisma,
      userId,
      householdId,
      recipientId,
      'VIEW_RECIPIENT',
    );
    const rows = await this.prisma.trustedContact.findMany({
      where: { householdId, recipientId },
      orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((row) => this.toView(row));
  }

  async create(
    command: CreateTrustedContactCommand,
  ): Promise<TrustedContactView> {
    await this.householdAccess.requireRecipientAction(
      this.prisma,
      command.principal.userId,
      command.householdId,
      command.recipientId,
      'MANAGE_RECIPIENT',
    );
    await this.requireLinkedMember(
      command.householdId,
      command.householdMemberId,
    );
    const id = newUlid();
    const sealed = this.seal(id, command.phone, command.email);
    const now = new Date();
    const row = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.trustedContact.create({
        data: {
          id,
          householdId: command.householdId,
          recipientId: command.recipientId,
          householdMemberId: command.householdMemberId ?? null,
          name: command.name.trim(),
          relationshipLabel: command.relationshipLabel.trim(),
          phoneCiphertext: sealed.phone,
          emailCiphertext: sealed.email,
          contactNonce: sealed.nonce,
          encryptionKeyId: sealed.keyId,
          priority: command.priority,
          canViewEvidence: command.canViewEvidence,
        },
      });
      await this.outbox(transaction, created, 'trusted-contact.created', now);
      return created;
    });
    return this.toView(row);
  }

  async update(
    command: UpdateTrustedContactCommand,
  ): Promise<TrustedContactView> {
    const current = await this.prisma.trustedContact.findFirst({
      where: { id: command.contactId, householdId: command.householdId },
    });
    if (!current) {
      throw new TrustedContactNotFoundException();
    }
    await this.householdAccess.requireRecipientAction(
      this.prisma,
      command.principal.userId,
      command.householdId,
      current.recipientId,
      'MANAGE_RECIPIENT',
    );
    await this.requireLinkedMember(
      command.householdId,
      command.householdMemberId,
    );
    const opened = this.open(current);
    const sealed = this.seal(
      current.id,
      command.phone === undefined ? opened.phone : command.phone,
      command.email === undefined ? opened.email : command.email,
    );
    const now = new Date();
    const updated = await this.prisma.$transaction(async (transaction) => {
      const changed = await transaction.trustedContact.updateMany({
        where: {
          id: current.id,
          householdId: command.householdId,
          version: command.version,
        },
        data: {
          ...(command.householdMemberId !== undefined
            ? { householdMemberId: command.householdMemberId }
            : {}),
          ...(command.name !== undefined ? { name: command.name.trim() } : {}),
          ...(command.relationshipLabel !== undefined
            ? { relationshipLabel: command.relationshipLabel.trim() }
            : {}),
          phoneCiphertext: sealed.phone,
          emailCiphertext: sealed.email,
          contactNonce: sealed.nonce,
          encryptionKeyId: sealed.keyId,
          ...(command.priority !== undefined
            ? { priority: command.priority }
            : {}),
          ...(command.canViewEvidence !== undefined
            ? { canViewEvidence: command.canViewEvidence }
            : {}),
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        throw new MemoryVersionConflictException();
      }
      const row = await transaction.trustedContact.findUnique({
        where: { id: current.id },
      });
      if (!row) {
        throw new TrustedContactNotFoundException();
      }
      await this.outbox(transaction, row, 'trusted-contact.updated', now);
      return row;
    });
    return this.toView(updated);
  }

  async remove(
    userId: string,
    householdId: string,
    contactId: string,
    version: number,
  ): Promise<void> {
    const current = await this.prisma.trustedContact.findFirst({
      where: { id: contactId, householdId },
    });
    if (!current) {
      throw new TrustedContactNotFoundException();
    }
    await this.householdAccess.requireRecipientAction(
      this.prisma,
      userId,
      householdId,
      current.recipientId,
      'MANAGE_RECIPIENT',
    );
    const now = new Date();
    await this.prisma.$transaction(async (transaction) => {
      const deleted = await transaction.trustedContact.deleteMany({
        where: { id: contactId, householdId, version },
      });
      if (deleted.count !== 1) {
        throw new MemoryVersionConflictException();
      }
      await this.outbox(transaction, current, 'trusted-contact.deleted', now);
    });
  }

  private async requireLinkedMember(
    householdId: string,
    memberId: string | null | undefined,
  ): Promise<void> {
    if (memberId === undefined || memberId === null) {
      return;
    }
    const member = await this.prisma.householdMember.findFirst({
      where: { id: memberId, householdId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!member) {
      throw new TrustedContactNotFoundException();
    }
  }

  private seal(id: string, phone?: string | null, email?: string | null) {
    const sealed = this.encryption.sealFields(
      {
        phone: phone?.trim() || null,
        email: email?.trim().toLowerCase() || null,
      },
      context(id),
    );
    return {
      phone: sealed.ciphertexts.phone
        ? Uint8Array.from(sealed.ciphertexts.phone)
        : null,
      email: sealed.ciphertexts.email
        ? Uint8Array.from(sealed.ciphertexts.email)
        : null,
      nonce: Uint8Array.from(sealed.nonceSeed),
      keyId: sealed.keyId,
    };
  }

  private open(row: TrustedContact): {
    phone: string | null;
    email: string | null;
  } {
    if (!row.contactNonce || !row.encryptionKeyId) {
      return { phone: null, email: null };
    }
    return this.encryption.openFields(
      {
        ciphertexts: {
          phone: row.phoneCiphertext ? Buffer.from(row.phoneCiphertext) : null,
          email: row.emailCiphertext ? Buffer.from(row.emailCiphertext) : null,
        },
        nonceSeed: Buffer.from(row.contactNonce),
        keyId: row.encryptionKeyId,
      },
      context(row.id),
    );
  }

  private toView(row: TrustedContact): TrustedContactView {
    const opened = this.open(row);
    return {
      id: row.id,
      householdId: row.householdId,
      recipientId: row.recipientId,
      householdMemberId: row.householdMemberId,
      name: row.name,
      relationshipLabel: row.relationshipLabel,
      phone: opened.phone,
      email: opened.email,
      priority: row.priority,
      canViewEvidence: row.canViewEvidence,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      version: row.version,
    };
  }

  private outbox(
    transaction: Prisma.TransactionClient,
    row: Pick<TrustedContact, 'id' | 'householdId' | 'recipientId'>,
    eventType: string,
    now: Date,
  ) {
    return transaction.outboxEvent.create({
      data: {
        id: newUlid(),
        aggregateType: 'TrustedContact',
        aggregateId: row.id,
        eventType,
        payloadJson: {
          contactId: row.id,
          householdId: row.householdId,
          recipientId: row.recipientId,
        },
        occurredAt: now,
        availableAt: now,
      },
    });
  }
}
