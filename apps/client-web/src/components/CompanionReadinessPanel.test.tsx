// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceReadinessView } from "../api/types";
import { CompanionReadinessPanel } from "./CompanionReadinessPanel";
import { deviceSession } from "../device/device-session";
import { inspectBrowserPermission } from "../device/browser-permissions";

vi.mock("../device/device-session", () => ({
  deviceSession: { readiness: vi.fn() },
}));
vi.mock("../device/browser-permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../device/browser-permissions")>()),
  inspectBrowserPermission: vi.fn(),
}));
const report: DeviceReadinessView = {
  schemaVersion: 1,
  deviceId: "device",
  bindingId: "binding",
  checkedAt: "2026-09-20T04:00:00Z",
  authorization: {
    audio: { allowed: true, missingScopes: [] },
    audioVideo: { allowed: false, missingScopes: ["CAMERA_CAPTURE"] },
  },
  model: { configurationStatus: "CONFIGURED", connectionStatus: "NOT_TESTED" },
};
let host: HTMLDivElement;
let root: Root;
const render = (bindingId = "binding") =>
  act(async () => {
    root.render(
      <CompanionReadinessPanel bindingId={bindingId} deviceId="device" />,
    );
  });
const click = () =>
  act(async () => {
    host.querySelector("button")!.click();
  });
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.mocked(deviceSession.readiness).mockReset().mockResolvedValue(report);
  vi.mocked(inspectBrowserPermission).mockReset().mockResolvedValue("granted");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});
describe("companion startup checks", () => {
  it("requires an explicit check and separates authorization, permission and connection", async () => {
    expect(deviceSession.readiness).not.toHaveBeenCalled();
    expect(inspectBrowserPermission).not.toHaveBeenCalled();
    expect(host.querySelector("details")!.open).toBe(false);
    await click();
    expect(host.textContent).toContain("本次访问成功");
    expect(host.textContent).toContain("开启陪伴摄像头");
    expect(host.textContent).toContain("权限已允许，采集未检查");
    expect(host.textContent).toContain("配置已提供，连接未检查");
    expect(host.textContent).not.toContain("设备已就绪");
  });
  it("clears previous success when a new check fails and permits retry", async () => {
    await click();
    vi.mocked(deviceSession.readiness).mockRejectedValueOnce(new Error("离线"));
    await click();
    expect(host.textContent).not.toContain("本次访问成功");
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("离线");
    await click();
    expect(host.textContent).toContain("本次访问成功");
  });
  it("expires the snapshot after 60 seconds", async () => {
    await click();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(host.textContent).toContain("结果已失效");
    expect(host.textContent).not.toContain("本次访问成功");
  });
  it("invalidates on loss of foreground and ignores the late server response", async () => {
    let resolve!: (value: DeviceReadinessView) => void;
    vi.mocked(deviceSession.readiness).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await click();
    await act(async () => {
      window.dispatchEvent(new Event("blur"));
    });
    await act(async () => {
      resolve(report);
    });
    expect(host.textContent).toContain("结果已失效");
    expect(host.textContent).not.toContain("本次访问成功");
    expect(host.querySelector("button")!.disabled).toBe(false);
  });
  it("ignores a response from a previous binding", async () => {
    let resolve!: (value: DeviceReadinessView) => void;
    vi.mocked(deviceSession.readiness).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await click();
    await render("new-binding");
    await act(async () => {
      resolve(report);
    });
    expect(host.textContent).not.toContain("本次访问成功");
    await click();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain(
      "设备状态已变化",
    );
  });
  it("bounds server waiting and does not accept a timed-out result", async () => {
    let resolve!: (value: DeviceReadinessView) => void;
    vi.mocked(deviceSession.readiness).mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    );
    await click();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(host.textContent).toContain("检查超时");
    await act(async () => {
      resolve(report);
    });
    expect(host.textContent).not.toContain("本次访问成功");
  });
});
