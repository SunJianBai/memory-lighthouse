// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CareHistoryPanel } from "./CareHistoryPanel";
import { ApiError } from "../api/api-client";

const request = vi.hoisted(() => vi.fn());
vi.mock("../api/api-client", async (original) => ({
  ...(await original<object>()),
  apiClient: { request },
}));
const page = (title: string, nextCursor: string | null = null) => ({
  items: title
    ? [
        {
          id: title,
          householdId: "home",
          recipientId: "elder",
          routineTitle: title,
          scheduledAtUtc: "2026-09-01T04:00:00Z",
          instructions: "家属说明",
          status: "EXPIRED",
        },
      ]
    : [],
  nextCursor,
  timezone: "Asia/Shanghai",
  from: null,
  to: null,
});

describe("care history panel interaction", () => {
  let root: Root, container: HTMLDivElement;
  const verify = vi.fn();
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    request.mockReset();
    verify.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });
  const render = async (revision = 0) =>
    act(async () =>
      root.render(
        <CareHistoryPanel
          kind="occurrences"
          householdId="home"
          recipientId="elder"
          timezone="Asia/Shanghai"
          revision={revision}
          busyId=""
          onVerify={verify}
        />,
      ),
    );
  async function click(text: string) {
    const button = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.trim() === text,
    );
    expect(button, text).toBeTruthy();
    await act(async () => button!.click());
  }
  async function field(label: string, value: string) {
    const group = Array.from(container.querySelectorAll("label")).find((node) =>
      node.textContent?.startsWith(label),
    );
    const input = group!.querySelector("input,select")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(input),
        "value",
      )!.set!.call(input, value);
      input.dispatchEvent(
        new Event(input.tagName === "SELECT" ? "change" : "input", {
          bubbles: true,
        }),
      );
    });
  }
  it("keeps drafts separate, applies explicit dates/status, refreshes them and resets on request", async () => {
    request.mockImplementation(async (path: string) =>
      page(path.includes("startDate") ? "历史结果" : "近期结果"),
    );
    await render();
    await click("查询历史");
    await field("开始日期", "2026-08-01");
    await field("结束日期", "2026-08-20");
    await field("状态", "EXPIRED");
    expect(request).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain("近期结果");
    await click("查询");
    expect(request.mock.lastCall?.[0]).toContain(
      "startDate=2026-08-01&endDate=2026-08-20&status=EXPIRED",
    );
    expect(container.textContent).toContain("历史结果");
    expect(container.textContent).toContain(
      "2026-08-01 至 2026-08-20（含结束日） · 已关闭",
    );
    await render(1);
    expect(request.mock.lastCall?.[0]).toContain(
      "startDate=2026-08-01&endDate=2026-08-20&status=EXPIRED",
    );
    await click("恢复近期");
    expect(request.mock.lastCall?.[0]).not.toContain("startDate");
    expect(container.textContent).toContain("近期结果");
  });

  it("shows a local validation error without replacing results or sending a request", async () => {
    request.mockResolvedValue(page("已有记录"));
    await render();
    await click("查询历史");
    await field("开始日期", "2026-01-01");
    await field("结束日期", "2026-02-01");
    await click("查询");
    expect(request).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "每次最多查询 31 天",
    );
    expect(container.textContent).toContain("已有记录");
  });

  it("appends records and exposes the actual loaded count, never a fabricated total", async () => {
    request
      .mockResolvedValueOnce(page("第一条", "next"))
      .mockResolvedValueOnce(page("更早一条"));
    await render();
    expect(container.textContent).toContain("已加载 1 条");
    await click("加载更多");
    expect(request.mock.lastCall?.[0]).toContain("cursor=next");
    expect(container.textContent).toContain("第一条");
    expect(container.textContent).toContain("更早一条");
    expect(container.textContent).toContain("已加载 2 条");
    expect(container.textContent).toContain("本次查询已加载完");
    expect(container.textContent).not.toContain("历史共");
  });

  it("distinguishes permission failure from empty results and removes loaded private text", async () => {
    request
      .mockResolvedValueOnce(page("私密记录", "next"))
      .mockRejectedValueOnce(new ApiError(403, { message: "照护权限已撤回" }));
    await render();
    await click("加载更多");
    expect(container.textContent).toContain("照护权限已撤回");
    expect(container.textContent).toContain("重新查询");
    expect(container.textContent).not.toContain("私密记录");
    expect(container.textContent).not.toContain("暂无");
  });
});
