import {
  validateRoutineSchedule,
  sameRoutineSchedule,
} from './routine-schedule';
import { generateOccurrenceCandidates } from './schedule-time';

const input = {
  timezone: 'Asia/Shanghai',
  localTimeMinutes: 540,
  weekdayMask: 62,
  startDate: '2026-09-21',
  endDate: '2026-09-27',
  graceMinutes: 5,
  familyNoticeMinutes: 15,
};
describe('bounded and one-time routine schedules', () => {
  it.each([
    { weekdayMask: 0 },
    { weekdayMask: 128 },
    { startDate: '2026-02-30' },
    { endDate: '2026-09-20' },
    { endDate: '2026-09-22', weekdayMask: 65 },
    { timezone: 'not/a-zone' },
    { localTimeMinutes: 1440 },
  ])('rejects an invalid or non-firing range %j', (change) => {
    expect(() => validateRoutineSchedule({ ...input, ...change })).toThrow();
  });
  it('generates only selected weekdays including both date bounds', () => {
    const schedule = { id: 'weekly', ...validateRoutineSchedule(input) };
    const rows = generateOccurrenceCandidates(
      schedule,
      new Date('2026-09-20'),
      new Date('2026-09-29'),
    );
    expect(
      rows.map((row) => row.scheduledLocalDate.toISOString().slice(0, 10)),
    ).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
    ]);
  });
  it('generates one stable occurrence for a one-time appointment', () => {
    const schedule = {
      id: 'once',
      ...validateRoutineSchedule({
        ...input,
        startDate: '2026-09-26',
        endDate: '2026-09-26',
        weekdayMask: 127,
      }),
    };
    const rows = generateOccurrenceCandidates(
      schedule,
      new Date('2026-09-20'),
      new Date('2026-10-01'),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduledAtUtc.toISOString()).toBe(
      '2026-09-26T01:00:00.000Z',
    );
    expect(
      generateOccurrenceCandidates(
        schedule,
        new Date('2026-09-20'),
        new Date('2026-10-01'),
      ),
    ).toEqual(rows);
  });
  it('rejects a nonexistent single local time but accepts a recurring DST rule', () => {
    const gap = {
      ...input,
      timezone: 'America/New_York',
      localTimeMinutes: 150,
      startDate: '2026-03-08',
      endDate: '2026-03-08',
      weekdayMask: 1,
    };
    expect(() => validateRoutineSchedule(gap)).toThrow('夏令时');
    expect(() =>
      validateRoutineSchedule({ ...gap, endDate: undefined }),
    ).not.toThrow();
  });
  it('preserves identity only when every effective schedule field is unchanged', () => {
    const current = validateRoutineSchedule(input);
    expect(sameRoutineSchedule(current, validateRoutineSchedule(input))).toBe(
      true,
    );
    for (const change of [
      { timezone: 'UTC' },
      { localTimeMinutes: 541 },
      { weekdayMask: 127 },
      { startDate: '2026-09-22' },
      { endDate: '2026-09-28' },
      { graceMinutes: 6 },
      { familyNoticeMinutes: 16 },
    ]) {
      expect(
        sameRoutineSchedule(
          current,
          validateRoutineSchedule({ ...input, ...change }),
        ),
      ).toBe(false);
    }
  });
});
