import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarCheck, RefreshCw, ArrowRight } from "lucide-react";
import { apiClient, readableError } from "../api/api-client";
import { navigate } from "../app/navigation";
import {
  parseTodayCare,
  todayCareStatus,
  type TodayCare,
} from "../api/today-care";

/** Mounted with the workspace epoch as key so returning to a recipient is a fresh load. */
export const TodayCareCard = ({
  householdId,
  recipientId,
}: {
  householdId: string;
  recipientId: string;
}) => {
  const [data, setData] = useState<TodayCare | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const response = await apiClient.request<unknown>(
        `/households/${householdId}/care-recipients/${recipientId}/today-care`,
      );
      if (generation.current !== request) return;
      const next = parseTodayCare(response, householdId, recipientId);
      setData(next);
    } catch (cause) {
      if (generation.current !== request) return;
      setData(null);
      setError(readableError(cause));
    } finally {
      if (generation.current === request) setLoading(false);
    }
  }, [householdId, recipientId]);

  useEffect(() => {
    void load();
    const refresh = () => {
      if (document.visibilityState === "visible") void load();
    };
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      generation.current++;
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
    };
  }, [load]);
  const time = (value: string) =>
    new Intl.DateTimeFormat("zh-CN", {
      timeZone: data?.timezone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(new Date(value));

  return (
    <section
      className="panel-card today-care-card"
      aria-labelledby="today-care-title"
      aria-busy={loading}
    >
      <div className="panel-heading">
        <div>
          <h2 id="today-care-title">
            <CalendarCheck aria-hidden="true" size={22} />
            今日照护
          </h2>
          {data && (
            <p className="today-care-meta">
              {data.localDate} · {data.timezone} · 更新于{" "}
              {time(data.generatedAt)}
            </p>
          )}
        </div>
        <button
          className="secondary-button"
          type="button"
          disabled={loading}
          onClick={() => void load()}
        >
          <RefreshCw aria-hidden="true" size={17} />
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>
      {error && (
        <p className="form-message error" role="alert">
          {error}
        </p>
      )}
      {loading && !data && <p role="status">正在加载今日照护…</p>}
      {data && (
        <>
          <dl className="today-care-counts">
            <div>
              <dt>今日提醒</dt>
              <dd>{data.counts.total}</dd>
            </div>
            <div>
              <dt>已确认</dt>
              <dd>{data.counts.confirmed}</dd>
            </div>
            <div>
              <dt>待核验</dt>
              <dd>{data.counts.needsReview}</dd>
            </div>
            <div>
              <dt>未处理待办</dt>
              <dd>{data.openTaskCount}</dd>
            </div>
          </dl>
          {data.counts.total === 0 ? (
            <p className="today-care-empty">
              今日暂无提醒记录，可在“日程与待办”中添加日程。
            </p>
          ) : data.items.length === 0 ? (
            <p className="today-care-empty">今日没有待确认或待核验的提醒。</p>
          ) : (
            <ul className="today-care-list">
              {data.items.map((item) => (
                <li key={item.id}>
                  <time dateTime={item.scheduledAt}>
                    {time(item.scheduledAt)}
                  </time>
                  <strong>{item.title}</strong>
                  <span
                    className={`status-pill ${item.status === "NEEDS_FAMILY_REVIEW" ? "attention" : "neutral"}`}
                  >
                    {todayCareStatus(item, data.generatedAt)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <footer className="today-care-footer">
            <small>
              待处理 {data.counts.pending + data.counts.needsReview} 项 ·
              已结束未确认 {data.counts.expired} 项
            </small>
            <button
              className="secondary-button"
              type="button"
              onClick={() => navigate("workspace-routines")}
            >
              查看日程与待办
              <ArrowRight aria-hidden="true" size={17} />
            </button>
          </footer>
        </>
      )}
    </section>
  );
};
