// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoutinesApiPage } from "./RoutinesApiPage";

const fixture = vi.hoisted(() => ({
  request: vi.fn(),
  recipientId: "elder",
  epoch: 1,
}));
vi.mock("../../auth/auth-context", () => ({
  useAuth: () => ({ user: { id: "user" } }),
}));
vi.mock("../../workspace/workspace-context", () => ({
  useWorkspace: () => ({
    householdId: "home",
    recipientId: fixture.recipientId,
    workspaceScopeKey: `home:${fixture.recipientId}`,
    workspaceScopeEpoch: fixture.epoch,
    recipient: { timezone: "Asia/Shanghai" },
  }),
}));
vi.mock("../../api/api-client", async (original) => ({
  ...(await original<object>()),
  apiClient: { request: fixture.request },
}));

describe("independent routine and task loading", () => {
  let root: Root;
  let container: HTMLDivElement;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    fixture.request.mockReset();
    fixture.recipientId = "elder";
    fixture.epoch = 1;
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
  const original = {
    id: "routine",
    householdId: "home",
    recipientId: "elder",
    type: "ACTIVITY",
    title: "每周散步",
    instructions: "院内散步",
    confirmationQuestion: "完成了吗？",
    version: 3,
    status: "ACTIVE",
    schedules: [
      {
        id: "schedule",
        scheduleVersion: 1,
        timezone: "Asia/Shanghai",
        localTimeMinutes: 540,
        weekdayMask: 62,
        startDate: "2026-09-21",
        endDate: "2026-09-27",
        graceMinutes: 5,
        familyNoticeMinutes: 15,
      },
    ],
  };
  async function click(label: string) {
    const button = Array.from(container.querySelectorAll("button")).find(
      (node) => node.textContent?.trim() === label,
    );
    expect(button).toBeDefined();
    await act(async () => button!.click());
  }
  async function field(label: string, value: string) {
    const group = Array.from(container.querySelectorAll("label")).find((node) =>
      node.textContent?.startsWith(label),
    );
    const input = group?.querySelector("input, select, textarea");
    expect(input, label).toBeTruthy();
    await act(async () => {
      Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(input),
        "value",
      )!.set!.call(input, value);
      input!.dispatchEvent(
        new Event(input!.tagName === "SELECT" ? "change" : "input", {
          bubbles: true,
        }),
      );
    });
  }
  it("edits the complete rule with version and displays the returned once summary", async () => {
    let stored = original;
    fixture.request.mockImplementation(
      async (
        path: string,
        options?: { method?: string; body: Record<string, unknown> },
      ) => {
        if (options?.method === "PATCH") {
          stored = {
            ...original,
            ...options.body,
            schedules: [
              {
                ...original.schedules[0],
                ...(options.body.schedule as object),
              },
            ],
          };
          return stored;
        }
        if (path.endsWith("/routines")) return [stored];
        if (path.endsWith("/family-task-board"))
          return {
            householdId: "home",
            recipientId: fixture.recipientId,
            tasks: [],
          };
        return [];
      },
    );
    await act(async () => root.render(<RoutinesApiPage />));
    await click("编辑");
    expect(container.textContent).toContain("修改整条日程规则");
    expect(document.activeElement).toBe(container.querySelector("form h2"));
    await field("重复周期", "once");
    await field("提醒日期", "2026-09-26");
    await click("保存日程");
    expect(fixture.request).toHaveBeenCalledWith(
      "/households/home/routines/routine",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({
          version: 3,
          schedule: expect.objectContaining({
            startDate: "2026-09-26",
            endDate: "2026-09-26",
            weekdayMask: 127,
          }),
        }),
      }),
    );
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).toContain("仅一次 · 2026-09-26");
  });
  it("retains failed edits and refuses empty weekday selections", async () => {
    fixture.request.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (options?.method) throw new Error("版本已变更，请刷新后重新编辑");
        if (path.endsWith("/routines")) return [original];
        if (path.endsWith("/family-task-board"))
          return { householdId: "home", recipientId: "elder", tasks: [] };
        return [];
      },
    );
    await act(async () => root.render(<RoutinesApiPage />));
    await click("编辑");
    await field("标题", "保留我的输入");
    await click("保存日程");
    expect(container.querySelector("form")?.textContent).toContain(
      "版本已变更",
    );
    expect(
      (container.querySelector("input[maxlength='200']") as HTMLInputElement)
        .value,
    ).toBe("保留我的输入");
    await field("重复周期", "custom");
    for (const day of ["周一", "周二", "周三", "周四", "周五"])
      await click(day);
    expect(container.textContent).toContain("请至少选择一个星期");
    expect(
      Array.from(container.querySelectorAll("button")).find(
        (node) => node.textContent === "保存日程",
      )?.disabled,
    ).toBe(true);
  });
  it("drops an old save and editor when the recipient changes", async () => {
    let complete!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      complete = resolve;
    });
    fixture.request.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (options?.method === "PATCH") return pending;
        if (path.endsWith("/routines"))
          return fixture.recipientId === "elder" ? [original] : [];
        if (path.endsWith("/family-task-board"))
          return {
            householdId: "home",
            recipientId: fixture.recipientId,
            tasks: [],
          };
        return [];
      },
    );
    await act(async () => root.render(<RoutinesApiPage />));
    await click("编辑");
    await click("保存日程");
    fixture.recipientId = "other";
    fixture.epoch++;
    await act(async () => root.render(<RoutinesApiPage />));
    await act(async () => complete({ ...original, title: "旧保存不能出现" }));
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("旧保存不能出现");
    expect(container.textContent).not.toContain("每周散步");
  });
  it("shows authorized tasks even when routine management is denied", async () => {
    fixture.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/routines")) throw new Error("没有日程管理权限");
      if (path.endsWith("/family-task-board"))
        return {
          householdId: "home",
          recipientId: "elder",
          tasks: [
            {
              id: "task",
              householdId: "home",
              recipientId: "elder",
              sourceEventId: "event",
              status: "OPEN",
              priority: "NORMAL",
              version: 0,
              assigneeMemberId: null,
              assigneeDisplayName: null,
              assignedToMe: false,
              canClaim: true,
              canFinish: true,
              sourceTitle: "请联系家属",
              sourceSummary: "确认是否需要帮助",
              dueAt: null,
              resolvedAt: null,
              resolutionCode: null,
              resolutionNote: null,
              createdAt: "2026-09-20T00:00:00Z",
              updatedAt: "2026-09-20T00:00:00Z",
            },
          ],
        };
      return [];
    });
    await act(async () => {
      root.render(<RoutinesApiPage />);
    });
    expect(container.textContent).toContain("请联系家属");
    expect(container.textContent).toContain("没有日程管理权限");
    expect(container.textContent).not.toContain("待办需要刷新");
  });
  it("shows a task error, not an empty board, without hiding loaded routines", async () => {
    fixture.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/family-task-board")) throw new Error("待办请求失败");
      if (path.endsWith("/routines"))
        return [
          {
            id: "routine",
            title: "散步安排",
            instructions: "在院内散步",
            status: "ACTIVE",
            contentProvenance: "FAMILY_ENTERED_VERBATIM",
            schedules: [{ localTimeMinutes: 480 }],
          },
        ];
      return [];
    });
    await act(async () => {
      root.render(<RoutinesApiPage />);
    });
    expect(container.textContent).toContain("散步安排");
    expect(container.textContent).toContain("待办需要刷新");
    expect(container.textContent).not.toContain("暂无未完成待办");
  });
});
