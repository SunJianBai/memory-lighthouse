import { NetworkError } from "./api-client";

type IdempotencyStorage = Storage;

type IdempotentCommandRegistryOptions = {
  namespace?: string;
  now?: () => number;
  persist?: boolean;
  replacePreviousIntent?: boolean;
  scope?: string;
  storage?: IdempotencyStorage | null;
  ttlMs?: number;
};

type StoredCommand = {
  commandId: string;
  createdAt: number;
};

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1_000;
const MAX_FUTURE_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const STORAGE_PREFIX = "memory-lighthouse:idempotency:v2:";
const PERSISTENCE_ERROR_MESSAGE =
  "无法安全保存请求的重试标识，请检查浏览器存储设置";

class IdempotencyPersistenceError extends Error {
  constructor() {
    super(PERSISTENCE_ERROR_MESSAGE);
    this.name = "IdempotencyPersistenceError";
  }
}

const browserStorage = (): Storage | null => {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
};

const namespaceStoragePrefix = (namespace: string): string =>
  `${STORAGE_PREFIX}${encodeURIComponent(namespace)}:`;

const scopeStoragePrefix = (namespace: string, scope: string): string =>
  `${namespaceStoragePrefix(namespace)}${encodeURIComponent(scope)}:`;

const commandStorageKey = async (
  namespace: string,
  scope: string,
  normalizedCommand: string,
): Promise<string> => {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalizedCommand),
  );
  const hex = [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `${scopeStoragePrefix(namespace, scope)}${hex}`;
};

export const clearPersistentIdempotencyNamespace = (
  namespace: string,
  storage: Storage | null = browserStorage(),
): void => {
  if (!storage) return;
  const prefix = namespaceStoragePrefix(namespace);
  try {
    for (let index = storage.length - 1; index >= 0; index -= 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) storage.removeItem(key);
    }
  } catch {
    // Expiry still prevents reuse if browser privacy settings block cleanup.
  }
};

export class IdempotentCommandRegistry {
  private readonly commands = new Map<string, StoredCommand>();
  private readonly namespace: string;
  private readonly now: () => number;
  private readonly persistenceRequired: boolean;
  private readonly replacePreviousIntent: boolean;
  private readonly scope: string;
  private readonly storage: IdempotencyStorage | null;
  private readonly ttlMs: number;

  constructor(
    private readonly createId: () => string = () => crypto.randomUUID(),
    options: IdempotentCommandRegistryOptions = {},
  ) {
    this.namespace = options.namespace?.trim() || "default";
    this.now = options.now ?? Date.now;
    this.persistenceRequired =
      options.persist === true || options.storage != null;
    this.replacePreviousIntent = options.replacePreviousIntent ?? false;
    this.scope = options.scope?.trim() || "default";
    this.storage =
      options.storage === undefined
        ? options.persist
          ? browserStorage()
          : null
        : options.storage;
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  async execute<T>(
    normalizedCommand: string,
    operation: (commandId: string) => Promise<T>,
  ): Promise<T> {
    const commandId = await this.getOrCreate(normalizedCommand);

    try {
      try {
        const result = await operation(commandId);
        await this.remove(normalizedCommand);
        return result;
      } catch (error) {
        if (!(error instanceof NetworkError)) throw error;
        const result = await operation(commandId);
        await this.remove(normalizedCommand);
        return result;
      }
    } catch (error) {
      // Retain the command ID: a timeout or disconnect may have happened after
      // the server committed, so a later user retry must identify the same command.
      throw error;
    }
  }

  private async getOrCreate(normalizedCommand: string): Promise<string> {
    if (this.replacePreviousIntent) {
      for (const command of this.commands.keys()) {
        if (command !== normalizedCommand) this.commands.delete(command);
      }
    }
    const inMemory = this.commands.get(normalizedCommand);
    if (inMemory && this.isActive(inMemory)) return inMemory.commandId;
    if (inMemory) this.commands.delete(normalizedCommand);

    if (this.persistenceRequired && !this.storage) {
      throw new IdempotencyPersistenceError();
    }

    const storageKey = this.storage
      ? await commandStorageKey(this.namespace, this.scope, normalizedCommand)
      : null;
    if (storageKey && this.replacePreviousIntent) {
      this.removeOtherPersistentCommands(storageKey);
    }
    const stored = storageKey ? this.readStored(storageKey) : null;
    const commandId = stored?.commandId ?? this.createId();
    const createdAt = stored?.createdAt ?? this.now();
    this.commands.set(normalizedCommand, { commandId, createdAt });
    if (storageKey && !stored) {
      try {
        this.storage?.setItem(
          storageKey,
          JSON.stringify({ commandId, createdAt } satisfies StoredCommand),
        );
      } catch {
        this.commands.delete(normalizedCommand);
        // Do not send a request unless its ID is already durable: otherwise a
        // crash after the server commit could create a duplicate on restart.
        throw new IdempotencyPersistenceError();
      }
    }
    return commandId;
  }

  private readStored(storageKey: string): StoredCommand | null {
    let raw: string | null | undefined;
    try {
      raw = this.storage?.getItem(storageKey);
    } catch {
      throw new IdempotencyPersistenceError();
    }
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as Partial<StoredCommand>;
      if (
        typeof parsed.commandId !== "string" ||
        parsed.commandId.length === 0 ||
        parsed.commandId.length > 100 ||
        typeof parsed.createdAt !== "number" ||
        !this.isActive(parsed as StoredCommand)
      ) {
        this.storage?.removeItem(storageKey);
        return null;
      }
      return {
        commandId: parsed.commandId,
        createdAt: parsed.createdAt as number,
      };
    } catch {
      try {
        this.storage?.removeItem(storageKey);
      } catch {
        throw new IdempotencyPersistenceError();
      }
      return null;
    }
  }

  private removeOtherPersistentCommands(currentStorageKey: string): void {
    if (!this.storage) return;
    const prefix = scopeStoragePrefix(this.namespace, this.scope);
    try {
      for (let index = this.storage.length - 1; index >= 0; index -= 1) {
        const key = this.storage.key(index);
        if (key?.startsWith(prefix) && key !== currentStorageKey) {
          this.storage.removeItem(key);
        }
      }
    } catch {
      if (this.persistenceRequired) throw new IdempotencyPersistenceError();
    }
  }

  private async remove(normalizedCommand: string): Promise<void> {
    this.commands.delete(normalizedCommand);
    if (!this.storage) return;
    try {
      this.storage.removeItem(
        await commandStorageKey(
          this.namespace,
          this.scope,
          normalizedCommand,
        ),
      );
    } catch {
      // Surface cleanup failure. The durable original ID remains available,
      // so retrying cannot create a duplicate even though the server succeeded.
      throw new IdempotencyPersistenceError();
    }
  }

  private isActive(command: StoredCommand): boolean {
    const age = this.now() - command.createdAt;
    return (
      Number.isFinite(age) &&
      age <= this.ttlMs &&
      age >= -MAX_FUTURE_CLOCK_SKEW_MS
    );
  }
}
