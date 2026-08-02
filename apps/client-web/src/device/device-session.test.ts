import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDeviceExchangeProof,
  buildDeviceInstallationRegistration,
  DeviceVault,
  DeviceSessionManager,
  generateDeviceKeyPair,
  isNonExportableDeviceSigningKey,
  parseQrActivation,
} from "./device-session";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const activateForCareTest = (manager: DeviceSessionManager): void => {
  vi.stubGlobal("localStorage", new MemoryStorage());
  (
    manager as unknown as {
      record: {
        installationId: string;
        credential: { bindingId: string };
      };
    }
  ).record = {
    installationId: "installation-1",
    credential: { bindingId: "binding-1" },
  };
};

afterEach(() => vi.unstubAllGlobals());

describe("parseQrActivation", () => {
  it("accepts only the memory-lighthouse activation deep link", () => {
    expect(
      parseQrActivation(
        "memory-lighthouse://activate?publicId=ML-ABC234&secret=secret-value",
      ),
    ).toEqual({
      publicId: "ML-ABC234",
      proofType: "QR_SECRET",
      proof: "secret-value",
    });
  });

  it("rejects unrelated links", () => {
    expect(() =>
      parseQrActivation("https://example.test/?publicId=ML-ABC234&secret=x"),
    ).toThrow("不是守忆灯塔");
  });
});

describe("DeviceVault transaction durability", () => {
  it("waits for commit and rejects an abort that follows request success", async () => {
    const request = {
      result: undefined,
      error: null,
      onsuccess: null,
      onerror: null,
    } as unknown as IDBRequest<undefined>;
    const transaction = {
      error: new DOMException("commit failed", "AbortError"),
      objectStore: () =>
        ({
          delete: () => request,
        }) as unknown as IDBObjectStore,
      abort: vi.fn(),
      oncomplete: null,
      onabort: null,
      onerror: null,
    } as unknown as IDBTransaction;
    const database = {
      transaction: () => transaction,
    } as unknown as IDBDatabase;
    const vault = new DeviceVault();
    (
      vault as unknown as {
        database: Promise<IDBDatabase> | null;
      }
    ).database = Promise.resolve(database);

    const pending = vault.clear();
    let settled = false;
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    await Promise.resolve();
    request.onsuccess?.({} as Event);
    await Promise.resolve();
    expect(settled).toBe(false);

    transaction.onabort?.({} as Event);
    await expect(pending).rejects.toThrow("commit failed");
  });
});

describe("browser device key protection", () => {
  it("signs each committed-exchange recovery token with a distinct proof action", () => {
    const initial = new TextDecoder().decode(
      buildDeviceExchangeProof({
        challengeId: "01J00000000000000000000000",
        installationId: "01J11111111111111111111111",
        approvedAt: "2026-08-02T00:00:00.000Z",
      }),
    );
    const recovery = new TextDecoder().decode(
      buildDeviceExchangeProof({
        challengeId: "01J00000000000000000000000",
        installationId: "01J11111111111111111111111",
        approvedAt: "2026-08-02T00:00:00.000Z",
        recoveryToken: "v1.recovery-token.signature",
      }),
    );

    expect(initial).toContain("action=exchange\n");
    expect(initial).not.toContain("recovery-token=");
    expect(recovery).toContain("action=exchange-recovery\n");
    expect(recovery).toContain(
      "recovery-token=v1.recovery-token.signature\n",
    );
    expect(recovery).not.toContain("approved-at=");
  });

  it("declares the non-exportable key protection protocol during registration", () => {
    expect(
      buildDeviceInstallationRegistration({
        installationPublicKeySpki: "public-spki",
        manufacturer: "Browser Vendor",
        model: "Browser UA",
        appVersion: "0.2.0",
      }),
    ).toEqual({
      installationPublicKeySpki: "public-spki",
      installationKeyAlgorithm: "ED25519",
      keyProtection: "NON_EXPORTABLE_V1",
      platform: "WEB",
      manufacturer: "Browser Vendor",
      model: "Browser UA",
      appVersion: "0.2.0",
    });
  });

  it("keeps the signing key non-exportable while allowing SPKI registration", async () => {
    const pair = await generateDeviceKeyPair();

    expect(isNonExportableDeviceSigningKey(pair.privateKey)).toBe(true);
    await expect(
      crypto.subtle.exportKey("pkcs8", pair.privateKey),
    ).rejects.toThrow();
    await expect(
      crypto.subtle.exportKey("spki", pair.publicKey),
    ).resolves.toBeInstanceOf(ArrayBuffer);
  });
});

describe("DeviceSessionManager transcript contract", () => {
  it("reports the locally active companion session on heartbeat", async () => {
    vi.stubGlobal("navigator", undefined);
    const manager = new DeviceSessionManager();
    const request = vi.fn().mockResolvedValue({
      online: true,
      serverTime: "2026-08-02T00:00:00.000Z",
      mediaDirective: "CONTINUE",
      activeCompanionSessionId: "companion-1",
    });
    (
      manager as unknown as {
        request: typeof request;
      }
    ).request = request;

    await manager.heartbeat("companion-1");

    expect(request).toHaveBeenCalledWith(
      "/device/heartbeats",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          osVersion: "Browser",
          activeCompanionSessionId: "companion-1",
        }),
      }),
    );
  });

  it("submits final user text as independently consented ASR output", async () => {
    const manager = new DeviceSessionManager();
    const request = vi.fn().mockResolvedValue({});
    (
      manager as unknown as {
        request: typeof request;
      }
    ).request = request;

    await manager.appendUserTranscript(
      "model-session-1",
      7,
      "  今天阳光很好  ",
    );

    expect(request).toHaveBeenCalledWith(
      "/device/model-sessions/model-session-1/utterances",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          sequenceNo: 7,
          speaker: "USER",
          source: "ASR",
          rawText: "  今天阳光很好  ",
          isFinal: true,
          language: "zh-CN",
        }),
      }),
    );
  });

  it("refreshes materialized occurrences and confirms with the current version", async () => {
    const manager = new DeviceSessionManager();
    activateForCareTest(manager);
    const request = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({ status: "CONFIRMED" });
    (
      manager as unknown as {
        request: typeof request;
      }
    ).request = request;

    await manager.currentOccurrences();
    await manager.confirmOccurrence("occurrence-1", 3, "RECIPIENT_BUTTON");

    expect(request).toHaveBeenNthCalledWith(1, "/device/occurrences/current");
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/device/occurrences/occurrence-1/confirm",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({
          version: 3,
          source: "RECIPIENT_BUTTON",
        }),
      }),
    );
  });

  it("creates a real family-contact task through the device command", async () => {
    const manager = new DeviceSessionManager();
    activateForCareTest(manager);
    const request = vi.fn().mockResolvedValue({ accepted: true });
    (
      manager as unknown as {
        request: typeof request;
      }
    ).request = request;

    await manager.requestFamilyContact("RECIPIENT_BUTTON", "occurrence-1");

    expect(request).toHaveBeenCalledWith(
      "/device/family-contact-requests",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "Idempotency-Key": expect.any(String),
        }),
        body: expect.objectContaining({
          idempotencyKey: expect.any(String),
          source: "RECIPIENT_BUTTON",
          occurrenceId: "occurrence-1",
        }),
      }),
    );
  });
});
