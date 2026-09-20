import { describe, expect, it } from "vitest";
import { repeatMode, scheduleError, scheduleSummary } from "./routine-schedule";
const schedule = {
  id: "s",
  scheduleVersion: 1,
  timezone: "Asia/Shanghai",
  localTimeMinutes: 540,
  weekdayMask: 62,
  startDate: "2026-09-21",
  endDate: "2026-09-27",
  graceMinutes: 5,
  familyNoticeMinutes: 15,
};
describe("routine schedule presentation", () => {
  it("describes an inclusive range without implying public holidays", () => {
    expect(scheduleSummary(schedule)).toBe(
      "周一至周五 09:00（Asia/Shanghai） · 2026-09-21起，至2026-09-27",
    );
    expect(repeatMode(schedule)).toBe("weekdays");
  });
  it("distinguishes once from unbounded repeating", () => {
    const once = { ...schedule, endDate: schedule.startDate };
    expect(repeatMode(once)).toBe("once");
    expect(scheduleSummary(once)).toBe(
      "仅一次 · 2026-09-21 09:00（Asia/Shanghai）",
    );
    expect(
      scheduleSummary({ ...schedule, endDate: null, weekdayMask: 65 }),
    ).toContain("周末");
    expect(scheduleSummary({ ...schedule, endDate: null })).toContain(
      "持续重复",
    );
  });
  it.each([
    { weekdayMask: 0 },
    { weekdayMask: 128 },
    { startDate: "2026-02-30" },
    { endDate: "2026-09-20" },
    { weekdayMask: 65, endDate: "2026-09-22" },
    { timezone: "bad-zone" },
    { localTimeMinutes: NaN },
    { graceMinutes: -1 },
    { familyNoticeMinutes: NaN },
  ])("rejects invalid input %j", (change) => {
    expect(scheduleError({ ...schedule, ...change })).not.toBe("");
    expect(scheduleSummary({ ...schedule, ...change })).toBe("提醒规则待核对");
  });
});
