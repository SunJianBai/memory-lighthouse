// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../api/api-client";
import { DevicesPage } from "./DevicesPage";

const fixture = vi.hoisted(() => ({
  request: vi.fn(),
  refresh: vi.fn(),
  recipient: "elder",
  epoch: 1,
}));
vi.mock("../../api/api-client", async (original) => ({
  ...(await original<object>()),
  apiClient: { request: fixture.request },
}));
vi.mock("../../workspace/workspace-context", () => ({
  useWorkspace: () => ({
    householdId: "home",
    recipientId: fixture.recipient,
    workspaceScopeKey: `home:${fixture.recipient}`,
    workspaceScopeEpoch: fixture.epoch,
    bindings: [],
    recipients: [],
    refreshBindings: fixture.refresh,
  }),
}));
const presentation = {
  challengeId: "challenge",
  publicId: "ML-TEST",
  dynamicCode: "TEST1234",
  qrPayload: "test-only",
  expiresAt: "2026-09-20T04:15:00Z",
};
const status = (value: string) => ({
  status: value,
  expiresAt: presentation.expiresAt,
  claimedAt: null,
  approvedAt: null,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
let host: HTMLDivElement;
let root: Root;
const render = () =>
  act(async () => {
    root.render(<DevicesPage />);
  });
const advance = (ms = 2_000) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const click = async (text: string) => {
  const button = Array.from(host.querySelectorAll("button")).find(
    (node) => node.textContent?.trim() === text,
  );
  expect(button, text).toBeDefined();
  await act(async () => button!.click());
};
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-20T04:00:00Z"));
  vi.resetAllMocks();
  fixture.recipient = "elder";
  fixture.epoch = 1;
  fixture.refresh.mockResolvedValue(undefined);
  fixture.request.mockImplementation(async (_path, options) =>
    options?.method === "POST" ? presentation : status("PENDING"),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await render();
  await click("生成激活二维码与动态码");
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe("family activation progress", () => {
  it("accepts a slow response without overlapping or starving polls", async () => {
    const slow = deferred<ReturnType<typeof status>>();
    fixture.request.mockReturnValue(slow.promise);
    await advance(6_000);
    expect(fixture.request).toHaveBeenCalledTimes(2); // create + one status
    await act(async () => slow.resolve(status("CONSUMED")));
    expect(host.textContent).toContain("激活完成");
    await advance(6_000);
    expect(fixture.request).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["CONSUMED", "激活完成", "继续添加设备"],
    ["CANCELLED", "激活已取消", "重新生成激活码"],
    ["EXPIRED", "激活码已过期", "重新生成激活码"],
    ["ATTEMPTS_EXCEEDED", "尝试次数已用完", "重新生成激活码"],
  ])(
    "presents %s without a reusable code or cancellation action",
    async (value, title, action) => {
      fixture.request.mockResolvedValue(status(value));
      await advance();
      expect(host.textContent).toContain(title);
      expect(host.textContent).toContain(action);
      expect(
        host.querySelector('[aria-label="陪伴设备激活二维码"]'),
      ).toBeNull();
      expect(host.textContent).not.toContain(presentation.dynamicCode);
      expect(host.textContent).not.toContain("取消本次激活");
      const calls = fixture.request.mock.calls.length;
      await advance(10_000);
      expect(fixture.request).toHaveBeenCalledTimes(calls);
    },
  );

  it("clears only the status error when authoritative progress recovers", async () => {
    fixture.request.mockRejectedValueOnce(
      new ApiError(409, {
        code: "ACTIVATION_ALREADY_CONSUMED",
        message: "旧激活状态冲突",
      }),
    );
    await advance();
    expect(host.textContent).toContain("旧激活状态冲突");
    fixture.request.mockResolvedValue(status("CONSUMED"));
    await advance();
    expect(host.textContent).toContain("激活完成");
    expect(host.textContent).not.toContain("旧激活状态冲突");
  });

  it.each(["resolve", "reject"] as const)(
    "ignores an old %s after switching away and back to the same recipient",
    async (settle) => {
      const slow = deferred<ReturnType<typeof status>>();
      fixture.request.mockReturnValueOnce(slow.promise);
      await advance();
      fixture.recipient = "other";
      fixture.epoch++;
      await render();
      fixture.recipient = "elder";
      fixture.epoch++;
      await render();
      await act(async () => {
        if (settle === "resolve") slow.resolve(status("CONSUMED"));
        else slow.reject(new Error("old failure"));
      });
      expect(host.textContent).not.toContain("激活完成");
      expect(host.textContent).not.toContain("old failure");
      expect(host.textContent).toContain("生成激活二维码与动态码");
    },
  );

  it("reports binding refresh failure outside the successful activation and allows retry", async () => {
    fixture.request.mockResolvedValue(status("CONSUMED"));
    fixture.refresh.mockRejectedValueOnce(new Error("列表连接中断"));
    await advance();
    expect(host.querySelector(".activation-panel")?.textContent).toContain(
      "激活完成",
    );
    expect(host.querySelector(".activation-panel [role=alert]")).toBeNull();
    expect(
      host.querySelector(".binding-panel [role=alert]")?.textContent,
    ).toContain("设备列表暂未更新");
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>('[aria-label="刷新设备列表"]')!
        .click(),
    );
    expect(host.querySelector(".binding-panel [role=alert]")).toBeNull();
  });

  it("drops obsolete approval details and their late failure after cancellation", async () => {
    const details = deferred<unknown>();
    fixture.request.mockImplementation(async (path, options) => {
      if (options?.method === "POST") return {};
      if (path.endsWith("approval-details")) return details.promise;
      return status("CLAIMED");
    });
    await advance();
    await click("取消本次激活");
    await act(async () => details.reject(new Error("已经结束的旧详情错误")));
    expect(host.textContent).toContain("激活已取消");
    expect(host.textContent).not.toContain("已经结束的旧详情错误");
    expect(host.querySelector('[aria-label="待批准设备信息"]')).toBeNull();
  });

  it("does not erase a rejected mutation when a status poll later succeeds", async () => {
    fixture.request.mockRejectedValueOnce(
      new ApiError(403, { message: "取消操作无权限" }),
    );
    await click("取消本次激活");
    fixture.request.mockResolvedValue(status("PENDING"));
    await advance();
    expect(host.textContent).toContain("取消操作无权限");
  });

  it("invalidates an old status response while approval commits", async () => {
    const details = {
      ...status("CLAIMED"),
      challengeId: "challenge",
      device: {
        platform: "WEB",
        model: "测试浏览器",
        keyFingerprintSuffix: "ABCDEF",
      },
      claimSnapshotToken: "synthetic-snapshot",
      claimNetworkSource: "LOOPBACK",
    };
    fixture.request
      .mockResolvedValueOnce(status("CLAIMED"))
      .mockResolvedValueOnce(details);
    await advance();
    const slow = deferred<ReturnType<typeof status>>();
    fixture.request.mockReturnValueOnce(slow.promise);
    await advance();
    fixture.request.mockResolvedValue(status("CONSUMED"));
    await click("确认上述信息并批准");
    expect(host.textContent).toContain("激活完成");
    await act(async () => slow.resolve(status("CLAIMED")));
    expect(host.textContent).toContain("激活完成");
    expect(host.querySelector('[aria-label="待批准设备信息"]')).toBeNull();
  });
});
