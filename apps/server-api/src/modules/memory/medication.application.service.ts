import { Inject, Injectable } from '@nestjs/common';

import type { Prisma } from '../../infrastructure/database/generated/prisma/client';
import { PrismaService } from '../../infrastructure/database/prisma.service';
import { HouseholdAccessPolicy } from '../household/domain/household-access.policy';
import { newUlid } from '../identity/domain/ulid';
import { DATA_ENCRYPTION_PORT, MEDICATION_STATUS } from './memory.constants';
import {
  DataDecryptionException,
  MedicationNotFoundException,
  MemoryVersionConflictException,
} from './memory.errors';
import type {
  CreateMedicationCommand,
  MedicationView,
  UpdateMedicationCommand,
} from './memory.types';
import type { DataEncryptionPort } from './ports/data-encryption.port';

type DatabaseClient = PrismaService | Prisma.TransactionClient;
type MedicationSecretField = 'purpose' | 'requirements';

interface MedicationRecord {
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

@Injectable()
export class MedicationApplicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: HouseholdAccessPolicy,
    @Inject(DATA_ENCRYPTION_PORT)
    private readonly encryption: DataEncryptionPort,
  ) {}

  async list(
    userId: string,
    householdId: string,
    recipientId: string,
  ): Promise<MedicationView[]> {
    await this.policy.requireRecipientAction(
      this.prisma,
      userId,
      householdId,
      recipientId,
      'VIEW_RECIPIENT',
    );
    const medications = (await this.prisma.medication.findMany({
      where: { householdId, recipientId, deletedAt: null },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    })) as MedicationRecord[];
    return medications.map((medication) => this.toView(medication));
  }

  async create(command: CreateMedicationCommand): Promise<MedicationView> {
    const now = new Date();
    const medicationId = newUlid(now.getTime());
    const sealed = this.encryption.sealFields<MedicationSecretField>(
      {
        purpose: this.normalizedNullable(command.purpose),
        requirements: this.normalizedNullable(command.requirements),
      },
      this.encryptionContext(medicationId, 0),
    );

    const created = await this.prisma.$transaction(async (transaction) => {
      await this.policy.requireRecipientAction(
        transaction,
        command.principal.userId,
        command.householdId,
        command.recipientId,
        'MANAGE_RECIPIENT',
      );
      return transaction.medication.create({
        data: {
          id: medicationId,
          householdId: command.householdId,
          recipientId: command.recipientId,
          name: command.name.trim(),
          alias: this.normalizedNullable(command.alias),
          purposeCiphertext: this.toPrismaBytesOrNull(
            sealed.ciphertexts.purpose,
          ),
          requirementsCiphertext: this.toPrismaBytesOrNull(
            sealed.ciphertexts.requirements,
          ),
          contentNonce: this.toPrismaBytes(sealed.nonceSeed),
          encryptionKeyId: sealed.keyId,
          containerLabel: this.normalizedNullable(command.containerLabel),
          containerLocation: this.normalizedNullable(command.containerLocation),
          status: MEDICATION_STATUS.active,
          createdAt: now,
          updatedAt: now,
        },
      });
    });
    return this.toView(created);
  }

  update(command: UpdateMedicationCommand): Promise<MedicationView> {
    return this.prisma
      .$transaction(
        async (transaction) => {
          const current = await this.requirePathOwnedMedication(
            transaction,
            command.principal.userId,
            command.householdId,
            command.medicationId,
            'MANAGE_RECIPIENT',
          );
          if (current.version !== command.version) {
            throw new MemoryVersionConflictException();
          }
          const existingSecrets = this.openSecrets(current);
          const nextVersion = current.version + 1;
          const sealed = this.encryption.sealFields<MedicationSecretField>(
            {
              purpose:
                command.purpose === undefined
                  ? existingSecrets.purpose
                  : this.normalizedNullable(command.purpose),
              requirements:
                command.requirements === undefined
                  ? existingSecrets.requirements
                  : this.normalizedNullable(command.requirements),
            },
            this.encryptionContext(current.id, nextVersion),
          );
          const updated = await transaction.medication.updateMany({
            where: {
              id: current.id,
              householdId: command.householdId,
              version: command.version,
              deletedAt: null,
            },
            data: {
              ...(command.name === undefined
                ? {}
                : { name: command.name.trim() }),
              ...(command.alias === undefined
                ? {}
                : { alias: this.normalizedNullable(command.alias) }),
              purposeCiphertext: this.toPrismaBytesOrNull(
                sealed.ciphertexts.purpose,
              ),
              requirementsCiphertext: this.toPrismaBytesOrNull(
                sealed.ciphertexts.requirements,
              ),
              contentNonce: this.toPrismaBytes(sealed.nonceSeed),
              encryptionKeyId: sealed.keyId,
              ...(command.containerLabel === undefined
                ? {}
                : {
                    containerLabel: this.normalizedNullable(
                      command.containerLabel,
                    ),
                  }),
              ...(command.containerLocation === undefined
                ? {}
                : {
                    containerLocation: this.normalizedNullable(
                      command.containerLocation,
                    ),
                  }),
              updatedAt: new Date(),
              version: { increment: 1 },
            },
          });
          if (updated.count !== 1) {
            throw new MemoryVersionConflictException();
          }
          return this.requireMedication(
            transaction,
            command.householdId,
            current.id,
          );
        },
        { isolationLevel: 'Serializable' },
      )
      .then((medication) => this.toView(medication));
  }

  async remove(
    userId: string,
    householdId: string,
    medicationId: string,
    version: number,
  ): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const medication = await this.requirePathOwnedMedication(
        transaction,
        userId,
        householdId,
        medicationId,
        'MANAGE_RECIPIENT',
      );
      if (medication.version !== version) {
        throw new MemoryVersionConflictException();
      }
      const updated = await transaction.medication.updateMany({
        where: {
          id: medication.id,
          householdId,
          version,
          deletedAt: null,
        },
        data: {
          status: MEDICATION_STATUS.deleted,
          deletedAt: new Date(),
          version: { increment: 1 },
        },
      });
      if (updated.count !== 1) {
        throw new MemoryVersionConflictException();
      }
    });
  }

  private async requirePathOwnedMedication(
    client: DatabaseClient,
    userId: string,
    householdId: string,
    medicationId: string,
    action: 'VIEW_RECIPIENT' | 'MANAGE_RECIPIENT',
  ): Promise<MedicationRecord> {
    await this.policy.requireHouseholdAction(
      client,
      userId,
      householdId,
      'VIEW_HOUSEHOLD',
    );
    const medication = (await client.medication.findFirst({
      where: { id: medicationId, householdId, deletedAt: null },
    })) as MedicationRecord | null;
    if (!medication) {
      throw new MedicationNotFoundException();
    }
    await this.policy.requireRecipientAction(
      client,
      userId,
      householdId,
      medication.recipientId,
      action,
    );
    return medication;
  }

  private async requireMedication(
    client: DatabaseClient,
    householdId: string,
    medicationId: string,
  ): Promise<MedicationRecord> {
    const medication = (await client.medication.findFirst({
      where: { id: medicationId, householdId, deletedAt: null },
    })) as MedicationRecord | null;
    if (!medication) {
      throw new MedicationNotFoundException();
    }
    return medication;
  }

  private openSecrets(
    medication: MedicationRecord,
  ): Record<MedicationSecretField, string | null> {
    if (!medication.contentNonce || !medication.encryptionKeyId) {
      if (!medication.purposeCiphertext && !medication.requirementsCiphertext) {
        return { purpose: null, requirements: null };
      }
      throw new DataDecryptionException();
    }
    return this.encryption.openFields<MedicationSecretField>(
      {
        ciphertexts: {
          purpose: medication.purposeCiphertext
            ? Buffer.from(medication.purposeCiphertext)
            : null,
          requirements: medication.requirementsCiphertext
            ? Buffer.from(medication.requirementsCiphertext)
            : null,
        },
        nonceSeed: Buffer.from(medication.contentNonce),
        keyId: medication.encryptionKeyId,
      },
      this.encryptionContext(medication.id, medication.version),
    );
  }

  private toView(medication: MedicationRecord): MedicationView {
    const secrets = this.openSecrets(medication);
    return {
      id: medication.id,
      householdId: medication.householdId,
      recipientId: medication.recipientId,
      name: medication.name,
      alias: medication.alias,
      purpose: secrets.purpose,
      requirements: secrets.requirements,
      containerLabel: medication.containerLabel,
      containerLocation: medication.containerLocation,
      status: medication.status,
      recordOrigin: 'FAMILY_ENTERED',
      clinicalAssessmentPerformed: false,
      createdAt: medication.createdAt.toISOString(),
      updatedAt: medication.updatedAt.toISOString(),
      version: medication.version,
    };
  }

  private encryptionContext(medicationId: string, version: number): string {
    return `medication:${medicationId}:version:${version}`;
  }

  private normalizedNullable(value: string | null | undefined): string | null {
    return value?.trim() || null;
  }

  private toPrismaBytes(value: Uint8Array): Uint8Array<ArrayBuffer> {
    return Uint8Array.from(value);
  }

  private toPrismaBytesOrNull(
    value: Uint8Array | null,
  ): Uint8Array<ArrayBuffer> | null {
    return value === null ? null : this.toPrismaBytes(value);
  }
}
