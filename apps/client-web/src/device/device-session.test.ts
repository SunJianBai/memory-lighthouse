import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildDeviceInstallationRegistration,
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

describe("browser device key protection", () => {
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
