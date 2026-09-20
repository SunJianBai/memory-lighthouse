import { ApiError, readableError } from "./api-client";
import type { CareEventView, OccurrenceView } from "./types";

export type CareHistoryKind = "occurrences" | "events";
export type CareHistoryItem = OccurrenceView | CareEventView;
export type CareHistoryFilter = {
  startDate?: string;
  endDate?: string;
  status?: string;
};
export type CareHistoryPage = {
  items: CareHistoryItem[];
  nextCursor: string | null;
  timezone: string;
  from: string | null;
  to: string | null;
};
export type CareHistoryState = {
  filter: CareHistoryFilter;
  page: CareHistoryPage | null;
  loading: boolean;
  appending: boolean;
  error: string;
  retry: "refresh" | "more";
};

export function historyDateError(start: string, end: string): string {
  const date = (value: string) => {
    const time = Date.parse(`${value}T00:00:00.000Z`);
    return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(time) &&
      new Date(time).toISOString().slice(0, 10) === value &&
      value >= "1900-01-01" &&
      value <= "9998-12-31"
      ? time
      : NaN;
  };
  const from = date(start),
    to = date(end);
  if (!Number.isFinite(from) || !Number.isFinite(to))
    return "请填写有效的开始和结束日期";
  if (to < from) return "结束日期不能早于开始日期";
  if ((to - from) / 86_400_000 >= 31)
    return "每次最多查询 31 天，请缩小日期范围";
  return "";
}

export function recentHistoryDates(
  timezone: string | undefined,
  now = new Date(),
) {
  if (!timezone) return { startDate: "", endDate: "" };
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const part = (type: string) =>
      parts.find((item) => item.type === type)!.value;
    const endDate = `${part("year")}-${part("month")}-${part("day")}`;
    const startDate = new Date(
      Date.parse(`${endDate}T00:00:00Z`) - 6 * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    return { startDate, endDate };
  } catch {
    return { startDate: "", endDate: "" };
  }
}

function parsePage(
  value: unknown,
  householdId: string,
  recipientId: string,
  kind: CareHistoryKind,
): CareHistoryPage {
  if (!value || typeof value !== "object")
    throw new Error("记录响应无效，请刷新重试");
  const page = value as CareHistoryPage;
  if (
    !Array.isArray(page.items) ||
    page.items.length > 30 ||
    typeof page.timezone !== "string" ||
    !(
      page.nextCursor === null ||
      (typeof page.nextCursor === "string" && page.nextCursor.length > 0)
    ) ||
    !(page.from === null || typeof page.from === "string") ||
    !(page.to === null || typeof page.to === "string") ||
    !page.items.every(
      (item) =>
        item &&
        item.householdId === householdId &&
        item.recipientId === recipientId &&
        typeof item.id === "string" &&
        (kind === "occurrences"
          ? "scheduledAtUtc" in item &&
            typeof item.scheduledAtUtc === "string" &&
            typeof item.status === "string" &&
            typeof item.routineTitle === "string"
          : "occurredAt" in item &&
            typeof item.occurredAt === "string" &&
            typeof item.title === "string"),
    )
  ) {
    throw new Error("记录响应无效，请刷新重试");
  }
  return page;
}

/** One mounted recipient/query session; every replacement invalidates pending append and failures. */
export class CareHistorySession {
  state: CareHistoryState = {
    filter: {},
    page: null,
    loading: false,
    appending: false,
    error: "",
    retry: "refresh",
  };
  private generation = 0;
  private listener: ((state: CareHistoryState) => void) | null = null;

  constructor(
    readonly kind: CareHistoryKind,
    readonly householdId: string,
    readonly recipientId: string,
    private readonly request: (path: string) => Promise<unknown>,
    private readonly onAccessDenied?: (message: string) => void,
  ) {}

  subscribe(listener: (state: CareHistoryState) => void) {
    this.listener = listener;
    listener(this.state);
    return () => {
      this.generation++;
      this.listener = null;
    };
  }

  private update(state: CareHistoryState) {
    this.state = state;
    this.listener?.(state);
  }

  denyAccess(message: string) {
    this.generation++;
    this.update({
      ...this.state,
      page: null,
      loading: false,
      appending: false,
      error: message,
      retry: "refresh",
    });
  }

  refresh(filter = this.state.filter) {
    return this.load({ ...filter }, false);
  }
  loadMore() {
    if (
      this.state.loading ||
      this.state.appending ||
      !this.state.page?.nextCursor
    )
      return Promise.resolve();
    return this.load(this.state.filter, true);
  }

  private async load(filter: CareHistoryFilter, append: boolean) {
    const generation = ++this.generation;
    const previous = append ? this.state.page : null;
    this.update({
      filter,
      page: previous,
      loading: !append,
      appending: append,
      error: "",
      retry: append ? "more" : "refresh",
    });
    const query = new URLSearchParams({ limit: "30", ...filter });
    if (previous?.nextCursor) query.set("cursor", previous.nextCursor);
    try {
      const raw = await this.request(
        `/households/${this.householdId}/care-recipients/${this.recipientId}/${this.kind}/history?${query}`,
      );
      if (generation !== this.generation) return;
      const page = parsePage(
        raw,
        this.householdId,
        this.recipientId,
        this.kind,
      );
      const ids = new Set(previous?.items.map((item) => item.id));
      this.update({
        filter,
        page: {
          ...page,
          items: [
            ...(previous?.items ?? []),
            ...page.items.filter((item) => !ids.has(item.id)),
          ],
        },
        loading: false,
        appending: false,
        error: "",
        retry: "refresh",
      });
    } catch (error) {
      if (generation !== this.generation) return;
      const denied =
        error instanceof ApiError && [401, 403, 404].includes(error.status);
      const invalidCursor = error instanceof ApiError && error.status === 400;
      this.update({
        filter,
        page: denied ? null : previous,
        loading: false,
        appending: false,
        error: readableError(error),
        retry: append && !denied && !invalidCursor ? "more" : "refresh",
      });
      if (denied) this.onAccessDenied?.(readableError(error));
    }
  }
}
