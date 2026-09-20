import { InvalidScheduleException } from '../care-workflow.errors';
import type { RoutineScheduleInput } from '../care-workflow.types';
import { localMinuteToUtc, parseIsoDate } from './schedule-time';

export function validateRoutineSchedule(input: RoutineScheduleInput) {
  if (
    !Number.isInteger(input.weekdayMask) ||
    input.weekdayMask < 1 ||
    input.weekdayMask > 127
  ) {
    throw new InvalidScheduleException('请至少选择一个星期');
  }
  if (
    !Number.isInteger(input.graceMinutes) ||
    input.graceMinutes < 0 ||
    input.graceMinutes > 1440
  ) {
    throw new InvalidScheduleException('确认等待时间必须在 0 到 1440 分钟之间');
  }
  if (
    !Number.isInteger(input.familyNoticeMinutes) ||
    input.familyNoticeMinutes < 0 ||
    input.familyNoticeMinutes > 10080
  ) {
    throw new InvalidScheduleException(
      '家属待办延迟必须在 0 到 10080 分钟之间',
    );
  }
  const timezone = input.timezone.trim();
  if (!timezone) throw new InvalidScheduleException('请选择时区');
  // Validate the zone and minute without rejecting a recurring DST gap.
  localMinuteToUtc(
    { year: 2026, month: 1, day: 15 },
    input.localTimeMinutes,
    timezone,
  );
  const startDate = parseIsoDate(input.startDate);
  const endDate = input.endDate ? parseIsoDate(input.endDate) : null;
  if (endDate && endDate < startDate)
    throw new InvalidScheduleException('结束日期不能早于开始日期');
  if (endDate) {
    const cursor = new Date(startDate);
    let matches = false;
    // At most seven dates are needed for any weekly mask, even for a long range.
    for (let day = 0; day < 7 && cursor <= endDate; day++) {
      if ((input.weekdayMask & (1 << cursor.getUTCDay())) !== 0) matches = true;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    if (!matches)
      throw new InvalidScheduleException(
        '日期范围内没有所选星期，请调整日期或重复周期',
      );
    if (
      startDate.getTime() === endDate.getTime() &&
      !localMinuteToUtc(
        {
          year: startDate.getUTCFullYear(),
          month: startDate.getUTCMonth() + 1,
          day: startDate.getUTCDate(),
        },
        input.localTimeMinutes,
        timezone,
      )
    ) {
      throw new InvalidScheduleException(
        '该日期的提醒时间因夏令时不存在，请选择其他时间',
      );
    }
  }
  return {
    timezone,
    localTimeMinutes: input.localTimeMinutes,
    weekdayMask: input.weekdayMask,
    startDate,
    endDate,
    graceMinutes: input.graceMinutes,
    familyNoticeMinutes: input.familyNoticeMinutes,
  };
}

type ValidSchedule = ReturnType<typeof validateRoutineSchedule>;
export function sameRoutineSchedule(
  left: ValidSchedule,
  right: ValidSchedule,
): boolean {
  return (
    left.timezone === right.timezone &&
    left.localTimeMinutes === right.localTimeMinutes &&
    left.weekdayMask === right.weekdayMask &&
    left.startDate.getTime() === right.startDate.getTime() &&
    left.endDate?.getTime() === right.endDate?.getTime() &&
    left.graceMinutes === right.graceMinutes &&
    left.familyNoticeMinutes === right.familyNoticeMinutes
  );
}
