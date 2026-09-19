import { describe, expect, it } from "vitest";
import { parseTodayCare, todayCareStatus } from "./today-care";

const snapshot = () => ({
  householdId: "home",
  recipientId: "elder",
  localDate: "2026-09-20",
  timezone: "Asia/Shanghai",
  generatedAt: "2026-09-20T04:00:00Z",
  counts: { total: 28, confirmed: 12, needsReview: 7, pending: 8, expired: 1 },
  openTaskCount: 3,
  items: [
    {
      id: "one",
      title: "早餐后饮水",
      scheduledAt: "2026-09-20T00:00:00Z",
      status: "NEEDS_FAMILY_REVIEW",
    },
  ],
});

describe("today-care response boundary", () => {
  it("keeps full counts independent from the limited preview list", () => {
    const result = parseTodayCare(snapshot(), "home", "elder");
    expect(result.counts.total).toBe(28);
    expect(result.items).toHaveLength(1);
  });
  it("rejects another household or recipient before exposing any data", () => {
    expect(() => parseTodayCare(snapshot(), "other", "elder")).toThrow(
      "不匹配",
    );
    expect(() => parseTodayCare(snapshot(), "home", "other")).toThrow("不匹配");
  });
  it.each([
    { timezone: "invalid-zone" },
    { generatedAt: "invalid-time" },
    { localDate: "2026-02-30" },
    { counts: null },
    { openTaskCount: -1 },
    { items: null },
    { items: [{ ...snapshot().items[0], scheduledAt: "bad" }] },
    { items: [{ ...snapshot().items[0], status: "CONFIRMED" }] },
    { items: Array.from({ length: 6 }, () => snapshot().items[0]) },
  ])("turns malformed data into a load error: %j", (change) => {
    expect(() =>
      parseTodayCare({ ...snapshot(), ...change }, "home", "elder"),
    ).toThrow("格式异常");
  });
  it("accepts an actual empty day without inventing reminder records", () => {
    const result = parseTodayCare(
      {
        ...snapshot(),
        counts: {
          total: 0,
          confirmed: 0,
          needsReview: 0,
          pending: 0,
          expired: 0,
        },
        items: [],
      },
      "home",
      "elder",
    );
    expect(result.counts.total).toBe(0);
    expect(result.openTaskCount).toBe(3);
  });
  it("distinguishes future reminders by instant, not by the timestamp's text", () => {
    const item = {
      ...snapshot().items[0],
      status: "DUE",
      scheduledAt: "2026-09-20T11:00:00+08:00",
    };
    expect(todayCareStatus(item, snapshot().generatedAt)).toBe("待确认");
    expect(
      todayCareStatus(
        { ...item, scheduledAt: "2026-09-20T13:00:00+08:00" },
        snapshot().generatedAt,
      ),
    ).toBe("待提醒");
    expect(
      todayCareStatus(
        { ...item, status: "NEEDS_FAMILY_REVIEW" },
        snapshot().generatedAt,
      ),
    ).toBe("待核验");
  });
});
