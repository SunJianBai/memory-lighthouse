import { describe, expect, it } from "vitest";
import { createDemoState } from "../domain/demo-data";
import { isAppState } from "./storage";

describe("isAppState", () => {
  it("accepts a complete exported state", () => {
    expect(isAppState(createDemoState())).toBe(true);
  });

  it("rejects a superficially valid file with missing consent and provider", () => {
    expect(
      isAppState({
        schemaVersion: 1,
        initialized: true,
        recipient: { id: "1", name: "A", preferredName: "A" },
        memories: [],
        events: [],
      }),
    ).toBe(false);
  });
});
