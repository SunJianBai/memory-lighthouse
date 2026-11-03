import { Prisma } from '../../infrastructure/database/generated/prisma/client';
import type { PrismaService } from '../../infrastructure/database/prisma.service';
import { SERIALIZABLE_RETRY_LIMIT } from './care-workflow.constants';

/** Every writer locks the routine before schedules and occurrences. Candidate
 * discovery is not authorization: re-read after locking. INSERT locks new routines. */
export async function lockRoutine(
  transaction: Prisma.TransactionClient,
  routineId: string,
): Promise<void> {
  await transaction.$queryRaw(
    Prisma.sql`SELECT id FROM routines WHERE id = ${routineId} FOR UPDATE`,
  );
}

export async function routineTransaction<T>(
  prisma: PrismaService,
  work: (transaction: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await prisma.$transaction(work, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' ||
          error.code === 'P2002' ||
          (error.code === 'P2010' &&
            ['1205', '1213'].includes(String(error.meta?.code))));
      if (!retryable || attempt >= SERIALIZABLE_RETRY_LIMIT) throw error;
    }
  }
}
