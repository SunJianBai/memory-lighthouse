import { describe, expect, it, vi } from "vitest";

import { ApiError, NetworkError } from "./api-client";
import {
  clearPersistentIdempotencyNamespace,
  IdempotentCommandRegistry,
} from "./idempotent-command";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length(): number {
    return this.values.size;
  }

  clear(): void {
    this.values.clear();
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

class UnwritableStorage extends MemoryStorage {
  override setItem(): void {
    throw new DOMException("quota exceeded", "QuotaExceededError");
  }
}

describe("IdempotentCommandRegistry", () => {
  it("automatically retries an uncertain network failure with the same ID", async () => {
    const registry = new IdempotentCommandRegistry(() => "command-1");
    const operation = vi
      .fn()
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValueOnce("done");

    await expect(registry.execute("claim:task-1:v0", operation)).resolves.toBe(
      "done",
    );
    expect(operation).toHaveBeenNthCalledWith(1, "command-1");
    expect(operation).toHaveBeenNthCalledWith(2, "command-1");
  });

  it("retains the ID when both network attempts fail and the user retries later", async () => {
    let sequence = 0;
    const registry = new IdempotentCommandRegistry(
      () => `command-${++sequence}`,
    );
    const failed = vi.fn().mockRejectedValue(new NetworkError());

    await expect(
      registry.execute("resolve:task-1:v0", failed),
    ).rejects.toThrow();
    const succeeded = vi.fn().mockResolvedValue("done");
    await registry.execute("resolve:task-1:v0", succeeded);

    expect(failed).toHaveBeenCalledTimes(2);
    expect(succeeded).toHaveBeenCalledWith("command-1");
  });

  it("reuses the persisted ID after a page reload and clears it after success", async () => {
    const storage = new MemoryStorage();
    const firstPage = new IdempotentCommandRegistry(() => "command-1", {
      storage,
      now: () => 1_000,
    });
    await expect(
      firstPage.execute(
        'remote-call:{"householdId":"household-1","bindingId":"binding-1","media":{"receiveDeviceAudio":true,"receiveDeviceVideo":true,"sendFamilyAudio":true,"sendFamilyVideo":false}}',
        vi.fn().mockRejectedValue(new NetworkError()),
      ),
    ).rejects.toThrow();

    const reloadedPage = new IdempotentCommandRegistry(() => "command-2", {
      storage,
      now: () => 2_000,
    });
    const completed = vi.fn().mockResolvedValue("session-1");
    await expect(
      reloadedPage.execute(
        'remote-call:{"householdId":"household-1","bindingId":"binding-1","media":{"receiveDeviceAudio":true,"receiveDeviceVideo":true,"sendFamilyAudio":true,"sendFamilyVideo":false}}',
        completed,
      ),
    ).resolves.toBe("session-1");

    expect(completed).toHaveBeenCalledWith("command-1");
    expect(storage.length).toBe(0);
  });

  it("expires a persisted ID after the bounded retry window", async () => {
    const storage = new MemoryStorage();
    await expect(
      new IdempotentCommandRegistry(() => "command-1", {
        storage,
        now: () => 1_000,
        ttlMs: 100,
      }).execute(
        "remote-call:payload-a",
        vi.fn().mockRejectedValue(new NetworkError()),
      ),
    ).rejects.toThrow();

    const operation = vi.fn().mockResolvedValue("session-2");
    await new IdempotentCommandRegistry(() => "command-2", {
      storage,
      now: () => 1_101,
      ttlMs: 100,
    }).execute("remote-call:payload-a", operation);

    expect(operation).toHaveBeenCalledWith("command-2");
  });

  it("isolates different complete payloads and never persists their plaintext", async () => {
    let sequence = 0;
    const storage = new MemoryStorage();
    const registry = new IdempotentCommandRegistry(
      () => `command-${++sequence}`,
      { storage, now: () => 1_000 },
    );
    const failed = vi.fn().mockRejectedValue(new NetworkError());

    await expect(
      registry.execute(
        'remote-call:{"bindingId":"binding-1","password":"must-not-persist"}',
        failed,
      ),
    ).rejects.toThrow();
    await expect(
      registry.execute(
        'remote-call:{"bindingId":"binding-2","password":"must-not-persist"}',
        failed,
      ),
    ).rejects.toThrow();

    expect(failed).toHaveBeenNthCalledWith(1, "command-1");
    expect(failed).toHaveBeenNthCalledWith(3, "command-2");
    const persisted = Array.from({ length: storage.length }, (_, index) => {
      const key = storage.key(index) ?? "";
      return `${key}:${storage.getItem(key) ?? ""}`;
    }).join("|");
    expect(persisted).not.toContain("binding-1");
    expect(persisted).not.toContain("binding-2");
    expect(persisted).not.toContain("must-not-persist");
  });

  it("isolates an uncertain request from another signed-in account", async () => {
    const storage = new MemoryStorage();
    const normalizedPayload = "remote-call:household-1:binding-1:default-media";
    await expect(
      new IdempotentCommandRegistry(() => "user-1-command", {
        storage,
        namespace: "user-1",
        now: () => 1_000,
      }).execute(
        normalizedPayload,
        vi.fn().mockRejectedValue(new NetworkError()),
      ),
    ).rejects.toThrow();

    const secondAccountOperation = vi.fn().mockResolvedValue("session-2");
    await new IdempotentCommandRegistry(() => "user-2-command", {
      storage,
      namespace: "user-2",
      now: () => 2_000,
    }).execute(normalizedPayload, secondAccountOperation);

    expect(secondAccountOperation).toHaveBeenCalledWith("user-2-command");
  });

  it("removes only the signed-out account namespace", async () => {
    const storage = new MemoryStorage();
    const failed = vi.fn().mockRejectedValue(new NetworkError());
    await expect(
      new IdempotentCommandRegistry(() => "user-1-command", {
        storage,
        namespace: "user-1",
      }).execute("remote-call:payload", failed),
    ).rejects.toThrow();
    await expect(
      new IdempotentCommandRegistry(() => "user-2-command", {
        storage,
        namespace: "user-2",
      }).execute("remote-call:payload", failed),
    ).rejects.toThrow();

    clearPersistentIdempotencyNamespace("user-1", storage);

    expect(storage.length).toBe(1);
    const userTwoRetry = vi.fn().mockResolvedValue("session-2");
    await new IdempotentCommandRegistry(() => "replacement-command", {
      storage,
      namespace: "user-2",
    }).execute("remote-call:payload", userTwoRetry);
    expect(userTwoRetry).toHaveBeenCalledWith("user-2-command");
  });

  it("retains the ID when a later auth or policy check rejects the retry", async () => {
    const storage = new MemoryStorage();
    await expect(
      new IdempotentCommandRegistry(() => "original-command", {
        storage,
        namespace: "user-1",
      }).execute(
        "remote-call:payload",
        vi
          .fn()
          .mockRejectedValue(
            new ApiError(403, { code: "FORBIDDEN", message: "policy changed" }),
          ),
      ),
    ).rejects.toThrow("policy changed");

    const replay = vi.fn().mockResolvedValue("session-1");
    await new IdempotentCommandRegistry(() => "replacement-command", {
      storage,
      namespace: "user-1",
    }).execute("remote-call:payload", replay);

    expect(replay).toHaveBeenCalledWith("original-command");
  });

  it("clears the previous pending payload when the user changes call intent", async () => {
    const storage = new MemoryStorage();
    await expect(
      new IdempotentCommandRegistry(() => "original-command", {
        storage,
        namespace: "user-1",
        replacePreviousIntent: true,
      }).execute(
        "remote-call:binding-1",
        vi.fn().mockRejectedValue(new NetworkError()),
      ),
    ).rejects.toThrow();
    await new IdempotentCommandRegistry(() => "replacement-command", {
      storage,
      namespace: "user-1",
      replacePreviousIntent: true,
    }).execute("remote-call:binding-2", vi.fn().mockResolvedValue("session-2"));

    const replayOldIntent = vi.fn().mockResolvedValue("session-3");
    await new IdempotentCommandRegistry(() => "fresh-command", {
      storage,
      namespace: "user-1",
      replacePreviousIntent: true,
    }).execute("remote-call:binding-1", replayOldIntent);

    expect(replayOldIntent).toHaveBeenCalledWith("fresh-command");
  });

  it("keeps pending care commands when a remote-call intent changes", async () => {
    const storage = new MemoryStorage();
    const failed = vi.fn().mockRejectedValue(new NetworkError());
    await expect(
      new IdempotentCommandRegistry(() => "care-command", {
        storage,
        namespace: "user-1",
        scope: "family-care",
      }).execute("family-task:task-1:v1", failed),
    ).rejects.toThrow();
    await expect(
      new IdempotentCommandRegistry(() => "remote-command-1", {
        storage,
        namespace: "user-1",
        replacePreviousIntent: true,
        scope: "remote-call",
      }).execute("remote-call:binding-1", failed),
    ).rejects.toThrow();
    await new IdempotentCommandRegistry(() => "remote-command-2", {
      storage,
      namespace: "user-1",
      replacePreviousIntent: true,
      scope: "remote-call",
    }).execute("remote-call:binding-2", vi.fn().mockResolvedValue("session-2"));

    const careRetry = vi.fn().mockResolvedValue("task-1");
    await new IdempotentCommandRegistry(() => "replacement-care-command", {
      storage,
      namespace: "user-1",
      scope: "family-care",
    }).execute("family-task:task-1:v1", careRetry);

    expect(careRetry).toHaveBeenCalledWith("care-command");
  });

  it("expires an in-memory command after the bounded retry window", async () => {
    let currentTime = 1_000;
    let sequence = 0;
    const registry = new IdempotentCommandRegistry(
      () => `command-${++sequence}`,
      { now: () => currentTime, ttlMs: 100 },
    );
    await expect(
      registry.execute(
        "family-task:task-1:v1",
        vi.fn().mockRejectedValue(new ApiError(409, { code: "CONFLICT" })),
      ),
    ).rejects.toThrow();
    currentTime = 1_101;

    const retried = vi.fn().mockResolvedValue("done");
    await registry.execute("family-task:task-1:v1", retried);

    expect(retried).toHaveBeenCalledWith("command-2");
  });

  it("does not send a request that cannot be recovered after a crash", async () => {
    const operation = vi.fn().mockResolvedValue("session-1");
    await expect(
      new IdempotentCommandRegistry(() => "command-1", {
        storage: new UnwritableStorage(),
        namespace: "user-1",
      }).execute("remote-call:payload", operation),
    ).rejects.toThrow("无法安全保存请求的重试标识");

    expect(operation).not.toHaveBeenCalled();
  });
});
