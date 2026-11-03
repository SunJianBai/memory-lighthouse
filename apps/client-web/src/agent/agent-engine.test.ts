import { describe, expect, it } from "vitest";
import { createInitialAgentState, transitionAgent } from "./agent-engine";

describe("agent state machine", () => {
  it("closes a routine after explicit user confirmation", () => {
    const started = transitionAgent(createInitialAgentState("t0"), {
      type: "SESSION_STARTED",
      at: "t1",
    });
    const due = transitionAgent(started, {
      type: "ROUTINE_DUE",
      routineId: "routine-1",
      at: "t2",
    });
    const reminded = transitionAgent(due, {
      type: "REMINDER_DELIVERED",
      at: "t3",
    });
    const completed = transitionAgent(reminded, {
      type: "USER_CONFIRMED",
      routineId: "routine-1",
      at: "t4",
    });

    expect(completed.phase).toBe("completed");
    expect(completed.activeRoutineId).toBe("routine-1");
    expect(completed.reminderCount).toBe(1);
  });

  it("marks silence as needing attention rather than an emergency", () => {
    const awaiting = {
      ...createInitialAgentState("t0"),
      phase: "awaiting_confirmation" as const,
      activeRoutineId: "routine-1",
    };
    const result = transitionAgent(awaiting, {
      type: "CONFIRMATION_TIMEOUT",
      routineId: "routine-1",
      at: "t1",
    });

    expect(result.phase).toBe("needs_attention");
    expect(result.message).toContain("待家属查看");
  });

  it("ignores a confirmation queued for a different occurrence in the same render batch", () => {
    const remindingB = transitionAgent(createInitialAgentState("t0"), {
      type: "ROUTINE_DUE", routineId: "occurrence-B", at: "t1",
    });
    const awaitingB = transitionAgent(remindingB, {
      type: "REMINDER_DELIVERED", at: "t2",
    });
    expect(transitionAgent(awaitingB, {
      type: "USER_CONFIRMED", routineId: "occurrence-A", at: "t3",
    })).toEqual(awaitingB);
    expect(transitionAgent(awaitingB, {
      type: "USER_CONFIRMED", routineId: "occurrence-B", at: "t4",
    }).phase).toBe("completed");
  });

  it("rejects an early confirmation and accepts an explicit family request", () => {
    const observing = transitionAgent(createInitialAgentState("t0"), {
      type: "SESSION_STARTED",
      at: "t1",
    });

    expect(
      transitionAgent(observing, { type: "USER_CONFIRMED", routineId: "routine-1", at: "t2" }),
    ).toEqual(observing);
    expect(
      transitionAgent(observing, { type: "FAMILY_REQUESTED", routineId: undefined, at: "t3" })
        .phase,
    ).toBe("needs_attention");
  });

  it.each(["CONFIRMATION_TIMEOUT", "FAMILY_REQUESTED"] as const)("ignores %s for an earlier occurrence in the same render batch", type => {
    const remindingB = transitionAgent(createInitialAgentState("t0"), {
      type: "ROUTINE_DUE", routineId: "occurrence-B", at: "t1",
    });
    const awaitingB = transitionAgent(remindingB, {
      type: "REMINDER_DELIVERED", at: "t2",
    });
    expect(transitionAgent(awaitingB, {
      type, routineId: "occurrence-A", at: "t3",
    })).toEqual(awaitingB);
    expect(transitionAgent(awaitingB, {
      type, routineId: "occurrence-B", at: "t4",
    }).phase).toBe("needs_attention");
  });

  it("ignores a general family request queued before a reminder was delivered", () => {
    const awaiting = {
      ...createInitialAgentState("t0"), phase: "awaiting_confirmation" as const,
      activeRoutineId: "routine-1",
    };
    expect(transitionAgent(awaiting, {
      type: "FAMILY_REQUESTED", routineId: undefined, at: "t1",
    })).toEqual(awaiting);
  });
});
