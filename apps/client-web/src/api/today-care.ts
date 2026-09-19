export type TodayCare = {
  householdId: string;
  recipientId: string;
  localDate: string;
  timezone: string;
  generatedAt: string;
  counts: {
    total: number;
    confirmed: number;
    needsReview: number;
    pending: number;
    expired: number;
  };
  openTaskCount: number;
  items: { id: string; title: string; scheduledAt: string; status: string }[];
};

/** Reject invalid payloads while still inside the request's retryable error boundary. */
export const parseTodayCare = (
  value: unknown,
  householdId: string,
  recipientId: string,
): TodayCare => {
  const invalid = () => {
    throw new Error("照护信息格式异常，请刷新重试");
  };
  const record = (item: unknown): Record<string, unknown> =>
    item && typeof item === "object" && !Array.isArray(item)
      ? (item as Record<string, unknown>)
      : invalid();
  const text = (item: unknown): string =>
    typeof item === "string" && item.trim() ? item : invalid();
  const count = (item: unknown): number =>
    typeof item === "number" && Number.isSafeInteger(item) && item >= 0
      ? item
      : invalid();
  const instant = (item: unknown): string => {
    const result = text(item);
    if (!Number.isFinite(Date.parse(result))) invalid();
    return result;
  };
  const data = record(value);
  if (data.householdId !== householdId || data.recipientId !== recipientId) {
    throw new Error("照护信息不匹配，请刷新重试");
  }
  const timezone = text(data.timezone);
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone: timezone }).format();
  } catch {
    invalid();
  }
  const localDate = text(data.localDate);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(localDate) ||
    !Number.isFinite(Date.parse(localDate)) ||
    new Date(localDate).toISOString().slice(0, 10) !== localDate
  )
    invalid();
  const counts = record(data.counts);
  if (!Array.isArray(data.items) || data.items.length > 5) return invalid();
  return {
    householdId,
    recipientId,
    localDate,
    timezone,
    generatedAt: instant(data.generatedAt),
    counts: {
      total: count(counts.total),
      confirmed: count(counts.confirmed),
      needsReview: count(counts.needsReview),
      pending: count(counts.pending),
      expired: count(counts.expired),
    },
    openTaskCount: count(data.openTaskCount),
    items: data.items.map((value) => {
      const item = record(value);
      const status = text(item.status);
      if (
        !["NEEDS_FAMILY_REVIEW", "DUE", "AWAITING_CONFIRMATION"].includes(
          status,
        )
      )
        invalid();
      return {
        id: text(item.id),
        title: text(item.title),
        scheduledAt: instant(item.scheduledAt),
        status,
      };
    }),
  };
};

export const todayCareStatus = (
  item: TodayCare["items"][number],
  generatedAt: string,
): string =>
  item.status === "NEEDS_FAMILY_REVIEW"
    ? "待核验"
    : item.status === "DUE" &&
        Date.parse(item.scheduledAt) > Date.parse(generatedAt)
      ? "待提醒"
      : "待确认";
