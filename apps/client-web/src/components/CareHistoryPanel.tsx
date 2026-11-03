import { CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "../api/api-client";
import {
  CareHistorySession,
  historyDateError,
  recentHistoryDates,
  type CareHistoryKind,
} from "../api/care-history";
import type { CareEventView, OccurrenceView } from "../api/types";
import {
  careEventSeverityLabel,
  careEventSourceLabel,
  careEventTypeLabel,
  careHistoryTimezoneLabel,
  formatCareHistoryTime,
  occurrenceStatusLabel,
  occurrenceClosureLabel,
} from "../pages/product/care-history-presentation";

function HistoryTime({
  value,
  timezone,
}: {
  value: string;
  timezone?: string;
}) {
  const formatted = formatCareHistoryTime(value, timezone);
  return <time dateTime={formatted.dateTime}>{formatted.text}</time>;
}

// Parent keys each panel by user/workspace epoch and profile timezone, so no previous scope paints.
export function CareHistoryPanel({
  kind,
  householdId,
  recipientId,
  timezone,
  revision,
  busyId,
  onVerify,
  accessError,
  onAccessDenied,
  onRetryAccess,
}: {
  kind: CareHistoryKind;
  householdId: string;
  recipientId: string;
  timezone?: string;
  revision: number;
  busyId: string;
  onVerify: (item: OccurrenceView, verified: boolean) => void;
  accessError?: { sequence: number; message: string } | null;
  onAccessDenied?: (message: string) => void;
  onRetryAccess?: () => void;
}) {
  const deniedCallback = useRef(onAccessDenied);
  deniedCallback.current = onAccessDenied;
  const session = useMemo(
    () =>
      new CareHistorySession(
        kind,
        householdId,
        recipientId,
        (path) => apiClient.request<unknown>(path),
        (message) => deniedCallback.current?.(message),
      ),
    [kind, householdId, recipientId],
  );
  const [state, setState] = useState(session.state);
  const [expanded, setExpanded] = useState(false);
  const [draft, setDraft] = useState(() => ({
    ...recentHistoryDates(timezone),
    status: "",
  }));
  const [formError, setFormError] = useState("");
  useEffect(() => session.subscribe(setState), [session]);
  useEffect(() => {
    void session.refresh();
  }, [session, revision]);
  useEffect(() => {
    if (accessError) session.denyAccess(accessError.message);
  }, [session, accessError]);
  const isOccurrence = kind === "occurrences";
  const title = isOccurrence ? "提醒记录" : "照护动态";
  const page = accessError ? null : state.page;
  const zone = page?.timezone ?? timezone;
  const items = page?.items ?? [];
  const error = accessError?.message ?? state.error;
  const filter = state.filter;
  return (
    <section className="panel-card care-history-panel" aria-label={title}>
      <div className="panel-heading">
        <div>
          <h2>{title}</h2>
          <p className="care-history-timezone">
            {careHistoryTimezoneLabel(zone)}
          </p>
        </div>
      </div>
      <p className="care-history-range">
        {filter.startDate
          ? `${filter.startDate} 至 ${filter.endDate}（含结束日）`
          : isOccurrence
            ? "近期提醒：前 24 小时至未来 7 天"
            : "最新记录"}
        {filter.status ? ` · ${occurrenceStatusLabel(filter.status)}` : ""}
      </p>
      <div className="care-history-actions">
        <button
          type="button"
          className="secondary-button"
          aria-expanded={expanded}
          aria-controls={`${kind}-history-filter`}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "收起查询" : "查询历史"}
        </button>
        {filter.startDate && (
          <button
            type="button"
            className="secondary-button"
            disabled={Boolean(accessError)}
            onClick={() => {
              setFormError("");
              setDraft({ ...recentHistoryDates(zone), status: "" });
              void session.refresh({});
            }}
          >
            {isOccurrence ? "恢复近期" : "恢复最新"}
          </button>
        )}
      </div>
      {expanded && (
        <form
          id={`${kind}-history-filter`}
          className="care-history-filter"
          aria-label={`${title}查询`}
          onSubmit={(event) => {
            event.preventDefault();
            const error = historyDateError(draft.startDate, draft.endDate);
            setFormError(error);
            if (!error && !accessError)
              void session.refresh({
                startDate: draft.startDate,
                endDate: draft.endDate,
                ...(isOccurrence && draft.status
                  ? { status: draft.status }
                  : {}),
              });
          }}
        >
          <div className="form-grid two-columns">
            <label>
              开始日期
              <input
                type="date"
                min="1900-01-01"
                max="9998-12-31"
                required
                value={draft.startDate}
                onChange={(event) =>
                  setDraft({ ...draft, startDate: event.target.value })
                }
              />
            </label>
            <label>
              结束日期
              <input
                type="date"
                min="1900-01-01"
                max="9998-12-31"
                required
                value={draft.endDate}
                onChange={(event) =>
                  setDraft({ ...draft, endDate: event.target.value })
                }
              />
            </label>
            {isOccurrence && (
              <label>
                状态
                <select
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({ ...draft, status: event.target.value })
                  }
                >
                  <option value="">全部状态</option>
                  {[
                    "DUE",
                    "AWAITING_CONFIRMATION",
                    "NEEDS_FAMILY_REVIEW",
                    "CONFIRMED",
                    "EXPIRED",
                  ].map((status) => (
                    <option key={status} value={status}>
                      {occurrenceStatusLabel(status)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <p>
            每次最多查询 31 天
            {isOccurrence ? "，按计划提醒时间查询" : "，按动态发生时间查询"}。
          </p>
          {formError && (
            <p className="inline-error" role="alert">
              {formError}
            </p>
          )}
          <button
            type="submit"
            className="primary-button"
            disabled={Boolean(accessError)}
          >
            查询
          </button>
        </form>
      )}
      {!accessError && state.loading && (
        <p className="list-loading" role="status">
          正在加载{title}…
        </p>
      )}
      {error && (
        <div className="care-history-error" role="alert">
          <p>{error}</p>
          <button
            type="button"
            className="secondary-button"
            onClick={() =>
              accessError
                ? onRetryAccess?.()
                : void (state.retry === "more"
                    ? session.loadMore()
                    : session.refresh())
            }
          >
            {!accessError && state.retry === "more"
              ? "重试加载更多"
              : "重新查询"}
          </button>
        </div>
      )}
      {!state.loading && page && (
        <>
          <p className="care-history-count" role="status">
            已加载 {items.length} 条
          </p>
          {items.length === 0 ? (
            <div className="compact-empty">
              <strong>
                {isOccurrence ? "所选范围内暂无提醒记录" : "所选范围内暂无动态"}
              </strong>
            </div>
          ) : (
            <div className="family-task-list care-history-list">
              {items.map((item) => {
                if (isOccurrence) {
                  const occurrence = item as OccurrenceView;
                  return (
                    <article key={item.id}>
                      <div>
                        <span
                          className={`status-pill ${occurrence.status === "CONFIRMED" ? "success" : occurrence.status === "NEEDS_FAMILY_REVIEW" ? "attention" : "neutral"}`}
                        >
                          {occurrenceStatusLabel(occurrence.status)}
                        </span>
                        <strong>{occurrence.routineTitle}</strong>
                        {occurrenceClosureLabel(occurrence.status, occurrence.closureReason) && (
                          <p>{occurrenceClosureLabel(occurrence.status, occurrence.closureReason)}</p>
                        )}
                        <p>
                          <HistoryTime
                            value={occurrence.scheduledAtUtc}
                            timezone={zone}
                          />
                        </p>
                        <p>{occurrence.instructions}</p>
                      </div>
                      {occurrence.status === "NEEDS_FAMILY_REVIEW" && (
                        <div className="task-actions">
                          <button
                            type="button"
                            disabled={Boolean(busyId)}
                            onClick={() => onVerify(occurrence, true)}
                          >
                            <CheckCircle2 aria-hidden="true" size={17} />{" "}
                            核验已完成
                          </button>
                          <button
                            type="button"
                            disabled={Boolean(busyId)}
                            onClick={() => onVerify(occurrence, false)}
                          >
                            核验未完成
                          </button>
                        </div>
                      )}
                    </article>
                  );
                }
                const event = item as CareEventView;
                return (
                  <article key={item.id}>
                    <div>
                      <span
                        className={`status-pill ${event.severity === "ATTENTION" ? "attention" : "neutral"}`}
                      >
                        {careEventSeverityLabel(event.severity)}
                      </span>
                      <strong>{event.title}</strong>
                      <p>
                        <HistoryTime value={event.occurredAt} timezone={zone} />
                      </p>
                      <p>{event.summary}</p>
                      <p>
                        {careEventSourceLabel(event.sourceType)} ·{" "}
                        {careEventTypeLabel(event.type)}
                      </p>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
          {!error &&
            (page.nextCursor ? (
              <button
                type="button"
                className="secondary-button care-history-more"
                disabled={state.appending}
                onClick={() => void session.loadMore()}
              >
                {state.appending ? "正在加载…" : "加载更多"}
              </button>
            ) : (
              <p className="care-history-count">本次查询已加载完</p>
            ))}
        </>
      )}
    </section>
  );
}
