// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoutinesApiPage } from "./RoutinesApiPage";
import { ApiError, NetworkError } from "../../api/api-client";

const fixture = vi.hoisted(() => ({
  request: vi.fn(),
  recipientId: "elder",
  epoch: 1,
  timezone: "Asia/Shanghai",
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
    recipient: { timezone: fixture.timezone },
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
    fixture.timezone = "Asia/Shanghai";
    localStorage.clear();
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
  async function settle(assertion: () => void) {
    await vi.waitFor(async () => {
      await act(async () => {});
      assertion();
    });
  }
  const history = (items: object[]) => ({
    items: items.map((item) => ({
      householdId: "home",
      recipientId: fixture.recipientId,
      ...item,
    })),
    nextCursor: null,
    timezone: fixture.timezone,
    from: null,
    to: null,
  });
  it("renders history labels and switches recipient timezone without stale records", async () => {
    fixture.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/family-task-board"))
        return {
          householdId: "home",
          recipientId: fixture.recipientId,
          tasks: [],
        };
      if (path.includes("/occurrences/history?"))
        return history([
          {
            id: "closed",
            routineTitle: `已关闭-${fixture.recipientId}`,
            status: "EXPIRED",
            instructions: "保留家属原文",
            scheduledAtUtc: "2026-12-31T16:30:00Z",
          },
        ]);
      if (path.includes("/events/history?"))
        return history([
          {
            id: "event",
            title: "一条记录",
            summary: "保留动态原文",
            sourceType: "ROUTINE_SCHEDULER",
            type: "ROUTINE_CONFIRMATION_MISSING",
            severity: "ATTENTION",
            occurredAt: "2026-12-31T16:30:00Z",
          },
        ]);
      return [];
    });
    await act(async () => root.render(<RoutinesApiPage />));
    expect(container.textContent).toContain("长者时区：Asia/Shanghai");
    expect(container.textContent).toContain("2027-01-01 00:30");
    expect(container.textContent).toContain("日程提醒 · 待核验提醒");
    expect(container.textContent).toContain("需关注");
    expect(container.textContent).not.toMatch(
      /EXPIRED|ROUTINE_SCHEDULER|ATTENTION/,
    );
    expect(
      Array.from(container.querySelectorAll(".status-pill.success")),
    ).toHaveLength(0);
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
      "2026-12-31T16:30:00.000Z",
    );
    fixture.recipientId = "other";
    fixture.timezone = "America/Los_Angeles";
    fixture.epoch++;
    await act(async () => root.render(<RoutinesApiPage />));
    expect(container.textContent).toContain("长者时区：America/Los_Angeles");
    expect(container.textContent).toContain("2026-12-31 08:30");
    expect(container.textContent).not.toContain("已关闭-elder");
    expect(container.textContent).not.toContain("2027-01-01 00:30");
  });
  it("rejects a late history response after switching recipient and timezone", async () => {
    let complete!: (value: unknown) => void;
    const oldHistory = new Promise((resolve) => {
      complete = resolve;
    });
    fixture.request.mockImplementation(async (path: string) => {
      if (path.includes("/elder/occurrences/history?")) return oldHistory;
      if (path.includes("/other/occurrences/history?"))
        return history([
          {
            id: "new",
            status: "CONFIRMED",
            routineTitle: "新长者记录",
            scheduledAtUtc: "2026-12-31T16:30:00Z",
          },
        ]);
      if (path.endsWith("/family-task-board"))
        return {
          householdId: "home",
          recipientId: fixture.recipientId,
          tasks: [],
        };
      return [];
    });
    await act(async () => root.render(<RoutinesApiPage />));
    fixture.recipientId = "other";
    fixture.timezone = "America/Los_Angeles";
    fixture.epoch++;
    await act(async () => root.render(<RoutinesApiPage />));
    expect(container.textContent).toContain("新长者记录");
    await act(async () =>
      complete(
        history([
          {
            id: "old",
            status: "DUE",
            routineTitle: "旧长者迟到记录",
            scheduledAtUtc: "2026-09-20T04:00:00Z",
          },
        ]),
      ),
    );
    expect(container.textContent).toContain("新长者记录");
    expect(container.textContent).toContain("2026-12-31 08:30");
    expect(container.textContent).not.toContain("旧长者迟到记录");
    expect(container.textContent).not.toContain("Asia/Shanghai");
  });
  it("keeps verification actions only on records awaiting family review", async () => {
    fixture.request.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (options?.method === "POST")
          return { id: "review", status: "CONFIRMED" };
        if (path.endsWith("/family-task-board"))
          return { householdId: "home", recipientId: "elder", tasks: [] };
        if (path.includes("/occurrences/history?"))
          return history([
            {
              id: "review",
              status: "NEEDS_FAMILY_REVIEW",
              version: 2,
              routineTitle: "待核验",
              scheduledAtUtc: "2026-09-20T04:00:00Z",
            },
            {
              id: "unknown",
              status: "FUTURE_STATE",
              routineTitle: "未知",
              scheduledAtUtc: "invalid",
            },
          ]);
        return [];
      },
    );
    await act(async () => root.render(<RoutinesApiPage />));
    expect(container.textContent).toContain("待家属核验");
    expect(container.textContent).toContain("状态未知");
    expect(container.textContent).toContain("时间未知");
    expect(container.textContent).not.toContain("FUTURE_STATE");
    await click("核验已完成");
    expect(fixture.request).toHaveBeenCalledWith(
      "/households/home/occurrences/review/family-verify",
      expect.objectContaining({
        method: "POST",
        body: expect.objectContaining({ version: 2, verified: true }),
      }),
    );
  });
  it("keeps separately authorized routines when a faster history request is denied", async () => {
    let complete!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      complete = resolve;
    });
    fixture.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/routines")) return pending;
      if (path.endsWith("/family-task-board"))
        return { householdId: "home", recipientId: "elder", tasks: [] };
      if (path.includes("/history?"))
        throw new ApiError(403, { message: "无动态查看权限" });
      return [];
    });
    await act(async () => root.render(<RoutinesApiPage />));
    await act(async () => complete([original]));
    expect(container.textContent).toContain("无动态查看权限");
    expect(container.textContent).toContain("每周散步");
    expect(container.textContent).not.toContain("暂无日程");
  });
  it("removes both protected panels and invalidates a sibling pending page on access denial", async () => {
    let complete!: (value: unknown) => void;
    const pending = new Promise((resolve) => {
      complete = resolve;
    });
    fixture.request.mockImplementation(async (path: string) => {
      if (path.endsWith("/family-task-board"))
        return { householdId: "home", recipientId: "elder", tasks: [] };
      if (path.includes("/occurrences/history?")) {
        if (path.includes("cursor=")) return pending;
        return {
          ...history([
            {
              id: "private-occurrence",
              status: "EXPIRED",
              routineTitle: "受保护提醒正文",
              scheduledAtUtc: "2026-09-20T00:00:00Z",
            },
          ]),
          nextCursor: "occurrence-next",
        };
      }
      if (path.includes("/events/history?")) {
        if (path.includes("cursor="))
          throw new ApiError(403, { message: "照护权限已撤回" });
        return {
          ...history([
            {
              id: "private-event",
              title: "受保护动态正文",
              sourceType: "FAMILY",
              severity: "INFO",
              type: "ROUTINE_CONFIRMED",
              occurredAt: "2026-09-20T00:00:00Z",
            },
          ]),
          nextCursor: "event-next",
        };
      }
      return [];
    });
    await act(async () => root.render(<RoutinesApiPage />));
    expect(container.textContent).toContain("受保护提醒正文");
    expect(container.textContent).toContain("受保护动态正文");
    const more = (label: string) =>
      Array.from(
        container
          .querySelector(`section[aria-label='${label}']`)!
          .querySelectorAll("button"),
      ).find((button) => button.textContent === "加载更多")!;
    await act(async () => more("提醒记录").click());
    await act(async () => more("照护动态").click());
    expect(container.textContent).not.toContain("受保护提醒正文");
    expect(container.textContent).not.toContain("受保护动态正文");
    await act(async () =>
      complete(
        history([
          {
            id: "late",
            status: "DUE",
            routineTitle: "迟到的私密正文",
            scheduledAtUtc: "2026-09-20T00:00:00Z",
          },
        ]),
      ),
    );
    expect(container.textContent).not.toContain("迟到的私密正文");
    expect(container.textContent).toContain("照护权限已撤回");
  });
  it("keeps the applied historical review filter after verifying an occurrence", async () => {
    let verified = false;
    fixture.request.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (options?.method === "POST") {
          verified = true;
          return { id: "review", status: "CONFIRMED" };
        }
        if (path.endsWith("/family-task-board"))
          return { householdId: "home", recipientId: "elder", tasks: [] };
        if (path.includes("/occurrences/history?"))
          return history(
            verified
              ? []
              : [
                  {
                    id: "review",
                    status: "NEEDS_FAMILY_REVIEW",
                    version: 2,
                    routineTitle: "历史待核验记录",
                    scheduledAtUtc: "2026-08-01T04:00:00Z",
                  },
                ],
          );
        if (path.includes("/events/history?")) return history([]);
        return [];
      },
    );
    await act(async () => root.render(<RoutinesApiPage />));
    await click("查询历史");
    await field("开始日期", "2026-08-01");
    await field("结束日期", "2026-08-02");
    await field("状态", "NEEDS_FAMILY_REVIEW");
    await click("查询");
    await click("核验已完成");
    // The real idempotency registry awaits Web Crypto before and after POST.
    // Wait for the command and its follow-up GET, not merely the click handler.
    await settle(() => {
      expect(verified).toBe(true);
      expect(
        fixture.request.mock.calls.filter(([path]) =>
          (path as string).includes("/occurrences/history?"),
        ),
      ).toHaveLength(3);
      expect(container.textContent).not.toContain("历史待核验记录");
    });
    const calls = fixture.request.mock.calls.filter(([path]) =>
      (path as string).includes("/occurrences/history?"),
    );
    expect(calls.at(-1)?.[0]).toContain(
      "startDate=2026-08-01&endDate=2026-08-02&status=NEEDS_FAMILY_REVIEW",
    );
    expect(container.textContent).not.toContain("历史待核验记录");
    expect(container.textContent).toContain("2026-08-01 至 2026-08-02");
  });
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
    await settle(() => expect(container.querySelector("form")).toBeNull());
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
    await settle(() =>
      expect(container.querySelector("form")?.textContent).toContain(
        "版本已变更",
      ),
    );
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
  it("preserves a same-day rule's original weekday mask when only its title changes", async () => {
    const sameDay = {
      ...original,
      schedules: [
        { ...original.schedules[0], endDate: original.schedules[0].startDate },
      ],
    };
    fixture.request.mockImplementation(
      async (path: string, options?: { method?: string }) => {
        if (options?.method === "PATCH") return sameDay;
        if (path.endsWith("/routines")) return [sameDay];
        if (path.endsWith("/family-task-board"))
          return { householdId: "home", recipientId: "elder", tasks: [] };
        return [];
      },
    );
    await act(async () => root.render(<RoutinesApiPage />));
    await click("编辑");
    await field("标题", "仅修改标题");
    await click("保存日程");
    await settle(() => expect(container.querySelector("form")).toBeNull());
    expect(fixture.request).toHaveBeenCalledWith(
      "/households/home/routines/routine",
      expect.objectContaining({
        method: "PATCH",
        body: expect.objectContaining({
          schedule: expect.objectContaining({ weekdayMask: 62 }),
        }),
      }),
    );
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
    await settle(() =>
      expect(fixture.request).toHaveBeenCalledWith(
        "/households/home/routines/routine",
        expect.objectContaining({ method: "PATCH" }),
      ),
    );
    fixture.recipientId = "other";
    fixture.epoch++;
    await act(async () => root.render(<RoutinesApiPage />));
    await act(async () => complete({ ...original, title: "旧保存不能出现" }));
    expect(container.querySelector("form")).toBeNull();
    expect(container.textContent).not.toContain("旧保存不能出现");
    expect(container.textContent).not.toContain("每周散步");
  });
  it("retries an edit with the same nonempty idempotency key after a lost response", async () => {
    const keys: string[] = [];
    fixture.request.mockImplementation(
      async (
        path: string,
        options?: { method?: string; headers?: Record<string, string> },
      ) => {
        if (options?.method === "PATCH") {
          keys.push(options.headers?.["Idempotency-Key"] ?? "");
          if (keys.length === 1) throw new NetworkError();
          return original;
        }
        if (path.endsWith("/routines")) return [original];
        if (path.endsWith("/family-task-board"))
          return { householdId: "home", recipientId: "elder", tasks: [] };
        return [];
      },
    );
    await act(async () => root.render(<RoutinesApiPage />));
    await click("编辑");
    await click("保存日程");
    await settle(() => expect(container.querySelector("form")).toBeNull());
    expect(keys).toHaveLength(2);
    expect(keys[0]).not.toBe("");
    expect(keys[1]).toBe(keys[0]);
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
