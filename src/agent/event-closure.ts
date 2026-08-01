import type { CareEvent } from "../domain/types";

export const resolveOpenTaskEvents = (
  events: CareEvent[],
  routineId: string | undefined,
  fallbackEventId?: string,
) =>
  events.map((event) => {
    const belongsToTask = routineId
      ? event.routineId === routineId
      : event.id === fallbackEventId;
    return belongsToTask && event.status === "open"
      ? { ...event, status: "resolved" as const }
      : event;
  });
