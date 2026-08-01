import { describe, expect, it } from "vitest";
import type { Routine } from "../domain/types";
import {
  findDueRoutine,
  findNextRoutine,
  routineOccurrenceKey,
  shouldNotifyFamily,
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

  it("uses the server occurrence timestamp and id for a materialized reminder", () => {
    const occurrence: Routine = {
      ...morning,
      id: "routine-1",
      occurrenceId: "occurrence-1",
      occurrenceVersion: 2,
      occurrenceStatus: "AWAITING_CONFIRMATION",
      scheduledAtUtc: "2026-08-01T00:30:00.000Z",
    };

    expect(
      findDueRoutine([occurrence], new Date("2026-08-01T00:31:00.000Z")),
    ).toBe(occurrence);
    expect(
      routineOccurrenceKey(occurrence, new Date("2026-08-01T00:31:00.000Z")),
    ).toBe("occurrence-1");
  });

  it("leaves escalation timing to the server for materialized occurrences", () => {
    const occurrence: Routine = {
      ...morning,
      occurrenceId: "occurrence-1",
      occurrenceStatus: "AWAITING_CONFIRMATION",
      scheduledAtUtc: "2026-08-01T00:30:00.000Z",
    };
    const agent = {
      phase: "awaiting_confirmation" as const,
      activeRoutineId: occurrence.id,
      reminderCount: 1,
      lastTransitionAt: "2026-08-01T00:30:00.000Z",
      message: "等待确认",
    };

    expect(
      shouldNotifyFamily(
        agent,
        [occurrence],
        new Date("2026-08-01T02:30:00.000Z"),
      ),
    ).toBe(false);
  });

  it("notifies family only after the active routine timeout", () => {
    const agent = {
      phase: "awaiting_confirmation" as const,
      activeRoutineId: morning.id,
      reminderCount: 1,
      lastTransitionAt: "2026-08-01T08:30:00.000Z",
      message: "等待确认",
    };

    expect(
      shouldNotifyFamily(
        agent,
        [morning],
        new Date("2026-08-01T08:49:59.000Z"),
      ),
    ).toBe(false);
    expect(
      shouldNotifyFamily(
        agent,
        [morning],
        new Date("2026-08-01T08:50:00.000Z"),
      ),
    ).toBe(true);
    expect(
      shouldNotifyFamily(
        { ...agent, phase: "completed" },
        [morning],
        new Date("2026-08-01T09:00:00.000Z"),
      ),
    ).toBe(false);
  });
});
