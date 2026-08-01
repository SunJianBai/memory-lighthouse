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
      at: "t1",
    });

    expect(result.phase).toBe("needs_attention");
    expect(result.message).toContain("待家属查看");
  });
});
