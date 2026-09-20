import type { Prisma } from '../../infrastructure/database/generated/prisma/client';
import type { CareEventView, OccurrenceView } from './care-workflow.types';
import type { CareWorkflowContentCipher } from './ports/content-cipher.port';

export interface ProtectedCarePair {
  instructionsCiphertext?: Uint8Array;
  confirmationQuestionCiphertext?: Uint8Array;
  titleCiphertext?: Uint8Array;
  summaryCiphertext?: Uint8Array;
  contentNonce: Uint8Array;
  encryptionKeyId: string;
}

export interface OccurrenceRecord {
  id: string;
  householdId: string;
  recipientId: string;
  routineId: string;
  scheduleId: string;
  scheduledAtUtc: Date;
  scheduledLocalDate: Date;
  status: string;
  confirmationDeadlineAt: Date | null;
  escalationAt: Date | null;
  completedAt: Date | null;
  version: number;
  routine: ProtectedCarePair & { title: string; type: string };
}

export interface CareEventRecord extends ProtectedCarePair {
  id: string;
  householdId: string;
  recipientId: string;
  type: string;
  severity: string;
  sourceType: string;
  sourceId: string | null;
  routineOccurrenceId: string | null;
  payloadJson: Prisma.JsonValue | null;
  occurredAt: Date;
  createdAt: Date;
}

export function decryptCarePair(
  cipher: CareWorkflowContentCipher,
  record: ProtectedCarePair,
): { first: string; second: string } {
  const first = record.instructionsCiphertext ?? record.titleCiphertext;
  const second =
    record.confirmationQuestionCiphertext ?? record.summaryCiphertext;
  if (!first || !second) throw new Error('Protected content pair is missing');
  const plaintext = cipher.decrypt({
    ciphertext: Buffer.concat([Buffer.from(first), Buffer.from(second)]),
    nonce: Buffer.from(record.contentNonce),
    encryptionKeyId: record.encryptionKeyId,
  });
  const parsed: unknown = JSON.parse(plaintext);
  if (
    !Array.isArray(parsed) ||
    parsed.length !== 2 ||
    typeof parsed[0] !== 'string' ||
    typeof parsed[1] !== 'string'
  ) {
    throw new Error('Protected content pair is invalid');
  }
  return { first: parsed[0], second: parsed[1] };
}

export function occurrenceView(
  cipher: CareWorkflowContentCipher,
  record: OccurrenceRecord,
): OccurrenceView {
  const content = decryptCarePair(cipher, record.routine);
  return {
    id: record.id,
    householdId: record.householdId,
    recipientId: record.recipientId,
    routineId: record.routineId,
    scheduleId: record.scheduleId,
    routineTitle: record.routine.title,
    routineType: record.routine.type,
    instructions: content.first,
    contentProvenance: 'FAMILY_ENTERED_VERBATIM',
    scheduledAtUtc: record.scheduledAtUtc.toISOString(),
    scheduledLocalDate: record.scheduledLocalDate.toISOString().slice(0, 10),
    status: record.status,
    confirmationDeadlineAt:
      record.confirmationDeadlineAt?.toISOString() ?? null,
    escalationAt: record.escalationAt?.toISOString() ?? null,
    completedAt: record.completedAt?.toISOString() ?? null,
    version: record.version,
  };
}

export function careEventView(
  cipher: CareWorkflowContentCipher,
  record: CareEventRecord,
): CareEventView {
  const content = decryptCarePair(cipher, record);
  return {
    id: record.id,
    householdId: record.householdId,
    recipientId: record.recipientId,
    type: record.type,
    severity: record.severity,
    sourceType: record.sourceType,
    sourceId: record.sourceId,
    routineOccurrenceId: record.routineOccurrenceId,
    title: content.first,
    summary: content.second,
    payload: record.payloadJson,
    occurredAt: record.occurredAt.toISOString(),
    createdAt: record.createdAt.toISOString(),
  };
}
