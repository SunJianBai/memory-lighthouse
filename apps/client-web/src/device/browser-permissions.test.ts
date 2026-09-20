// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inspectBrowserPermission } from "./browser-permissions";

const query = vi.fn();
const getUserMedia = vi.fn();
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("navigator", {
    permissions: { query },
    mediaDevices: { getUserMedia },
  });
  query.mockReset();
  getUserMedia.mockClear();
});
afterEach(() => {
  expect(getUserMedia).not.toHaveBeenCalled();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("read-only browser permission inspection", () => {
  it.each(["granted", "denied", "prompt"])(
    "preserves the actual %s permission state",
    async (state) => {
      query.mockResolvedValue({ state });
      expect(await inspectBrowserPermission("microphone")).toBe(state);
    },
  );
  it("distinguishes unsupported queries from denied permission", async () => {
    query.mockRejectedValue(new TypeError("unsupported permission name"));
    expect(await inspectBrowserPermission("camera")).toBe("unsupported");
  });
  it("does not treat API failures as permission denial", async () => {
    query.mockRejectedValue(new Error("query failed"));
    expect(await inspectBrowserPermission("camera")).toBe("error");
  });
  it("bounds unanswered permission queries", async () => {
    query.mockReturnValue(new Promise(() => {}));
    const pending = inspectBrowserPermission("camera");
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe("error");
  });
  it("handles unavailable and insecure environments without prompting", async () => {
    vi.stubGlobal("isSecureContext", false);
    expect(await inspectBrowserPermission("camera")).toBe("insecure");
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", {});
    expect(await inspectBrowserPermission("camera")).toBe("unavailable");
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    expect(await inspectBrowserPermission("camera")).toBe("unsupported");
    expect(query).not.toHaveBeenCalled();
  });
});
