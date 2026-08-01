import { describe, expect, it, vi } from "vitest";
import { DeviceSessionManager, parseQrActivation } from "./device-session";

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

describe("DeviceSessionManager transcript contract", () => {
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
});
