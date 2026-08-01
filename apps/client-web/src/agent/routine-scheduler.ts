import type { AgentState, Routine } from "../domain/types";

const minutesSinceMidnight = (date: Date) =>
  date.getHours() * 60 + date.getMinutes();

const scheduledMinutes = (routine: Routine) => {
  const [hours = 0, minutes = 0] = routine.scheduledTime.split(":").map(Number);
  return hours * 60 + minutes;
};

export const findDueRoutine = (
  routines: Routine[],
  now: Date,
): Routine | undefined => {
  const currentMinutes = minutesSinceMidnight(now);
  return routines.find((routine) => {
    if (routine.scheduledAtUtc) {
      const scheduledAt = new Date(routine.scheduledAtUtc).getTime();
      return (
        routine.enabled &&
        ["DUE", "AWAITING_CONFIRMATION"].includes(
          routine.occurrenceStatus ?? "",
        ) &&
        Number.isFinite(scheduledAt) &&
        now.getTime() >= scheduledAt
      );
    }
    if (!routine.enabled || !routine.weekdays.includes(now.getDay())) {
      return false;
    }
    const elapsed = currentMinutes - scheduledMinutes(routine);
    return elapsed >= 0 && elapsed <= Math.max(1, routine.graceMinutes);
  });
};

export const findNextRoutine = (
  routines: Routine[],
  now: Date,
): Routine | undefined => {
  const enabled = routines.filter((routine) => routine.enabled);
  let best: { routine: Routine; distance: number } | undefined;

  for (const routine of enabled) {
    if (routine.scheduledAtUtc) {
      const distance =
        new Date(routine.scheduledAtUtc).getTime() - now.getTime();
      if (
        Number.isFinite(distance) &&
        distance >= 0 &&
        (!best || distance < best.distance)
      ) {
        best = { routine, distance };
      }
      continue;
    }
    for (let dayOffset = 0; dayOffset < 7; dayOffset += 1) {
      const candidate = new Date(now);
      candidate.setHours(0, 0, 0, 0);
      candidate.setDate(candidate.getDate() + dayOffset);
      if (!routine.weekdays.includes(candidate.getDay())) continue;
      candidate.setMinutes(scheduledMinutes(routine));
      const distance = candidate.getTime() - now.getTime();
      if (distance < 0) continue;
      if (!best || distance < best.distance) {
        best = { routine, distance };
      }
      break;
    }
  }

  return best?.routine ?? enabled[0];
};

export const routineOccurrenceKey = (routine: Routine, date: Date) =>
  routine.occurrenceId ??
  `${routine.id}:${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;

export const shouldNotifyFamily = (
  agent: AgentState,
  routines: Routine[],
  now: Date,
) => {
  if (agent.phase !== "awaiting_confirmation" || !agent.activeRoutineId) {
    return false;
  }
  const routine = routines.find(
    (candidate) => candidate.id === agent.activeRoutineId && candidate.enabled,
  );
  if (!routine) return false;
  if (routine.occurrenceId) return false;
  const transitionedAt = new Date(agent.lastTransitionAt).getTime();
  if (!Number.isFinite(transitionedAt)) return false;
  return (
    now.getTime() - transitionedAt >=
    Math.max(1, routine.familyNoticeMinutes) * 60_000
  );
};
