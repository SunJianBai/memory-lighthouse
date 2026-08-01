import {
  deterministicOccurrenceId,
  generateOccurrenceCandidates,
  localMinuteToUtc,
} from './schedule-time';

describe('IANA schedule conversion', () => {
  it('creates the expected UTC instant across an ordinary timezone boundary', () => {
    expect(
      localMinuteToUtc(
        { year: 2026, month: 8, day: 2 },
        8 * 60 + 30,
        'Asia/Shanghai',
      )?.toISOString(),
    ).toBe('2026-08-02T00:30:00.000Z');
  });

  it('skips a non-existent wall-clock minute at the spring DST boundary', () => {
    expect(
      localMinuteToUtc(
        { year: 2026, month: 3, day: 8 },
        2 * 60 + 30,
        'America/New_York',
      ),
    ).toBeNull();
  });

  it('chooses the earlier UTC instant when a wall-clock minute repeats', () => {
    expect(
      localMinuteToUtc(
        { year: 2026, month: 11, day: 1 },
        1 * 60 + 30,
        'America/New_York',
      )?.toISOString(),
    ).toBe('2026-11-01T05:30:00.000Z');
  });

  it('generates stable ids and deadlines for the same schedule window', () => {
    const schedule = {
      id: 'schedule-1',
      timezone: 'Asia/Shanghai',
      localTimeMinutes: 8 * 60,
      weekdayMask: 0b1111111,
      startDate: new Date('2026-08-01T00:00:00.000Z'),
      endDate: null,
      graceMinutes: 10,
      familyNoticeMinutes: 20,
    };
    const first = generateOccurrenceCandidates(
      schedule,
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-08-02T00:00:00.000Z'),
    );
    const second = generateOccurrenceCandidates(
      schedule,
      new Date('2026-08-01T00:00:00.000Z'),
      new Date('2026-08-02T00:00:00.000Z'),
    );
    expect(second).toEqual(first);
    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({
      id: deterministicOccurrenceId(
        'schedule-1',
        new Date('2026-08-01T00:00:00.000Z'),
      ),
      scheduledAtUtc: new Date('2026-08-01T00:00:00.000Z'),
      confirmationDeadlineAt: new Date('2026-08-01T00:10:00.000Z'),
      escalationAt: new Date('2026-08-01T00:30:00.000Z'),
    });
  });
});
