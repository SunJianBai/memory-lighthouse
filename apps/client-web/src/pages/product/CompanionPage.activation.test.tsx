// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/api-client";
import { createDemoState } from "../../domain/demo-data";
import { DeviceCredentialPersistenceError } from "../../device/device-storage-error";
import { CompanionPage } from "./CompanionPage";

const fixture = vi.hoisted(() => ({
  credential: false,
  initialize: vi.fn(),
  status: vi.fn(),
  exchange: vi.fn(),
  context: vi.fn(),
  heartbeat: vi.fn(),
  currentRemote: vi.fn(),
  lockToDeviceMode: vi.fn(),
}));
let state = createDemoState();
vi.mock("../../auth/auth-context", () => ({
  useAuth: () => ({ user: null, lockToDeviceMode: fixture.lockToDeviceMode }),
}));
vi.mock("../../state/app-state", () => ({ useAppState: () => ({ state }) }));
vi.mock("../../components/CareExperience", () => ({
  CareExperience: () => null,
}));
vi.mock("../../device/device-session", () => ({
  deviceSession: {
    ...fixture,
    hasCredential: () => fixture.credential,
  },
  parseQrActivation: vi.fn(),
}));
vi.mock("../../realtime/live-media", () => ({
  LiveMediaConnection: class {
    async disconnect() {}
  },
  BrowserRemoteSignalAdapter: class {
    subscribe() {
      return () => {};
    }
    close() {}
  },
}));

const pendingKey = "memory-lighthouse.pending-activation-challenge.v1";
const conflictMessage = "激活请求已经结束，不能重复使用";
const consumed = {
  status: "CONSUMED",
  approvedAt: "2026-09-20T04:00:00Z",
  recoveryToken: "synthetic-recovery-proof",
};
let host: HTMLDivElement;
let root: Root;
const render = () =>
  act(async () => {
    root.render(<CompanionPage />);
  });
