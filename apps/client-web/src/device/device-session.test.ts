import { describe, expect, it } from "vitest";
import { parseQrActivation } from "./device-session";

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
