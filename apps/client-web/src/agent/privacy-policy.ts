import type { AppState, MemoryItem, Routine } from "../domain/types";

export const isRoutinePermitted = (state: AppState, routine: Routine) =>
  routine.category !== "medication" ||
  state.consent.sensitiveMemoryApproved;

export const isMemoryPermitted = (state: AppState, memory: MemoryItem) =>
  memory.sensitivity === "normal" ||
  state.consent.sensitiveMemoryApproved;

export const permittedRoutines = (state: AppState) =>
  state.routines.filter(
    (routine) => routine.enabled && isRoutinePermitted(state, routine),
  );

export const permittedMemories = (state: AppState) =>
  state.memories.filter((memory) => isMemoryPermitted(state, memory));
