import type { Prisma } from '../../infrastructure/database/generated/prisma/client';
import { newUlid } from '../identity/domain/ulid';

export interface PlatformAuditAppendPoint {
  id: string;
  occurredAt: Date;
  previousEventHash: Uint8Array | null;
}

/**
 * Resolves the next append point for the global audit chain. Audit timestamps
 * are stored with millisecond precision, so each writer must advance past the
 * current head instead of relying on a random ULID suffix to break ties.
 */
export async function preparePlatformAuditAppend(
  transaction: Pick<Prisma.TransactionClient, 'auditLog'>,
  requestedAt: Date,
): Promise<PlatformAuditAppendPoint> {
  const previous = await transaction.auditLog.findFirst({
    orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    select: { eventHash: true, occurredAt: true },
  });
  const occurredAt =
    previous && requestedAt.getTime() <= previous.occurredAt.getTime()
      ? new Date(previous.occurredAt.getTime() + 1)
      : requestedAt;

  return {
    id: newUlid(occurredAt.getTime()),
    occurredAt,
    previousEventHash: previous ? Uint8Array.from(previous.eventHash) : null,
  };
}
