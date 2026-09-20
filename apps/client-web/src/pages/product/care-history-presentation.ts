const occurrenceLabels: Record<string, string> = {
  DUE: "待提醒",
  AWAITING_CONFIRMATION: "待本人确认",
  NEEDS_FAMILY_REVIEW: "待家属核验",
  CONFIRMED: "已确认",
  EXPIRED: "已关闭",
};
const sourceLabels: Record<string, string> = {
  FAMILY: "家属",
  RECIPIENT: "本人",
  ROUTINE_SCHEDULER: "日程提醒",
  COMPANION_DEVICE: "陪伴设备",
};
const eventLabels: Record<string, string> = {
  ROUTINE_CONFIRMED: "日程确认",
  ROUTINE_NOT_CONFIRMED: "未完成核验",
  ROUTINE_CONFIRMATION_MISSING: "待核验提醒",
  RECIPIENT_REQUESTED_FAMILY_CONTACT: "联系家人请求",
};

function label(
  labels: Record<string, string>,
  value: string,
  fallback: string,
) {
  return Object.hasOwn(labels, value) ? labels[value] : fallback;
}

export const occurrenceStatusLabel = (value: string) =>
  label(occurrenceLabels, value, "状态未知");
export const careEventSourceLabel = (value: string) =>
  label(sourceLabels, value, "来源待确认");
export const careEventTypeLabel = (value: string) =>
  label(eventLabels, value, "其他动态");
export const careEventSeverityLabel = (value: string) =>
  value === "INFO" ? "一般记录" : value === "ATTENTION" ? "需关注" : "级别未知";

function timezoneError(timezone: string | undefined): string | undefined {
  if (!timezone?.trim()) return "时区未设置";
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: timezone });
    return undefined;
  } catch {
    return "时区无效";
  }
}

export function careHistoryTimezoneLabel(timezone: string | undefined): string {
  return `长者${timezoneError(timezone) ?? `时区：${timezone}`}`;
}

export function formatCareHistoryTime(
  value: string,
  timezone: string | undefined,
): { text: string; dateTime?: string } {
  // An absolute instant must contain an offset; never interpret a wall time in the viewer's zone.
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/i.test(
      value,
    )
  )
    return { text: "时间未知" };
  const instant = new Date(value);
  if (!Number.isFinite(instant.getTime())) return { text: "时间未知" };
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (
    !Number.isFinite(day.getTime()) ||
    day.toISOString().slice(0, 10) !== value.slice(0, 10)
  )
    return { text: "时间未知" };
  const error = timezoneError(timezone);
  if (error) return { text: error };
  const parts = new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)!.value;
  return {
    text: `${part("year")}-${part("month")}-${part("day")} ${part("hour")}:${part("minute")}`,
    dateTime: instant.toISOString(),
  };
}
