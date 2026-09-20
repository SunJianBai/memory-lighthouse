// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RoutinesApiPage } from "./RoutinesApiPage";

const fixture = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../auth/auth-context", () => ({
  useAuth: () => ({ user: { id: "user" } }),
}));
vi.mock("../../workspace/workspace-context", () => ({
  useWorkspace: () => ({
    householdId: "home",
    recipientId: "elder",
    workspaceScopeKey: "home:elder",
    workspaceScopeEpoch: 1,
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
