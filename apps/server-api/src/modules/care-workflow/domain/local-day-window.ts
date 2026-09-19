/** Calendar-day bounds in the recipient's zone, including 23/25-hour DST days. */
export function localDayWindow(now: Date, timezone: string) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
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
  const localDate = dateAt(now.getTime());
  const nominal = Date.parse(`${localDate}T00:00:00.000Z`);
  const nextDate = new Date(nominal + 86_400_000).toISOString().slice(0, 10);
  const boundary = (date: string) => {
    let low = nominal - 36 * 3_600_000;
    let high = nominal + 60 * 3_600_000;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (dateAt(middle) < date) low = middle + 1;
      else high = middle;
    }
    return new Date(low);
  };
  return { localDate, from: boundary(localDate), to: boundary(nextDate) };
}
