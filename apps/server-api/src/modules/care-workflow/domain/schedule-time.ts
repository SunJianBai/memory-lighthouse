import { createHash } from 'node:crypto';

import { InvalidScheduleException } from '../care-workflow.errors';

export interface LocalDate {
  year: number;
  month: number;
  day: number;
}

export interface ScheduleDefinition {
  id: string;
  timezone: string;
  localTimeMinutes: number;
  weekdayMask: number;
  startDate: Date;
  endDate: Date | null;
  graceMinutes: number;
  familyNoticeMinutes: number;
}

export interface OccurrenceCandidate {
  id: string;
  scheduleId: string;
  scheduledAtUtc: Date;
  scheduledLocalDate: Date;
  confirmationDeadlineAt: Date;
  escalationAt: Date;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();
const BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

function formatter(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  let created: Intl.DateTimeFormat;
  try {
    created = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      calendar: 'iso8601',
      numberingSystem: 'latn',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
  } catch {
    throw new InvalidScheduleException(`未知 IANA 时区：${timezone}`);
  }
  formatterCache.set(timezone, created);
  return created;
}

function zonedParts(instant: Date, timezone: string) {
  const parts = formatter(timezone).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((candidate) => candidate.type === type)?.value;
    if (!part) throw new InvalidScheduleException('无法解析 IANA 时区');
    return Number(part);
  };
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
  };
}

function sameLocalMinute(
  instant: Date,
  timezone: string,
  date: LocalDate,
  hour: number,
  minute: number,
): boolean {
  const actual = zonedParts(instant, timezone);
  return (
    actual.year === date.year &&
    actual.month === date.month &&
    actual.day === date.day &&
    actual.hour === hour &&
    actual.minute === minute
  );
}

/**
 * Resolves an IANA-zone wall-clock minute without a timezone dependency.
 * Non-existent DST minutes are skipped. If a minute repeats, the earlier UTC
 * instant is chosen, so every schedule has deterministic semantics.
 */
export function localMinuteToUtc(
  date: LocalDate,
  localTimeMinutes: number,
  timezone: string,
): Date | null {
  if (
    !Number.isInteger(localTimeMinutes) ||
    localTimeMinutes < 0 ||
    localTimeMinutes > 1439
  ) {
    throw new InvalidScheduleException(
      'localTimeMinutes 必须在 0 到 1439 之间',
    );
  }
  const hour = Math.floor(localTimeMinutes / 60);
  const minute = localTimeMinutes % 60;
  const wallClockAsUtc = Date.UTC(
    date.year,
    date.month - 1,
    date.day,
    hour,
    minute,
  );

  // A zone offset can change near the target minute. Sampling around the wall
  // clock captures both sides of DST transitions, including half-hour zones.
  const offsets = new Set<number>();
  for (let deltaHours = -36; deltaHours <= 36; deltaHours += 3) {
    const sample = new Date(wallClockAsUtc + deltaHours * 3_600_000);
    const local = zonedParts(sample, timezone);
    const localAsUtc = Date.UTC(
      local.year,
      local.month - 1,
      local.day,
      local.hour,
      local.minute,
    );
    offsets.add(localAsUtc - sample.getTime());
  }

  const matches = [...offsets]
    .map((offset) => new Date(wallClockAsUtc - offset))
    .filter((candidate) =>
      sameLocalMinute(candidate, timezone, date, hour, minute),
    )
    .sort((left, right) => left.getTime() - right.getTime());
  return matches[0] ?? null;
}

function localDateFromUtcDate(value: Date): LocalDate {
  return {
    year: value.getUTCFullYear(),
    month: value.getUTCMonth() + 1,
    day: value.getUTCDate(),
  };
}

function dateKey(date: LocalDate): number {
  return date.year * 10_000 + date.month * 100 + date.day;
}

function encodeBase32(bytes: Buffer, length: number): string {
  let value = BigInt(`0x${bytes.toString('hex')}`);
  let result = '';
  for (let index = 0; index < length; index += 1) {
    result = BASE32[Number(value & 31n)] + result;
    value >>= 5n;
  }
  return result;
}

export function deterministicOccurrenceId(
  scheduleId: string,
  scheduledAtUtc: Date,
): string {
  const digest = createHash('sha256')
    .update(scheduleId)
    .update('\0')
    .update(scheduledAtUtc.toISOString())
    .digest();
  return encodeBase32(digest, 26);
}

export function generateOccurrenceCandidates(
  schedule: ScheduleDefinition,
  windowStartUtc: Date,
  windowEndUtc: Date,
): OccurrenceCandidate[] {
  if (windowEndUtc <= windowStartUtc) {
    throw new InvalidScheduleException('调度窗口结束时间必须晚于开始时间');
  }
  if (
    !Number.isInteger(schedule.weekdayMask) ||
    schedule.weekdayMask < 1 ||
    schedule.weekdayMask > 0b1111111
  ) {
    throw new InvalidScheduleException('weekdayMask 必须选择至少一天');
  }
  formatter(schedule.timezone);

  const startLocal = zonedParts(
    new Date(windowStartUtc.getTime() - 36 * 3_600_000),
    schedule.timezone,
  );
  const endLocal = zonedParts(
    new Date(windowEndUtc.getTime() + 36 * 3_600_000),
    schedule.timezone,
  );
  const cursor = new Date(
    Date.UTC(startLocal.year, startLocal.month - 1, startLocal.day),
  );
  const finalDateKey = dateKey(endLocal);
  const scheduleStart = dateKey(localDateFromUtcDate(schedule.startDate));
  const scheduleEnd = schedule.endDate
    ? dateKey(localDateFromUtcDate(schedule.endDate))
    : Number.POSITIVE_INFINITY;
  const result: OccurrenceCandidate[] = [];

  while (dateKey(localDateFromUtcDate(cursor)) <= finalDateKey) {
    const localDate = localDateFromUtcDate(cursor);
    const key = dateKey(localDate);
    const weekday = cursor.getUTCDay();
    if (
      key >= scheduleStart &&
      key <= scheduleEnd &&
      (schedule.weekdayMask & (1 << weekday)) !== 0
    ) {
      const scheduledAtUtc = localMinuteToUtc(
        localDate,
        schedule.localTimeMinutes,
        schedule.timezone,
      );
      if (
        scheduledAtUtc &&
        scheduledAtUtc >= windowStartUtc &&
        scheduledAtUtc < windowEndUtc
      ) {
        const confirmationDeadlineAt = new Date(
          scheduledAtUtc.getTime() + schedule.graceMinutes * 60_000,
        );
        const escalationAt = new Date(
          confirmationDeadlineAt.getTime() +
            schedule.familyNoticeMinutes * 60_000,
        );
        result.push({
          id: deterministicOccurrenceId(schedule.id, scheduledAtUtc),
          scheduleId: schedule.id,
          scheduledAtUtc,
          scheduledLocalDate: new Date(
            Date.UTC(localDate.year, localDate.month - 1, localDate.day),
          ),
          confirmationDeadlineAt,
          escalationAt,
        });
      }
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return result;
}

export function parseIsoDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InvalidScheduleException('日期必须使用 YYYY-MM-DD');
  }
  const result = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(result.getTime()) ||
    result.toISOString().slice(0, 10) !== value
  ) {
    throw new InvalidScheduleException('日期无效');
  }
  return result;
}
