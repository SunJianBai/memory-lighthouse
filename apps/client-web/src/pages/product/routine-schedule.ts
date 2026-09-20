import type { RoutineScheduleView } from "../../api/types";

export const weekdays = [
  { bit: 2, label: "周一" },
  { bit: 4, label: "周二" },
  { bit: 8, label: "周三" },
  { bit: 16, label: "周四" },
  { bit: 32, label: "周五" },
  { bit: 64, label: "周六" },
  { bit: 1, label: "周日" },
] as const;
export const repeatOptions = [
  { value: "once", label: "仅一次", mask: 127 },
  { value: "daily", label: "每天", mask: 127 },
  { value: "weekdays", label: "周一至周五", mask: 62 },
  { value: "weekends", label: "周末", mask: 65 },
  { value: "custom", label: "自选星期", mask: 127 },
] as const;
export type RepeatMode = (typeof repeatOptions)[number]["value"];
export type RoutineScheduleInput = Omit<
  RoutineScheduleView,
  "id" | "scheduleVersion"
>;
export type RoutineFormInput = {
  type: string;
  title: string;
  instructions: string;
  confirmationQuestion: string;
  schedule: RoutineScheduleInput;
};

export function repeatMode(schedule?: RoutineScheduleView): RepeatMode {
  if (!schedule) return "daily";
  if (schedule.endDate === schedule.startDate) return "once";
  return schedule.weekdayMask === 127
    ? "daily"
    : schedule.weekdayMask === 62
      ? "weekdays"
      : schedule.weekdayMask === 65
        ? "weekends"
        : "custom";
}
export const scheduleTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

function parsedDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? date
    : null;
}
export function scheduleError(schedule: RoutineScheduleInput): string {
  const start = parsedDate(schedule.startDate);
  const end = schedule.endDate ? parsedDate(schedule.endDate) : null;
  if (!start || (schedule.endDate && !end)) return "请选择有效日期";
  if (end && end < start) return "结束日期不能早于开始日期";
  if (
    !Number.isInteger(schedule.localTimeMinutes) ||
    schedule.localTimeMinutes < 0 ||
    schedule.localTimeMinutes > 1439
  )
    return "请选择有效提醒时间";
  if (
    !Number.isInteger(schedule.weekdayMask) ||
    schedule.weekdayMask < 1 ||
    schedule.weekdayMask > 127
  )
    return "请至少选择一个星期";
  if (
    !Number.isInteger(schedule.graceMinutes) ||
    schedule.graceMinutes < 0 ||
    schedule.graceMinutes > 1440
  )
    return "确认等待时间应在 0–1440 分钟之间";
  if (
    !Number.isInteger(schedule.familyNoticeMinutes) ||
    schedule.familyNoticeMinutes < 0 ||
    schedule.familyNoticeMinutes > 10080
  )
    return "家属待办延迟应在 0–10080 分钟之间";
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: schedule.timezone }).format(
      start,
    );
  } catch {
    return "提醒时区无效";
  }
  if (end) {
    let matched = false;
    for (
      let i = 0;
      i < 7 && start <= end;
      i++, start.setUTCDate(start.getUTCDate() + 1)
    ) {
      if (schedule.weekdayMask & (1 << start.getUTCDay())) matched = true;
    }
    if (!matched) return "日期范围内没有所选星期，请调整日期或重复周期";
  }
  return "";
}
export function scheduleSummary(schedule?: RoutineScheduleInput): string {
  if (!schedule || scheduleError(schedule)) return "提醒规则待核对";
  const time = `${scheduleTime(schedule.localTimeMinutes)}（${schedule.timezone}）`;
  if (schedule.startDate === schedule.endDate)
    return `仅一次 · ${schedule.startDate} ${time}`;
  const repeat =
    schedule.weekdayMask === 127
      ? "每天"
      : schedule.weekdayMask === 62
        ? "周一至周五"
        : schedule.weekdayMask === 65
          ? "周末"
          : weekdays
              .filter((day) => schedule.weekdayMask & day.bit)
              .map((day) => day.label)
              .join("、");
  return `${repeat} ${time} · ${schedule.startDate}起，${schedule.endDate ? `至${schedule.endDate}` : "持续重复"}`;
}
