import { describe, expect, it } from "vitest";
import type { Routine } from "../domain/types";
import {
  findDueRoutine,
  findNextRoutine,
  routineOccurrenceKey,
} from "./routine-scheduler";

const morning: Routine = {
  id: "morning",
  title: "晨间任务",
  category: "daily",
  scheduledTime: "08:30",
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  instructions: "查看标签",
  confirmationQuestion: "完成了吗？",
  graceMinutes: 10,
  familyNoticeMinutes: 20,
  enabled: true,
};

const weekday: Routine = {
  ...morning,
  id: "weekday",
  title: "工作日出门",
  scheduledTime: "09:20",
  weekdays: [1, 2, 3, 4, 5],
};

describe("routine scheduler", () => {
  it("only returns a routine inside its configured grace window", () => {
    expect(findDueRoutine([morning], new Date("2026-08-01T08:36:00"))?.id).toBe(
      "morning",
    );
    expect(findDueRoutine([morning], new Date("2026-08-01T08:41:00"))).toBe(
      undefined,
    );
  });

  it("selects the next eligible occurrence across weekdays", () => {
    expect(
      findNextRoutine([morning, weekday], new Date("2026-08-03T09:00:00"))?.id,
    ).toBe("weekday");
    expect(
      findNextRoutine([morning, weekday], new Date("2026-08-03T10:00:00"))?.id,
    ).toBe("morning");
  });

  it("creates a stable once-per-day occurrence key", () => {
    expect(routineOccurrenceKey(morning, new Date("2026-08-01T08:31:00"))).toBe(
      "morning:2026-8-1",
    );
  });
});
