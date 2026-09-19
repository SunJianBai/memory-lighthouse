import { localDayWindow } from './local-day-window';

describe('recipient calendar day', () => {
  it.each([
    [
      '2026-09-19T18:00:00Z',
      'Asia/Shanghai',
      '2026-09-20',
      '2026-09-19T16:00:00.000Z',
      24,
    ],
    [
      '2026-03-29T12:00:00Z',
      'Europe/Berlin',
      '2026-03-29',
      '2026-03-28T23:00:00.000Z',
      23,
    ],
    [
      '2026-10-25T12:00:00Z',
      'Europe/Berlin',
      '2026-10-25',
      '2026-10-24T22:00:00.000Z',
      25,
    ],
    [
      '2026-09-20T00:00:00Z',
      'Asia/Kathmandu',
      '2026-09-20',
      '2026-09-19T18:15:00.000Z',
      24,
    ],
    [
      '2018-11-04T12:00:00Z',
      'America/Sao_Paulo',
      '2018-11-04',
      '2018-11-04T03:00:00.000Z',
      23,
    ],
  ])('resolves %s in %s', (now, zone, date, from, hours) => {
    const result = localDayWindow(new Date(now), zone);
    expect(result.localDate).toBe(date);
    expect(result.from.toISOString()).toBe(from);
    expect(result.to.getTime() - result.from.getTime()).toBe(
      Number(hours) * 3_600_000,
    );
  });
});
