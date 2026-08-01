import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Plus,
  RefreshCw,
  UserRoundCheck,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import { apiClient, readableError } from "../../api/api-client";
import { IdempotentCommandRegistry } from "../../api/idempotent-command";
import { useAuth } from "../../auth/auth-context";
import type {
  CareEventView,
  FamilyTaskView,
  OccurrenceView,
  RoutineView,
} from "../../api/types";
import { useWorkspace } from "../../workspace/workspace-context";

const today = () => new Date().toISOString().slice(0, 10);
const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};
const showTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const RoutinesApiPage = () => {
  const { user } = useAuth();
  const workspace = useWorkspace();
  const [routines, setRoutines] = useState<RoutineView[]>([]);
  const [tasks, setTasks] = useState<FamilyTaskView[]>([]);
  const [occurrences, setOccurrences] = useState<OccurrenceView[]>([]);
  const [events, setEvents] = useState<CareEventView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [type, setType] = useState("OTHER");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [question, setQuestion] = useState("");
  const [time, setTime] = useState("08:30");
  const careCommands = useMemo(
    () =>
      new IdempotentCommandRegistry(undefined, {
        persist: true,
        namespace: user?.id ?? "anonymous",
        scope: "family-care",
      }),
    [user?.id],
  );

  const load = useCallback(async () => {
    if (!workspace.householdId || !workspace.recipientId) {
      setRoutines([]);
      setTasks([]);
      setOccurrences([]);
      setEvents([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const from = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
      const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
      const [nextRoutines, nextTasks, nextOccurrences, nextEvents] =
        await Promise.all([
          apiClient.request<RoutineView[]>(
            `/households/${workspace.householdId}/care-recipients/${workspace.recipientId}/routines`,
          ),
          apiClient.request<FamilyTaskView[]>(
            `/households/${workspace.householdId}/family-tasks?recipientId=${workspace.recipientId}`,
          ),
          apiClient.request<OccurrenceView[]>(
            `/households/${workspace.householdId}/care-recipients/${workspace.recipientId}/occurrences?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          ),
          apiClient.request<CareEventView[]>(
            `/households/${workspace.householdId}/care-recipients/${workspace.recipientId}/events`,
          ),
        ]);
      setRoutines(nextRoutines);
      setTasks(nextTasks);
      setOccurrences(nextOccurrences);
      setEvents(nextEvents.slice(0, 30));
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoading(false);
    }
  }, [workspace.householdId, workspace.recipientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspace.householdId || !workspace.recipientId) return;
    setBusyId("create");
    setError("");
    try {
      const created = await apiClient.request<RoutineView>(
        `/households/${workspace.householdId}/care-recipients/${workspace.recipientId}/routines`,
        {
          method: "POST",
          body: {
            type,
            title: title.trim(),
            instructions: instructions.trim(),
            confirmationQuestion: question.trim(),
            schedule: {
              timezone: workspace.recipient?.timezone || "Asia/Shanghai",
              localTimeMinutes: toMinutes(time),
              weekdayMask: 127,
              startDate: today(),
              graceMinutes: 5,
              familyNoticeMinutes: 15,
            },
          },
        },
      );
      setRoutines((current) => [...current, created]);
      setTitle("");
      setInstructions("");
      setQuestion("");
      setFormOpen(false);
    } catch (createError) {
      setError(readableError(createError));
    } finally {
      setBusyId("");
    }
  };

  const taskAction = async (
    task: FamilyTaskView,
    action: "claim" | "resolve" | "dismiss",
  ) => {
    if (!workspace.householdId) return;
    setBusyId(task.id);
    setError("");
    try {
      const body =
        action === "claim"
          ? { version: task.version }
          : {
              version: task.version,
              resolutionCode:
                action === "resolve" ? "FAMILY_CONFIRMED" : "NOT_ACTIONABLE",
            };
      const updated = await careCommands.execute(
        JSON.stringify([
          "family-task",
          workspace.householdId,
          task.id,
          action,
          body,
        ]),
        (idempotencyKey) =>
          apiClient.request<FamilyTaskView>(
            `/households/${workspace.householdId}/family-tasks/${task.id}/${action}`,
            {
              method: "POST",
              headers: { "Idempotency-Key": idempotencyKey },
              body,
            },
          ),
      );
      setTasks((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
    } catch (actionError) {
      setError(readableError(actionError));
    } finally {
      setBusyId("");
    }
  };

  const verifyOccurrence = async (
    occurrence: OccurrenceView,
    verified: boolean,
  ) => {
    if (!workspace.householdId) return;
    if (
      !verified &&
      !window.confirm("确认记录为未完成吗？此操作会关闭本次日程实例。")
    )
      return;
    setBusyId(occurrence.id);
    setError("");
    try {
      const normalizedCommand = JSON.stringify([
        "family-verify",
        workspace.householdId,
        occurrence.id,
        occurrence.version,
        verified,
        null,
      ]);
      const updated = await careCommands.execute(
        normalizedCommand,
        (idempotencyKey) =>
          apiClient.request<OccurrenceView>(
            `/households/${workspace.householdId}/occurrences/${occurrence.id}/family-verify`,
            {
              method: "POST",
              headers: { "Idempotency-Key": idempotencyKey },
              body: {
                version: occurrence.version,
                idempotencyKey,
                verified,
              },
            },
          ),
      );
      setOccurrences((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      await load();
    } catch (verifyError) {
      setError(readableError(verifyError));
    } finally {
      setBusyId("");
    }
  };

  const openTasks = useMemo(
    () =>
      tasks.filter((task) => !["RESOLVED", "DISMISSED"].includes(task.status)),
    [tasks],
  );

  if (!workspace.recipientId) {
    return (
      <section className="empty-resource-state">
        <CalendarClock aria-hidden="true" size={34} />
        <h2>尚未选择陪伴对象</h2>
        <p>日程和待办都严格归属于一位陪伴对象。</p>
      </section>
    );
  }

  return (
    <div className="resource-page">
      <section className="resource-toolbar">
        <div>
          <strong>确定性日程与家庭待办</strong>
          <p>提醒内容由家属原样录入，完成状态只能走明确命令接口。</p>
        </div>
        <div>
          <button
            className="secondary-button"
            type="button"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw aria-hidden="true" size={18} /> 刷新
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={() => setFormOpen((current) => !current)}
            aria-expanded={formOpen}
          >
            <Plus aria-hidden="true" size={18} /> 新建日程
          </button>
        </div>
      </section>

      {formOpen && (
        <form
          className="panel-card resource-form"
          onSubmit={(event) => void create(event)}
        >
          <div className="panel-heading">
            <div>
              <p className="eyebrow">每天重复</p>
              <h2>新建日程</h2>
            </div>
          </div>
          <div className="form-grid two-columns">
            <label>
              日程类型
              <span className="select-wrap">
                <select
                  value={type}
                  onChange={(event) => setType(event.target.value)}
                >
                  <option value="OTHER">日常事项</option>
                  <option value="MEDICATION">用药提醒</option>
                  <option value="MEAL">用餐提醒</option>
                  <option value="HYDRATION">饮水提醒</option>
                  <option value="ACTIVITY">活动安排</option>
                  <option value="APPOINTMENT">预约事项</option>
                </select>
                <ChevronDown aria-hidden="true" size={17} />
              </span>
            </label>
            <label>
              提醒时间
              <input
                type="time"
                required
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
            </label>
          </div>
          <label>
            标题
            <input
              required
              maxLength={200}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
          <label>
            家属录入的提醒内容
            <textarea
              required
              rows={3}
              maxLength={4_000}
              value={instructions}
              onChange={(event) => setInstructions(event.target.value)}
            />
          </label>
          <label>
            确认问题
            <input
              required
              maxLength={1_000}
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="例如：您已经按家属安排完成了吗？"
            />
          </label>
          <div className="form-actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => setFormOpen(false)}
            >
              取消
            </button>
            <button
              className="primary-button"
              type="submit"
              disabled={busyId === "create"}
            >
              {busyId === "create" ? "正在保存…" : "保存日程"}
            </button>
          </div>
        </form>
      )}

      {error && (
        <div className="inline-alert danger" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}

      <div className="routine-task-columns">
        <section className="panel-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">日程</p>
              <h2>已启用规则</h2>
            </div>
            <span className="count-badge">{routines.length}</span>
          </div>
          {loading ? (
            <div className="list-loading">正在加载日程…</div>
          ) : routines.length === 0 ? (
            <div className="compact-empty">
              <CalendarClock aria-hidden="true" size={28} />
              <strong>暂无日程</strong>
              <p>新建后，服务器会按时区物化待执行事项。</p>
            </div>
          ) : (
            <div className="api-routine-list">
              {routines.map((routine) => (
                <article key={routine.id}>
                  <time>
                    {showTime(routine.schedules[0]?.localTimeMinutes ?? 0)}
                  </time>
                  <div>
                    <strong>{routine.title}</strong>
                    <p>{routine.instructions}</p>
                    <small>
                      {routine.contentProvenance === "FAMILY_ENTERED_VERBATIM"
                        ? "家属原文"
                        : routine.contentProvenance}
                    </small>
                  </div>
                  <span className="status-pill success">{routine.status}</span>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">待办</p>
              <h2>需要家属处理</h2>
            </div>
            <span className="count-badge attention">{openTasks.length}</span>
          </div>
          {loading ? (
            <div className="list-loading">正在加载待办…</div>
          ) : openTasks.length === 0 ? (
            <div className="compact-empty">
              <CheckCircle2 aria-hidden="true" size={28} />
              <strong>暂无待办</strong>
              <p>这不等于系统作出安全判断，只表示没有待人工处理事项。</p>
            </div>
          ) : (
            <div className="family-task-list">
              {openTasks.map((task) => (
                <article key={task.id}>
                  <div>
                    <span className="status-pill neutral">{task.priority}</span>
                    <strong>家庭协同事项</strong>
                    <p>来源事件：{task.sourceEventId}</p>
                  </div>
                  <div className="task-actions">
                    {task.status !== "CLAIMED" && (
                      <button
                        type="button"
                        disabled={busyId === task.id}
                        onClick={() => void taskAction(task, "claim")}
                      >
                        <UserRoundCheck aria-hidden="true" size={17} /> 领取
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={busyId === task.id}
                      onClick={() => void taskAction(task, "resolve")}
                    >
                      <ClipboardCheck aria-hidden="true" size={17} /> 已处理
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="routine-task-columns">
        <section className="panel-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">日程实例</p>
              <h2>提醒与确认闭环</h2>
            </div>
            <span className="count-badge attention">
              {
                occurrences.filter(
                  (item) => !["CONFIRMED", "EXPIRED"].includes(item.status),
                ).length
              }
            </span>
          </div>
          {loading ? (
            <div className="list-loading">正在加载日程实例…</div>
          ) : occurrences.length === 0 ? (
            <div className="compact-empty">
              <CalendarClock aria-hidden="true" size={28} />
              <strong>暂无近期实例</strong>
              <p>服务端物化规则后，这里会显示提醒、本人确认和家属核验状态。</p>
            </div>
          ) : (
            <div className="family-task-list">
              {occurrences.map((occurrence) => (
                <article key={occurrence.id}>
                  <div>
                    <span
                      className={`status-pill ${occurrence.status === "CONFIRMED" ? "success" : occurrence.status === "NEEDS_FAMILY_REVIEW" ? "attention" : "neutral"}`}
                    >
                      {occurrence.status}
                    </span>
                    <strong>{occurrence.routineTitle}</strong>
                    <p>
                      {new Date(occurrence.scheduledAtUtc).toLocaleString(
                        "zh-CN",
                      )}{" "}
                      · {occurrence.instructions}
                    </p>
                    <small>内容来源：家属原文；系统不据此作医疗判断。</small>
                  </div>
                  {occurrence.status === "NEEDS_FAMILY_REVIEW" && (
                    <div className="task-actions">
                      <button
                        type="button"
                        disabled={busyId === occurrence.id}
                        onClick={() => void verifyOccurrence(occurrence, true)}
                      >
                        <CheckCircle2 aria-hidden="true" size={17} /> 核验已完成
                      </button>
                      <button
                        type="button"
                        disabled={busyId === occurrence.id}
                        onClick={() => void verifyOccurrence(occurrence, false)}
                      >
                        核验未完成
                      </button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="panel-card">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">审计时间线</p>
              <h2>近期照护事件</h2>
            </div>
            <span className="count-badge">{events.length}</span>
          </div>
          {loading ? (
            <div className="list-loading">正在加载事件…</div>
          ) : events.length === 0 ? (
            <div className="compact-empty">
              <ClipboardCheck aria-hidden="true" size={28} />
              <strong>暂无事件</strong>
              <p>提醒状态变化、本人确认和家属核验会形成可追溯事件。</p>
            </div>
          ) : (
            <div className="api-routine-list">
              {events.map((event) => (
                <article key={event.id}>
                  <time>
                    {new Date(event.occurredAt).toLocaleString("zh-CN", {
                      month: "2-digit",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </time>
                  <div>
                    <strong>{event.title}</strong>
                    <p>{event.summary}</p>
                    <small>
                      {event.sourceType} · {event.type}
                    </small>
                  </div>
                  <span
                    className={`status-pill ${event.severity === "ATTENTION" ? "attention" : "neutral"}`}
                  >
                    {event.severity}
                  </span>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
