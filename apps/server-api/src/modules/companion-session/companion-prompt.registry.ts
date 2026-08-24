import {
  Prisma,
  type PromptVersion,
} from '../../infrastructure/database/generated/prisma/client';
import type { PrismaService } from '../../infrastructure/database/prisma.service';
import type { DataEncryptionPort } from '../memory/ports/data-encryption.port';
import {
  companionPromptCodeFilter,
  DEFAULT_PROMPT_CODE,
  promptEncryptionContext,
} from './companion-session.constants';
import {
  CURRENT_COMPANION_PROMPT_COMPOSER_VERSION,
  normalizeCompanionPromptTemplate,
} from './companion-prompt';

type PromptDatabase =
  Pick<PrismaService, 'promptVersion'> | Prisma.TransactionClient;

interface DefaultCompanionPromptSeed {
  id: string;
  content: string;
  provider: string;
  model: string;
  publishedAt: Date;
}

export async function findCurrentCompanionPrompt(
  database: PromptDatabase,
): Promise<PromptVersion | null> {
  return database.promptVersion.findFirst({
    where: companionPromptCodeFilter(),
    orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
  });
}

/**
 * Creates the canonical v3 seed once, but never mutates an existing audited
 * prompt row. Both companion startup and the admin prompt page use this path,
 * so a fresh database behaves identically whichever endpoint is opened first.
 */
export async function ensureCurrentCompanionPrompt(
  database: PromptDatabase,
  encryption: DataEncryptionPort,
  seed: DefaultCompanionPromptSeed,
): Promise<PromptVersion> {
  const current = await findCurrentCompanionPrompt(database);
  if (current && current.version >= CURRENT_COMPANION_PROMPT_COMPOSER_VERSION) {
    return current;
  }

  const version = CURRENT_COMPANION_PROMPT_COMPOSER_VERSION;
  const content = normalizeCompanionPromptTemplate(seed.content);
  const sealed = encryption.sealFields(
    { content },
    promptEncryptionContext(seed.id, version),
  );
  try {
    return await database.promptVersion.create({
      data: {
        id: seed.id,
        code: DEFAULT_PROMPT_CODE,
        version,
        provider: seed.provider,
        model: seed.model,
        contentHash: Uint8Array.from(sealed.contentHashes.content!),
        contentCiphertext: Uint8Array.from(sealed.ciphertexts.content!),
        contentNonce: Uint8Array.from(sealed.nonceSeed),
        encryptionKeyId: sealed.keyId,
        publishedAt: seed.publishedAt,
      },
    });
  } catch (error) {
    if (!isPrismaConflict(error)) throw error;
    const winner = await database.promptVersion.findUnique({
      where: { code_version: { code: DEFAULT_PROMPT_CODE, version } },
    });
    if (!winner) throw error;
    return winner;
  }
}

function isPrismaConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
