// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { FamilyTaskPanel } from "./FamilyTaskPanel";
import type { FamilyTaskBoardItem } from "../api/family-task-board";

const task: FamilyTaskBoardItem = {
  id: "id",
  householdId: "home",
  recipientId: "elder",
  sourceEventId: "INTERNAL_EVENT_ID",
  assigneeMemberId: "INTERNAL_MEMBER_ID",
  status: "CLAIMED",
  priority: "NORMAL",
  dueAt: null,
  resolvedAt: null,
  resolutionCode: null,
  resolutionNote: null,
  version: 1,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  sourceTitle: "长者希望联系家属",
  sourceSummary: "请联系确认。",
  assigneeDisplayName: "测试家属",
  assignedToMe: false,
  canClaim: false,
  canFinish: false,
};
const render = (tasks = [task], error = "", loading = false) =>
  renderToStaticMarkup(
    <FamilyTaskPanel
      tasks={tasks}
      loading={loading}
      error={error}
      busyId=""
      timezone="Asia/Shanghai"
      onAction={() => {}}
    />,
  );
describe("family task presentation", () => {
  it("confirms a release, restores focus on cancel and drops stale confirmations", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onAction = vi.fn();
    let mine = {
      ...task,
      assignedToMe: true,
      canFinish: true,
      canRelease: true,
    };
    const draw = async () =>
      act(async () =>
        root.render(
          <FamilyTaskPanel
            tasks={[mine]}
            loading={false}
            error=""
            busyId=""
            timezone="Asia/Shanghai"
            onAction={onAction}
          />,
        ),
      );
    const button = (text: string) =>
      [...host.querySelectorAll("button")].find(
        (el) => el.textContent === text,
      );
    const click = async (text: string) =>
      act(async () => button(text)!.click());
    try {
      await draw();
      await click("交回待认领");
      expect(host.textContent).toContain("此待办仍未完成");
      expect(onAction).not.toHaveBeenCalled();
      await click("取消");
      expect(document.activeElement).toBe(button("交回待认领"));
      await click("交回待认领");
      await click("不再处理");
      expect(button("确认交回")).toBeUndefined();
      await click("交回待认领");
      mine = { ...mine, version: mine.version + 1 };
      await draw();
      expect(button("确认交回")).toBeUndefined();
      await click("交回待认领");
      await click("确认交回");
      expect(onAction).toHaveBeenCalledExactlyOnceWith(mine, "release");
      mine = { ...mine, canRelease: false };
      await draw();
      expect(button("交回待认领")).toBeUndefined();
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
  it.each([
    ["FAMILY_CONFIRMED", "家属已确认处理"],
    ["NOT_ACTIONABLE", "无需继续处理"],
    ["FAMILY_VERIFIED_COMPLETE", "家属核验为完成"],
    ["FAMILY_VERIFIED_NOT_COMPLETE", "家属核验为未完成"],
    ["FUTURE_CODE", "已记录处理结果"],
    ["__proto__", "已记录处理结果"],
    ["constructor", "已记录处理结果"],
    ["toString", "已记录处理结果"],
    [null, "未记录具体结果"],
  ])("shows ended result %s even without a note", async (code, label) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => {
        root.render(
          <FamilyTaskPanel
            tasks={[{ ...task, status: "DISMISSED", resolutionCode: code }]}
            loading={false}
            error=""
            busyId=""
            timezone="Asia/Shanghai"
            onAction={() => {}}
          />,
        );
      });
      await act(async () => {
        Array.from(host.querySelectorAll("button"))
          .find((button) => button.textContent?.startsWith("已结束"))!
          .click();
      });
      expect(host.textContent).toContain(`处理结果：${label}`);
    } finally {
      await act(async () => root.unmount());
    }
  });
  it("requires an inline confirmation and allows cancelling without sending a command", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const onAction = vi.fn();
    const mine = { ...task, assignedToMe: true, canFinish: true };
    const click = async (label: string) => {
      const button = Array.from(host.querySelectorAll("button")).find(
        (item) => item.textContent === label,
      );
      expect(button, label).toBeDefined();
      await act(async () => {
        button!.click();
      });
    };
    try {
      await act(async () => {
        root.render(
          <FamilyTaskPanel
            tasks={[mine]}
            loading={false}
            error=""
            busyId=""
            timezone="Asia/Shanghai"
            onAction={onAction}
          />,
        );
      });
      await click("不再处理");
      expect(onAction).not.toHaveBeenCalled();
      expect(host.textContent).toContain("确认不再处理这条待办吗");
      await click("取消");
      expect(onAction).not.toHaveBeenCalled();
      await click("不再处理");
      await click("确认不再处理");
      expect(onAction).toHaveBeenCalledExactlyOnceWith(mine, "dismiss");
    } finally {
      await act(async () => {
        root.unmount();
      });
      host.remove();
    }
  });
  it("shows context and assignee without IDs or actions for someone else's task", () => {
    const html = render();
    expect(html).toContain("长者希望联系家属");
    expect(html).toContain("负责人：测试家属");
    expect(html).toContain("由负责人处理");
    expect(html).not.toContain("INTERNAL_");
    expect(html).not.toContain(">完成</button>");
    expect(html).not.toContain(">认领</button>");
    expect(html).not.toContain("交回待认领");
  });
  it("shows actions for mine and exposes pressed filter state", () => {
    const html = render([{ ...task, assignedToMe: true, canFinish: true }]);
    expect(html).toContain(">完成</button>");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("我负责");
  });
  it("distinguishes load errors and loading from an empty result", () => {
    expect(render([], "failed")).toContain("待办需要刷新");
    expect(render([], "failed")).not.toContain("暂无未完成待办");
    expect(render([], "", true)).toContain("正在加载待办");
    expect(render([])).toContain("暂无未完成待办");
  });
});
