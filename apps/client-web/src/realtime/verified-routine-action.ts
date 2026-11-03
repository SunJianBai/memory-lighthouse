import type { Routine } from '../domain/types';

/** The caller owns the single-flight lane and invalidates it on every stop. */
export async function verifiedRoutineAction(options: {
  read: () => Promise<Routine[]>;
  isCurrent: () => boolean;
  now: () => Date;
  occurrenceId?: string;
  publish?: (routines: Routine[]) => void;
  send: (routine: Routine) => Promise<boolean>;
}): Promise<boolean> {
  const routines = await options.read();
  if (!options.isCurrent()) return false;
  options.publish?.(routines);
  const now = options.now().getTime();
  const target = routines.find(routine =>
    routine.enabled && routine.occurrenceId &&
    (!options.occurrenceId || routine.occurrenceId === options.occurrenceId) &&
    ['DUE', 'AWAITING_CONFIRMATION'].includes(routine.occurrenceStatus ?? '') &&
    Number.isFinite(Date.parse(routine.scheduledAtUtc ?? '')) &&
    Date.parse(routine.scheduledAtUtc!) <= now);
  if (!target || !options.isCurrent()) return false;
  const sent = await options.send(target);
  return options.isCurrent() && sent;
}
