import { describe, expect, it, vi } from "vitest";
import { ApiError, NetworkError } from "./api-client";
import {
  CareHistorySession,
  historyDateError,
  recentHistoryDates,
} from "./care-history";

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const page = (ids: string[], nextCursor: string | null = null) => ({
  items: ids.map((id) => ({
    id,
    householdId: "home",
    recipientId: "elder",
    title: id,
    occurredAt: "2026-09-01T00:00:00Z",
  })),
  nextCursor,
  timezone: "Asia/Shanghai",
  from: null,
  to: null,
});
const session = (request: (path: string) => Promise<unknown>) =>
  new CareHistorySession("events", "home", "elder", request);

describe("care history query session", () => {
  it("sends real date conditions and opaque cursors, appends once, and de-duplicates records", async () => {
    const second = deferred();
    const request = vi
      .fn()
      .mockResolvedValueOnce(page(["first"], "cursor-A"))
      .mockReturnValueOnce(second.promise);
    const records = session(request);
    await records.refresh({ startDate: "2026-09-01", endDate: "2026-09-07" });
    const more = records.loadMore();
    await records.loadMore();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toBe(
      "/households/home/care-recipients/elder/events/history?limit=30&startDate=2026-09-01&endDate=2026-09-07&cursor=cursor-A",
    );
    second.resolve(page(["first", "second"]));
    await more;
    expect(records.state.page?.items.map((item) => item.id)).toEqual([
      "first",
      "second",
    ]);
    await records.loadMore();
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("ignores both successes and errors across query A to B to A", async () => {
    const first = deferred(),
      middle = deferred(),
      last = deferred();
    const records = session(
      vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(middle.promise)
        .mockReturnValueOnce(last.promise),
    );
    const a = { startDate: "2026-09-01", endDate: "2026-09-01" };
    const b = { startDate: "2026-09-02", endDate: "2026-09-02" };
    const tasks = [records.refresh(a), records.refresh(b), records.refresh(a)];
    last.resolve(page(["current"]));
    await tasks[2];
    first.resolve(page(["stale"], "old-cursor"));
    middle.reject(new NetworkError("old failure"));
    await Promise.all(tasks);
    expect(records.state.page?.items.map((item) => item.id)).toEqual([
      "current",
    ]);
    expect(records.state.error).toBe("");
    expect(records.state.filter).toEqual(a);
  });

  it.each([false, true])(
    "invalidates pending append when refreshing (old failure: %s)",
    async (failure) => {
      const old = deferred();
      const records = session(
        vi
          .fn()
          .mockResolvedValueOnce(page(["old"], "cursor"))
          .mockReturnValueOnce(old.promise)
          .mockResolvedValueOnce(page(["fresh"], "fresh-cursor")),
      );
      await records.refresh();
      const append = records.loadMore();
      await records.refresh();
      if (failure) old.reject(new NetworkError("late failure"));
      else old.resolve(page(["late"]));
      await append;
      expect(records.state.page?.items.map((item) => item.id)).toEqual([
        "fresh",
      ]);
      expect(records.state.page?.nextCursor).toBe("fresh-cursor");
      expect(records.state.error).toBe("");
    },
  );

  it("retains applied filters during refresh and clears old results synchronously", async () => {
    const pending = deferred();
    const request = vi
      .fn()
      .mockResolvedValueOnce(page(["first"]))
      .mockReturnValueOnce(pending.promise);
    const records = session(request);
    await records.refresh({ startDate: "2026-09-01", endDate: "2026-09-02" });
    const refresh = records.refresh();
    expect(records.state.page).toBeNull();
    expect(records.state.loading).toBe(true);
    expect(request.mock.calls[1][0]).toContain(
      "startDate=2026-09-01&endDate=2026-09-02",
    );
    pending.resolve(page([]));
    await refresh;
    expect(records.state.page?.items).toEqual([]);
    expect(records.state.error).toBe("");
  });

  it("keeps items after ordinary append failure and retries the same cursor", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(page(["first"], "cursor"))
      .mockRejectedValueOnce(new NetworkError())
      .mockResolvedValueOnce(page(["second"]));
    const records = session(request);
    await records.refresh();
    await records.loadMore();
    expect(records.state.page?.items).toHaveLength(1);
    expect(records.state.retry).toBe("more");
    expect(records.state.error).not.toBe("");
    await records.loadMore();
    expect(request.mock.calls[2][0]).toEqual(request.mock.calls[1][0]);
    expect(records.state.page?.items).toHaveLength(2);
  });

  it.each([401, 403, 404])(
    "clears protected rows and cursors after HTTP %s",
    async (status) => {
      const records = session(
        vi
          .fn()
          .mockResolvedValueOnce(page(["private"], "cursor"))
          .mockRejectedValueOnce(
            new ApiError(status, { message: "无访问权限" }),
          ),
      );
      await records.refresh();
      await records.loadMore();
      expect(records.state.page).toBeNull();
      expect(records.state.error).toBe("无访问权限");
      expect(records.state.retry).toBe("refresh");
    },
  );

  it("requeries from page one when a cursor is invalid", async () => {
    const records = session(
      vi
        .fn()
        .mockResolvedValueOnce(page(["first"], "cursor"))
        .mockRejectedValueOnce(new ApiError(400, { message: "重新查询" })),
    );
    await records.refresh();
    await records.loadMore();
    expect(records.state.retry).toBe("refresh");
  });

  it("invalidates old workspace or logged-out results on unsubscribe", async () => {
    const old = deferred();
    const records = session(() => old.promise);
    const listener = vi.fn();
    const unsubscribe = records.subscribe(listener);
    const load = records.refresh();
    unsubscribe();
    const count = listener.mock.calls.length;
    old.resolve(page(["old"]));
    await load;
    expect(listener).toHaveBeenCalledTimes(count);
    expect(records.state.page).toBeNull();
  });

  it("rejects legacy arrays and rows from another recipient", async () => {
    const records = session(
      vi
        .fn()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce({
          ...page(["other"]),
          items: [{ ...page(["other"]).items[0], recipientId: "other" }],
        }),
    );
    await records.refresh();
    expect(records.state.error).toContain("记录响应无效");
    await records.refresh();
    expect(records.state.page).toBeNull();
    expect(records.state.error).toContain("记录响应无效");
  });
});

describe("history form dates", () => {
  it("prefills seven recipient-local dates, not viewer dates", () => {
    expect(
      recentHistoryDates("Asia/Shanghai", new Date("2026-12-31T18:00:00Z")),
    ).toEqual({ startDate: "2026-12-26", endDate: "2027-01-01" });
    expect(
      recentHistoryDates(
        "America/Los_Angeles",
        new Date("2026-12-31T18:00:00Z"),
      ),
    ).toEqual({ startDate: "2026-12-25", endDate: "2026-12-31" });
    expect(recentHistoryDates("Invalid/Zone")).toEqual({
      startDate: "",
      endDate: "",
    });
    expect(recentHistoryDates(undefined)).toEqual({
      startDate: "",
      endDate: "",
    });
  });
  it("validates real dates and inclusive natural-day limits", () => {
    expect(historyDateError("2024-02-29", "2024-03-30")).toBe("");
    for (const pair of [
      ["2026-02-30", "2026-03-01"],
      ["2026-03-02", "2026-03-01"],
      ["2026-01-01", "2026-02-01"],
      ["", ""],
    ]) {
      expect(historyDateError(...(pair as [string, string]))).not.toBe("");
    }
  });
});
