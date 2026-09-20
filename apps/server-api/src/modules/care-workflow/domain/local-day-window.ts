function dateFormatter(timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateAt = (instant: number): string => {
    const parts = formatter.formatToParts(new Date(instant));
    const part = (type: string) =>
      parts.find((value) => value.type === type)!.value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  return dateAt;
}

function dateBoundary(date: string, dateAt: (instant: number) => string) {
  const nominal = Date.parse(`${date}T00:00:00.000Z`);
  let low = nominal - 36 * 3_600_000;
  let high = nominal + 60 * 3_600_000;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (dateAt(middle) < date) low = middle + 1;
    else high = middle;
  }
  return new Date(low);
}

/** Inclusive, already validated local dates; skipped calendar days have empty windows. */
export function localDateRangeWindow(
  startDate: string,
  endDate: string,
  timezone: string,
) {
  const dateAt = dateFormatter(timezone);
  const nextDate = new Date(Date.parse(`${endDate}T00:00:00.000Z`) + 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    from: dateBoundary(startDate, dateAt),
    to: dateBoundary(nextDate, dateAt),
  };
}

/** Calendar-day bounds in the recipient's zone, including 23/25-hour DST days. */
export function localDayWindow(now: Date, timezone: string) {
  const localDate = dateFormatter(timezone)(now.getTime());
  return { localDate, ...localDateRangeWindow(localDate, localDate, timezone) };
}
