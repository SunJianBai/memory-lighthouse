import {
  deterministicOccurrenceId,
  generateOccurrenceCandidates,
  localMinuteToUtc,
  hasFutureOccurrence,
} from './schedule-time';

describe('IANA schedule conversion', () => {
  const futureRule = {
    id: 'weekly',
    timezone: 'America/New_York',
    localTimeMinutes: 150,
    weekdayMask: 1,
    startDate: new Date('2026-01-01'),
    endDate: null,
    graceMinutes: 10,
    familyNoticeMinutes: 20,
  };
  it('searches beyond a skipped DST Sunday and the scheduler lookahead', () => {
    expect(
      hasFutureOccurrence(futureRule, new Date('2026-03-08T06:00:00Z')),
    ).toBe(true);
  });
  it('rejects a last one-time minute equal to the resume instant', () => {
    expect(
      hasFutureOccurrence(
        {
          ...futureRule,
          timezone: 'Asia/Shanghai',
          localTimeMinutes: 480,
          weekdayMask: 127,
          startDate: new Date('2026-08-01'),
          endDate: new Date('2026-08-01'),
        },
        new Date('2026-08-01T00:00:00Z'),
      ),
    ).toBe(false);
  });
  it('jumps to a far future start date and honors a finite end date', () => {
    expect(
      hasFutureOccurrence(
        { ...futureRule, startDate: new Date('2036-01-01') },
        new Date('2026-08-01'),
      ),
    ).toBe(true);
    expect(
      hasFutureOccurrence(
        { ...futureRule, endDate: new Date('2026-03-08') },
        new Date('2026-03-08T06:00:00Z'),
      ),
    ).toBe(false);
  });
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

  it.each(['2026-08-01T00:00:00.000Z', '2026-08-01T00:00:30.000Z'])(
    'does not backfill a resumed schedule at or before %s, even after restart',
    (effectiveFrom) => {
      const candidates = generateOccurrenceCandidates(
        {
          id: 'resumed-schedule',
          timezone: 'Asia/Shanghai',
          localTimeMinutes: 480,
          weekdayMask: 127,
          startDate: new Date('2026-08-01'),
          endDate: null,
          graceMinutes: 10,
          familyNoticeMinutes: 20,
          effectiveFromUtc: new Date(effectiveFrom),
        },
        new Date('2026-08-01T00:00:00.000Z'),
        new Date('2026-08-03T00:00:00.000Z'),
      );
      expect(
        candidates.map((candidate) => candidate.scheduledAtUtc.toISOString()),
      ).toEqual(['2026-08-02T00:00:00.000Z']);
    },
  );
});
