import { describe, expect, it } from "vitest";
import type { CareEvent } from "../domain/types";
import { resolveOpenTaskEvents } from "./event-closure";

const event = (
  id: string,
  routineId: string,
  status: CareEvent["status"] = "open",
): CareEvent => ({
  id,
  routineId,
  status,
  type: "routine_due",
  severity: "info",
  title: id,
  summary: id,
  occurredAt: "2026-08-01T08:30:00.000Z",
  source: "agent",
});

describe("resolveOpenTaskEvents", () => {
  it("closes every open event for the completed routine only", () => {
    const result = resolveOpenTaskEvents(
      [event("due", "morning"), event("reminder", "morning"), event("other", "night")],
      "morning",
    );
    expect(result.map(({ id, status }) => [id, status])).toEqual([
      ["due", "resolved"],
      ["reminder", "resolved"],
      ["other", "open"],
    ]);
  });

  it("does not reopen an already resolved event", () => {
    expect(
      resolveOpenTaskEvents([event("done", "morning", "resolved")], "morning"),
    ).toEqual([event("done", "morning", "resolved")]);
  });
});