const advance = (ms = 2_000) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-20T04:00:00Z"));
  vi.resetAllMocks();
  state = createDemoState();
  fixture.credential = false;
  fixture.initialize.mockResolvedValue(undefined);
  fixture.lockToDeviceMode.mockResolvedValue(undefined);
  fixture.status.mockResolvedValue(consumed);
  fixture.exchange.mockImplementation(async () => {
    fixture.credential = true;
  });
  fixture.context.mockResolvedValue({
    deviceId: "device",
    bindingId: "binding",
    householdId: "home",
    recipientId: "elder",
    recipient: { preferredName: "测试长者", timezone: "Asia/Shanghai" },
    consent: { decisions: {}, capturedAt: "2026-09-20T04:00:00Z" },
    careSnapshot: { memories: [], occurrences: [] },
    model: { provider: "local", model: "test", realtimeUrl: "" },
  });
  fixture.heartbeat.mockResolvedValue({
    online: true,
    mediaDirective: "CONTINUE",
  });
  fixture.currentRemote.mockResolvedValue(null);
  sessionStorage.clear();
  sessionStorage.setItem(pendingKey, "challenge");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("companion activation result ownership", () => {
  it("does not repeat device initialization when unrelated local app state is reloaded", async () => {
    fixture.credential = true;
    await render();
    expect(fixture.lockToDeviceMode).toHaveBeenCalledTimes(1);
    state = createDemoState();
    await render();
    expect(fixture.initialize).toHaveBeenCalledTimes(1);
    expect(fixture.lockToDeviceMode).toHaveBeenCalledTimes(1);
    expect(fixture.context).toHaveBeenCalledTimes(1);
  });
  it("finishes the same recovery without an earlier conflict and without overlap", async () => {
    await render();
    expect(host.textContent).toContain("测试长者的陪伴设备");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    await advance(10_000);
    expect(fixture.status).toHaveBeenCalledTimes(1);
    expect(fixture.exchange).toHaveBeenCalledTimes(1);
  });
  it("removes an earlier recoverable activation error once credentials and context are restored", async () => {
    fixture.status.mockRejectedValueOnce(
      new ApiError(409, {
        code: "ACTIVATION_ALREADY_CONSUMED",
        message: conflictMessage,
      }),
    );
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      conflictMessage,
    );
    await advance();
    expect(fixture.exchange).toHaveBeenCalledWith(
      "challenge",
      consumed.approvedAt,
      consumed.recoveryToken,
    );
    expect(host.textContent).toContain("测试长者的陪伴设备");
    expect(sessionStorage.getItem(pendingKey)).toBeNull();
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("retains the independent heartbeat failure after activation succeeds", async () => {
    fixture.status.mockRejectedValueOnce(
      new ApiError(409, {
        code: "ACTIVATION_ALREADY_CONSUMED",
        message: conflictMessage,
      }),
    );
    fixture.heartbeat.mockRejectedValue(new Error("心跳暂时不可用"));
    await render();
    await advance();
    expect(host.textContent).toContain("测试长者的陪伴设备");
    expect(host.textContent).not.toContain(conflictMessage);
    expect(host.querySelector(".companion-account")?.textContent).toContain(
      "离线",
    );
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "心跳暂时不可用",
    );
    await advance(6_000);
    expect(host.querySelector(".companion-account")?.textContent).toContain(
      "离线",
    );
    fixture.heartbeat.mockResolvedValue({
      online: true,
      mediaDirective: "CONTINUE",
    });
    await advance(5_000);
    expect(host.querySelector(".companion-account")?.textContent).toContain(
      "在线",
    );
    expect(host.textContent).not.toContain("心跳暂时不可用");
  });

  it("clears a transient activation query error when waiting for approval resumes", async () => {
    fixture.status.mockRejectedValueOnce(
      new ApiError(503, { message: "激活状态暂时不可用" }),
    );
    fixture.status.mockResolvedValue({ status: "CLAIMED" });
    await render();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "激活状态暂时不可用",
    );
    await advance();
    expect(host.textContent).toContain("等待家属核对并批准");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(fixture.exchange).not.toHaveBeenCalled();
  });

  it("shows and independently recovers incoming-call query errors while waiting", async () => {
    fixture.credential = true;
    fixture.heartbeat.mockRejectedValue(new Error("心跳暂时不可用"));
    fixture.currentRemote.mockRejectedValueOnce(new Error("来电暂时不可用"));
    await render();
    expect(host.textContent).toContain("来电状态同步失败：来电暂时不可用");
    expect(host.textContent).toContain("心跳暂时不可用");
    await advance();
    expect(host.textContent).not.toContain("来电暂时不可用");
    expect(host.textContent).toContain("心跳暂时不可用");
    expect(host.querySelector(".companion-account")?.textContent).toContain(
      "离线",
    );
    fixture.heartbeat.mockResolvedValue({
      online: true,
      mediaDirective: "CONTINUE",
    });
    await advance(5_000);
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it.each([false, true])(
    "keeps persisted identity on a context failure (restored=%s) and explicitly retries",
    async (restored) => {
      fixture.credential = restored;
      fixture.context.mockRejectedValueOnce(new Error("设备信息请求超时"));
      await render();
      expect(fixture.credential).toBe(true);
      expect(host.textContent).toContain("设备信息暂未同步");
      expect(host.querySelector("#activation-code")).toBeNull();
      expect(host.querySelector('[role="alert"]')?.textContent).toContain(
        "设备信息请求超时",
      );
      const retry = Array.from(host.querySelectorAll("button")).find(
        (node) => node.textContent === "重试同步设备信息",
      );
      expect(retry).toBeDefined();
      await act(async () => retry!.click());
      expect(host.textContent).toContain("测试长者的陪伴设备");
      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(fixture.exchange).toHaveBeenCalledTimes(restored ? 0 : 1);
    },
  );

  it("does not call an unproved consumed challenge successful", async () => {
    fixture.status.mockResolvedValue({ ...consumed, recoveryToken: null });
    await render();
    expect(fixture.exchange).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("设备已激活");
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
  });

  it("preserves the pending challenge if secure credential storage fails", async () => {
    fixture.exchange.mockRejectedValue(
      new DeviceCredentialPersistenceError(new Error("storage failed")),
    );
    await render();
    expect(fixture.credential).toBe(false);
    expect(sessionStorage.getItem(pendingKey)).toBe("challenge");
    expect(host.textContent).not.toContain("设备已激活");
    expect(host.textContent).toContain("恢复句柄已保留");
    await advance(20_000);
    expect(fixture.exchange).toHaveBeenCalledTimes(1);
  });

  it("waits for the credential vault before polling a leftover challenge", async () => {
    let initialized!: () => void;
    fixture.initialize.mockReturnValue(
      new Promise<void>((resolve) => {
        initialized = resolve;
      }),
    );
    await render();
    await advance(6_000);
    expect(fixture.status).not.toHaveBeenCalled();
    await act(async () => {
      fixture.credential = true;
      initialized();
    });
    expect(host.textContent).toContain("测试长者的陪伴设备");
    expect(fixture.status).not.toHaveBeenCalled();
    expect(fixture.exchange).not.toHaveBeenCalled();
    expect(sessionStorage.getItem(pendingKey)).toBeNull();
  });

  it.each([false, true])(
    "locks out the family session before device requests (restored=%s)",
    async (restored) => {
      fixture.credential = restored;
      const calls: string[] = [];
      fixture.lockToDeviceMode.mockImplementation(async () => {
        calls.push("lock");
      });
      fixture.exchange.mockImplementation(async () => {
        calls.push("exchange");
        fixture.credential = true;
      });
      fixture.context.mockImplementationOnce(async () => {
        calls.push("context");
        throw new Error("context offline");
      });
      await render();
      expect(calls[0]).toBe("lock");
      expect(calls.indexOf("context")).toBeGreaterThan(calls.indexOf("lock"));
      if (!restored)
        expect(calls.indexOf("exchange")).toBeGreaterThan(
          calls.indexOf("lock"),
        );
    },
  );

  it("does not start device requests when family session revocation fails", async () => {
    fixture.credential = true;
    fixture.lockToDeviceMode.mockRejectedValue(new Error("无法退出家属会话"));
    await render();
    await advance(10_000);
    expect(host.textContent).toContain("无法退出家属会话");
    expect(fixture.context).not.toHaveBeenCalled();
    expect(fixture.heartbeat).not.toHaveBeenCalled();
    expect(fixture.currentRemote).not.toHaveBeenCalled();
  });
});
