// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDemoState } from "../domain/demo-data";
import type { Routine } from "../domain/types";
import type { RuntimeCallbacks, TurnRequest } from "../runtime/types";
import { AppStateProvider } from "../state/app-state";
import { CareExperience, type CareExperienceHandle } from "./CareExperience";

// Replace the media/model transport boundary, not the component, hook, reducer,
// polling gate, routine validation, or application state provider.
const media = vi.hoisted(() => ({
  send: vi.fn(async (_request: TurnRequest) => {}),
}));
vi.mock("../runtime/session-runtime", () => ({
  SessionRuntime: class {
    constructor(private readonly callbacks: RuntimeCallbacks) {}
    async start() { this.callbacks.onStatus("live"); }
    stop() {}
    sendTurn = media.send;
  },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function routine(id: string): Routine {
  return {
    id, occurrenceId: id, title: `日程 ${id}`, instructions: `执行 ${id}`,
    category: "daily", scheduledTime: "09:00", weekdays: [2],
    scheduledAtUtc: "2026-11-03T01:00:00Z", enabled: true,
    occurrenceStatus: "AWAITING_CONFIRMATION", occurrenceVersion: 1,
    confirmationQuestion: "完成了吗？", graceMinutes: 5, familyNoticeMinutes: 15,
  };
}

describe("server-backed companion routine interactions", () => {
  let root: Root;
  let host: HTMLDivElement;
  let rows: Routine[];
  const handle = createRef<CareExperienceHandle>();
  const read = vi.fn<() => Promise<Routine[]>>();
  const confirm = vi.fn<(id: string, source: string) => Promise<void>>();
  const requestFamily = vi.fn<(source: string, id?: string) => Promise<void>>();
  const coordinator = {
    start: async () => ({}), stop: async () => {},
    readCurrentRoutines: read, confirmOccurrence: confirm, requestFamily,
  };
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-03T01:00:00Z"));
    localStorage.clear();
    media.send.mockReset().mockResolvedValue(undefined);
    rows = [routine("A")];
    read.mockReset().mockImplementation(async () => rows);
    confirm.mockReset().mockResolvedValue(undefined);
    requestFamily.mockReset().mockResolvedValue(undefined);
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.useRealTimers();
  });
  function button(label: string) {
    const result = [...host.querySelectorAll("button")].find(node => node.textContent?.trim() === label);
    expect(result, label).toBeDefined();
    return result!;
  }
  async function click(label: string) {
    await act(async () => button(label).click());
  }
  async function start() {
    const state = createDemoState();
    state.provider.provider = "cloud";
    state.consent.microphoneApproved = true;
    state.consent.cloudProcessingApproved = true;
    state.consent.cameraApproved = false;
    state.routines = [];
    await act(async () => root.render(
      <AppStateProvider>
        <CareExperience ref={handle} runtimeState={state} sessionCoordinator={coordinator} serverBackedMode />
      </AppStateProvider>,
    ));
    await click("开始陪伴");
  }
  async function advance(milliseconds: number) {
    await act(async () => { await vi.advanceTimersByTimeAsync(milliseconds); });
  }
  function expectAwaiting(id: string) {
    expect(host.querySelector(".next-routine-card strong")?.textContent).toBe(`日程 ${id}`);
    expect(host.querySelector(".agent-status")?.textContent).toBe("等待本人确认");
    expect(button("我完成了").disabled).toBe(false);
  }

  it("does not complete the next occurrence when an earlier confirmation receipt arrives late", async () => {
    const earlier = deferred<void>();
    confirm.mockImplementationOnce(() => earlier.promise);
    await start();
    expectAwaiting("A");
    await click("我完成了");
    expect(confirm).toHaveBeenCalledWith("A", "RECIPIENT_BUTTON");

    // A committed on the server, but its response is delayed. The next read can
    // therefore remove A and deliver B before the old confirmation returns.
    rows = [routine("B")];
    await advance(5_000);
    expectAwaiting("B");
    await act(async () => earlier.resolve());
    expectAwaiting("B");
    await click("我完成了");
    expect(confirm).toHaveBeenLastCalledWith("B", "RECIPIENT_BUTTON");
    expect(host.querySelector(".agent-status")?.textContent).toBe("本次任务已闭环");
  });

  it("polls once per five-second slot even when every response has a new array identity", async () => {
    const excess = deferred<Routine[]>();
    read.mockImplementation(async () => {
      // Keep a broken self-triggering effect bounded so the failure reports an
      // assertion instead of hanging the test runner indefinitely.
      if (read.mock.calls.length > 10) return excess.promise;
      return rows.map(item => ({ ...item }));
    });
    await start();
    expect(read).toHaveBeenCalledTimes(1);
    await advance(4_000);
    expect(read).toHaveBeenCalledTimes(1);
    await advance(1_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(media.send).toHaveBeenCalledTimes(1);
  });

  it.each(["success", "failure"] as const)("ignores an earlier family request %s after delivering the next occurrence", async outcome => {
    const earlier = deferred<void>();
    requestFamily.mockImplementationOnce(() => earlier.promise);
    await start();
    await click("联系家人");
    expect(requestFamily).toHaveBeenCalledWith("RECIPIENT_BUTTON", "A");
    expect(button("正在联系…").disabled).toBe(true);

    rows = [routine("B")];
    await advance(5_000);
    expectAwaiting("B");
    await act(async () => {
      if (outcome === "success") earlier.resolve();
      else earlier.reject(new Error("旧 A 的联系失败"));
    });
    expectAwaiting("B");
    expect(host.textContent).not.toContain("旧 A 的联系失败");
    expect(button("联系家人").disabled).toBe(false);
    await click("我完成了");
    expect(confirm).toHaveBeenLastCalledWith("B", "RECIPIENT_BUTTON");
    expect(host.querySelector(".agent-status")?.textContent).toBe("本次任务已闭环");
  });

  it.each(["success", "failure"] as const)("does not let a superseded family request %s clear the next occurrence's pending request", async outcome => {
    const earlier = deferred<void>();
    const newer = deferred<void>();
    requestFamily.mockImplementationOnce(() => earlier.promise)
      .mockImplementationOnce(() => newer.promise);
    await start();
    await click("联系家人");
    rows = [routine("B")];
    await advance(5_000);
    expect(button("联系家人").disabled).toBe(false);
    await click("联系家人");
    expect(requestFamily).toHaveBeenLastCalledWith("RECIPIENT_BUTTON", "B");
    await act(async () => {
      if (outcome === "success") earlier.resolve();
      else earlier.reject(new Error("旧 A 的联系失败"));
    });
    expectAwaiting("B");
    expect(button("正在联系…").disabled).toBe(true);
    expect(host.textContent).not.toContain("旧 A 的联系失败");
    await act(async () => newer.resolve());
    expect(host.querySelector(".agent-status")?.textContent).toBe("待家属查看");
    expect(button("联系家人").disabled).toBe(false);
  });

  it.each([
    ["local", "success"], ["local", "failure"],
    ["button", "success"], ["button", "failure"],
  ] as const)("isolates an old family request after %s stop and restart with a late %s", async (stopMode, outcome) => {
    const earlier = deferred<void>();
    const newer = deferred<void>();
    requestFamily.mockImplementationOnce(() => earlier.promise)
      .mockImplementationOnce(() => newer.promise);
    await start();
    await click("联系家人");
    if (stopMode === "local")
      await act(async () => handle.current!.stopLocalRuntime("server_media_stop"));
    else await click("结束陪伴");
    await click("开始陪伴");
    expectAwaiting("A");
    expect(button("联系家人").disabled).toBe(false);
    await click("联系家人");
    expect(requestFamily).toHaveBeenCalledTimes(2);
    await act(async () => {
      if (outcome === "success") earlier.resolve();
      else earlier.reject(new Error("旧会话联系失败"));
    });
    expectAwaiting("A");
    expect(button("正在联系…").disabled).toBe(true);
    expect(host.textContent).not.toContain("旧会话联系失败");
    await act(async () => newer.resolve());
    expect(host.querySelector(".agent-status")?.textContent).toBe("待家属查看");
    expect(button("联系家人").disabled).toBe(false);
  });

  it("preserves the new session's family request error when the old request fails later", async () => {
    const earlier = deferred<void>();
    requestFamily.mockImplementationOnce(() => earlier.promise)
      .mockRejectedValueOnce(new Error("新会话联系失败"));
    await start();
    await click("联系家人");
    await act(async () => handle.current!.stopLocalRuntime("server_media_stop"));
    await click("开始陪伴");
    await click("联系家人");
    expect(host.textContent).toContain("新会话联系失败");
    await act(async () => earlier.reject(new Error("旧会话联系失败")));
    expectAwaiting("A");
    expect(host.textContent).toContain("新会话联系失败");
    expect(host.textContent).not.toContain("旧会话联系失败");
  });

  it("sends only one family request for duplicate clicks in the same render batch", async () => {
    const pending = deferred<void>();
    requestFamily.mockImplementationOnce(() => pending.promise);
    await start();
    await act(async () => {
      const contact = button("联系家人");
      contact.click();
      contact.click();
    });
    expect(requestFamily).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve());
    expect(host.querySelector(".agent-status")?.textContent).toBe("待家属查看");
  });

  it("accepts a slow read without overlapping it or restarting on its publication", async () => {
    const slow = deferred<Routine[]>();
    read.mockImplementationOnce(() => slow.promise);
    await start();
    await advance(10_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(media.send).not.toHaveBeenCalled();
    await act(async () => slow.resolve([routine("A")]));
    expectAwaiting("A");
    expect(read).toHaveBeenCalledTimes(1);
    await advance(5_000);
    expect(read).toHaveBeenCalledTimes(2);
    expect(media.send).toHaveBeenCalledTimes(1);
  });

  it("revalidates manual repeat even within the current automatic polling slot", async () => {
    await start();
    rows = [{ ...routine("A"), instructions: "复核后的 A 内容" }];
    await click("请再说一遍");
    expect(read).toHaveBeenCalledTimes(2);
    expect(media.send).toHaveBeenCalledTimes(2);
    expect(media.send.mock.calls[1][0].messages[0].content).toContain("复核后的 A 内容");
    await advance(5_000);
    expect(media.send).toHaveBeenCalledTimes(2);
  });

  it("does not mark a failed authoritative read as a delivered reminder", async () => {
    read.mockRejectedValueOnce(new Error("网络暂不可用"));
    await start();
    expect(host.textContent).toContain("网络暂不可用");
    expect(media.send).not.toHaveBeenCalled();
    await advance(5_000);
    expectAwaiting("A");
    expect(media.send).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("网络暂不可用");
  });

  it("does not apply an earlier occurrence's failed confirmation to the next reminder", async () => {
    const earlier = deferred<void>();
    confirm.mockImplementationOnce(() => earlier.promise);
    await start();
    await click("我完成了");
    rows = [routine("B")];
    await advance(5_000);
    await act(async () => earlier.reject(new Error("旧 A 的确认失败")));
    expectAwaiting("B");
    expect(host.textContent).not.toContain("旧 A 的确认失败");
  });

  it("ignores an old confirmation after stopping and restarting the same occurrence", async () => {
    const earlier = deferred<void>();
    confirm.mockImplementationOnce(() => earlier.promise);
    await start();
    await click("我完成了");
    await act(async () => handle.current!.stopLocalRuntime("server_media_stop"));
    await click("开始陪伴");
    expectAwaiting("A");
    await act(async () => earlier.resolve());
    expectAwaiting("A");
  });

  it.each(["success", "failure"] as const)("discards a late read %s after session replacement", async outcome => {
    const earlier = deferred<Routine[]>();
    read.mockImplementationOnce(() => earlier.promise);
    await start();
    await act(async () => handle.current!.stopLocalRuntime("server_media_stop"));
    rows = [routine("B")];
    await click("开始陪伴");
    expectAwaiting("B");
    await act(async () => {
      if (outcome === "success") earlier.resolve([routine("A")]);
      else earlier.reject(new Error("旧读取失败"));
    });
    expectAwaiting("B");
    expect(host.textContent).not.toContain("旧读取失败");
    expect(media.send).toHaveBeenCalledTimes(1);
    expect(media.send.mock.calls[0][0].messages[0].content).toContain("执行 B");
  });
});
