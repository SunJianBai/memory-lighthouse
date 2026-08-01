import type { AgentState, Routine } from "../domain/types";

const minutesSinceMidnight = (date: Date) =>
  date.getHours() * 60 + date.getMinutes();

const scheduledMinutes = (routine: Routine) => {
  const [hours = 0, minutes = 0] = routine.scheduledTime
    .split(":")
    .map(Number);
  return hours * 60 + minutes;
};

export const findDueRoutine = (
  routines: Routine[],
  now: Date,
): Routine | undefined => {
  const currentMinutes = minutesSinceMidnight(now);
  return routines.find((routine) => {
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
    (candidate) =>
      candidate.id === agent.activeRoutineId && candidate.enabled,
  );
  if (!routine) return false;
  const transitionedAt = new Date(agent.lastTransitionAt).getTime();
  if (!Number.isFinite(transitionedAt)) return false;
  return (
    now.getTime() - transitionedAt >=
    Math.max(1, routine.familyNoticeMinutes) * 60_000
  );
};
