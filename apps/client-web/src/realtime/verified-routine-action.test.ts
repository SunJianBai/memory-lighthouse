import { describe, expect, it, vi } from 'vitest';
import { verifiedRoutineAction } from './verified-routine-action';
import type { Routine } from '../domain/types';

const due = { id: 'occ-1', occurrenceId: 'occ-1', enabled: true,
  occurrenceStatus: 'DUE', scheduledAtUtc: '2026-11-03T00:00:00Z',
  instructions: 'fresh instructions' } as Routine;

describe('authoritative routine dispatch', () => {
  it.each([[], [{ ...due, occurrenceStatus: 'NEEDS_FAMILY_REVIEW' }],
    [{ ...due, scheduledAtUtc: '2099-01-01T00:00:00Z' }]].map(rows => ({ rows })))('never sends unavailable or future content', async ({ rows }) => {
    const send = vi.fn();
    await verifiedRoutineAction({ read: async () => rows, isCurrent: () => true,
      now: () => new Date('2026-11-03T01:00:00Z'), occurrenceId: due.id, send });
    expect(send).not.toHaveBeenCalled();
  });
  it('uses the exact refreshed occurrence and never a cached sibling', async () => {
    const send = vi.fn(async () => true);
    expect(await verifiedRoutineAction({ read: async () => [{ ...due, id: 'sibling', occurrenceId: 'sibling' }, due],
      isCurrent: () => true, now: () => new Date('2026-11-03T01:00:00Z'), occurrenceId: due.id, send })).toBe(true);
    expect(send).toHaveBeenCalledExactlyOnceWith(due);
  });
  it('discards a read completed after session replacement', async () => {
    let current = true;
    const send = vi.fn();
    await verifiedRoutineAction({ read: async () => { current = false; return [due]; },
      isCurrent: () => current, now: () => new Date(), occurrenceId: due.id, send });
    expect(send).not.toHaveBeenCalled();
  });
  it('does not mask read errors with cached sends', async () => {
    const send = vi.fn();
    await expect(verifiedRoutineAction({ read: async () => { throw Error('offline'); },
      isCurrent: () => true, now: () => new Date(), send })).rejects.toThrow('offline');
    expect(send).not.toHaveBeenCalled();
  });
});
