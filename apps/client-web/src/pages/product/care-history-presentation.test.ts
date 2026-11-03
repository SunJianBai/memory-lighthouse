import { describe, expect, it } from "vitest";
import {
  occurrenceStatusLabel,
  occurrenceClosureLabel,
  careEventSourceLabel,
  careEventTypeLabel,
  careEventSeverityLabel,
  careHistoryTimezoneLabel,
  formatCareHistoryTime,
} from "./care-history-presentation";

describe("care history presentation", () => {
  it("adds a pause reason only to explicitly pause-closed occurrences", () => {
    expect(occurrenceClosureLabel("EXPIRED", "ROUTINE_PAUSED")).toBe(
      "日程已暂停",
    );
    for (const reason of [undefined, null, "", "NEW_REASON", "constructor"])
      expect(occurrenceClosureLabel("EXPIRED", reason)).toBe("");
    expect(occurrenceClosureLabel("CONFIRMED", "ROUTINE_PAUSED")).toBe("");
    expect(occurrenceStatusLabel("EXPIRED")).toBe("已关闭");
  });
  it("labels known states without treating closure as completion", () => {
    expect(
      [
        "DUE",
        "AWAITING_CONFIRMATION",
        "NEEDS_FAMILY_REVIEW",
        "CONFIRMED",
        "EXPIRED",
      ].map(occurrenceStatusLabel),
    ).toEqual(["待提醒", "待本人确认", "待家属核验", "已确认", "已关闭"]);
    expect(
      ["FAMILY", "RECIPIENT", "ROUTINE_SCHEDULER", "COMPANION_DEVICE"].map(
        careEventSourceLabel,
      ),
    ).toEqual(["家属", "本人", "日程提醒", "陪伴设备"]);
    expect(
      [
        "ROUTINE_CONFIRMED",
        "ROUTINE_NOT_CONFIRMED",
        "ROUTINE_CONFIRMATION_MISSING",
        "RECIPIENT_REQUESTED_FAMILY_CONTACT",
      ].map(careEventTypeLabel),
    ).toEqual(["日程确认", "未完成核验", "待核验提醒", "联系家人请求"]);
    expect(["INFO", "ATTENTION"].map(careEventSeverityLabel)).toEqual([
      "一般记录",
      "需关注",
    ]);
  });
  it("keeps unknown values neutral, including object prototype keys", () => {
    for (const value of [
      "",
      "__proto__",
      "constructor",
      "FUTURE_INTERNAL_VALUE",
    ]) {
      expect(occurrenceStatusLabel(value)).toBe("状态未知");
      expect(careEventSourceLabel(value)).toBe("来源待确认");
      expect(careEventTypeLabel(value)).toBe("其他动态");
      expect(careEventSeverityLabel(value)).toBe("级别未知");
    }
  });
  it.each([
    ["2026-12-31T16:30:00Z", "Asia/Shanghai", "2027-01-01 00:30"],
    ["2026-12-31T16:30:00Z", "America/Los_Angeles", "2026-12-31 08:30"],
    ["2026-03-08T09:59:00Z", "America/Los_Angeles", "2026-03-08 01:59"],
    ["2026-03-08T10:00:00Z", "America/Los_Angeles", "2026-03-08 03:00"],
    ["2026-11-01T08:30:00Z", "America/Los_Angeles", "2026-11-01 01:30"],
    ["2026-11-01T09:30:00Z", "America/Los_Angeles", "2026-11-01 01:30"],
  ])("formats %s in %s", (instant, timezone, expected) => {
    expect(formatCareHistoryTime(instant, timezone)).toEqual({
      text: expected,
      dateTime: new Date(instant).toISOString(),
    });
  });
  it("does not fall back to viewer time on malformed or absent input", () => {
    for (const value of [
      "",
      "not-a-date",
      "2026-12-31T16:30:00",
      "2026-02-30T00:00:00Z",
    ])
      expect(formatCareHistoryTime(value, "Asia/Shanghai")).toEqual({
        text: "时间未知",
      });
    expect(formatCareHistoryTime("2026-12-31T16:30:00Z", undefined)).toEqual({
      text: "时区未设置",
    });
    expect(
      formatCareHistoryTime("2026-12-31T16:30:00Z", "invalid/zone"),
    ).toEqual({ text: "时区无效" });
    expect(careHistoryTimezoneLabel("Asia/Shanghai")).toBe(
      "长者时区：Asia/Shanghai",
    );
    expect(careHistoryTimezoneLabel("")).toBe("长者时区未设置");
    expect(careHistoryTimezoneLabel("invalid/zone")).toBe("长者时区无效");
  });
});
