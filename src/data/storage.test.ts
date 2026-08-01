import { describe, expect, it, vi } from "vitest";
import { createDemoState } from "../domain/demo-data";
import { isAppState, saveAppState } from "./storage";

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

  it("rejects malformed array elements instead of trusting the container", () => {
    const state = createDemoState();
    expect(
      isAppState({
        ...state,
        routines: [{ id: "broken" }],
      }),
    ).toBe(false);
    expect(
      isAppState({
        ...state,
        events: [null],
      }),
    ).toBe(false);
  });

  it("returns an actionable error when browser storage rejects a write", () => {
    vi.stubGlobal("window", {
      localStorage: {
        setItem: () => {
          throw new DOMException("quota", "QuotaExceededError");
        },
      },
      dispatchEvent: vi.fn(),
    });
    try {
      expect(saveAppState(createDemoState())).toEqual({
        ok: false,
        message:
          "浏览器本地存储空间不足或不可用，数据没有保存。请删除不需要的图片后重试。",
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
