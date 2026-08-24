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
  useRef,
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
import {
  createWorkspaceOperationOwner,
  LatestScopedRequest,
} from "../../workspace/workspace-scope";
import {
  createScopedPageState,
  createScopedMutationOwner,
  isScopedMutationOwnerCurrent,
  pageValueForScope,
  type ScopedMutationOwner,
  type ScopedPageState,
} from "./family-page-state";
import { dateInTimeZone } from "./routine-date";

const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};
const showTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

type RoutinePageData = {
  routines: RoutineView[];
  tasks: FamilyTaskView[];
  occurrences: OccurrenceView[];
  events: CareEventView[];
};

const EMPTY_ROUTINE_PAGE_DATA: RoutinePageData = {
  routines: [],
  tasks: [],
  occurrences: [],
  events: [],
};

export const RoutinesApiPage = () => {
  const { user } = useAuth();
  const workspace = useWorkspace();
  const [pageState, setPageState] = useState<
    ScopedPageState<RoutinePageData>
  >(() => createScopedPageState("", EMPTY_ROUTINE_PAGE_DATA));
  const [loadingScopeKey, setLoadingScopeKey] = useState("");
  const [busyState, setBusyState] = useState<ScopedPageState<string>>(() =>
    createScopedPageState("", ""),
  );
  const [errorState, setErrorState] = useState<ScopedPageState<string>>(() =>
    createScopedPageState("", ""),
  );
  const [formOpen, setFormOpen] = useState(false);
  const [formOwner, setFormOwner] =
    useState<ScopedMutationOwner | null>(null);
  const [type, setType] = useState("OTHER");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [question, setQuestion] = useState("");
  const [time, setTime] = useState("08:30");
  const currentScopeKey = useRef(workspace.workspaceScopeKey);
  currentScopeKey.current = workspace.workspaceScopeKey;
  const scopeIdentity = {
    key: workspace.workspaceScopeKey,
    epoch: workspace.workspaceScopeEpoch,
  };
  const currentScopeIdentity = useRef(scopeIdentity);
  currentScopeIdentity.current = scopeIdentity;
  const loadRequests = useRef(new LatestScopedRequest());
  const pageData = pageValueForScope(
    pageState,
    workspace.workspaceScopeKey,
    EMPTY_ROUTINE_PAGE_DATA,
  );
  const { routines, tasks, occurrences, events } = pageData;
  const loading =
    loadingScopeKey === workspace.workspaceScopeKey ||
    (Boolean(workspace.householdId && workspace.recipientId) &&
      pageState.scopeKey !== workspace.workspaceScopeKey);
  const busyId = pageValueForScope(
    busyState,
    workspace.workspaceScopeKey,
    "",
  );
  const error = pageValueForScope(
    errorState,
    workspace.workspaceScopeKey,
    "",
  );
  const formIsCurrent = isScopedMutationOwnerCurrent(
    formOwner,
    scopeIdentity,
  );
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
      loadRequests.current.invalidate();
      setPageState(
        createScopedPageState(
          workspace.workspaceScopeKey,
          EMPTY_ROUTINE_PAGE_DATA,
        ),
      );
      setLoadingScopeKey("");
      return;
    }
    const owner = createWorkspaceOperationOwner(
      workspace.workspaceScopeKey,
      workspace.householdId,
      workspace.recipientId,
    );
    const request = loadRequests.current.begin(owner.scopeKey);
    setLoadingScopeKey(owner.scopeKey);
    setErrorState(createScopedPageState(owner.scopeKey, ""));
    try {
      const from = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
      const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
      const [nextRoutines, nextTasks, nextOccurrences, nextEvents] =
        await Promise.all([
          apiClient.request<RoutineView[]>(
            `/households/${owner.householdId}/care-recipients/${owner.recipientId}/routines`,
          ),
          apiClient.request<FamilyTaskView[]>(
            `/households/${owner.householdId}/family-tasks?recipientId=${owner.recipientId}`,
          ),
          apiClient.request<OccurrenceView[]>(
            `/households/${owner.householdId}/care-recipients/${owner.recipientId}/occurrences?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          ),
          apiClient.request<CareEventView[]>(
            `/households/${owner.householdId}/care-recipients/${owner.recipientId}/events`,
          ),
        ]);
      if (
        !loadRequests.current.isCurrent(request) ||
        currentScopeKey.current !== owner.scopeKey
      )
        return;
      setPageState(
        createScopedPageState(owner.scopeKey, {
          routines: nextRoutines,
          tasks: nextTasks,
          occurrences: nextOccurrences,
          events: nextEvents.slice(0, 30),
        }),
      );
    } catch (loadError) {
      if (
        loadRequests.current.isCurrent(request) &&
        currentScopeKey.current === owner.scopeKey
      ) {
        setErrorState(
          createScopedPageState(owner.scopeKey, readableError(loadError)),
        );
      }
    } finally {
      if (
        loadRequests.current.isCurrent(request) &&
        currentScopeKey.current === owner.scopeKey
      ) {
        setLoadingScopeKey("");
      }
    }
  }, [
    workspace.householdId,
    workspace.recipientId,
    workspace.workspaceScopeKey,
  ]);

  useEffect(() => {
    loadRequests.current.invalidate();
    setPageState(
      createScopedPageState(
        workspace.workspaceScopeKey,
        EMPTY_ROUTINE_PAGE_DATA,
      ),
    );
    setLoadingScopeKey("");
    setBusyState(createScopedPageState(workspace.workspaceScopeKey, ""));
    setErrorState(createScopedPageState(workspace.workspaceScopeKey, ""));
    setFormOpen(false);
    setFormOwner(null);
    setType("OTHER");
    setTitle("");
    setInstructions("");
    setQuestion("");
    setTime("08:30");
  }, [workspace.workspaceScopeKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!formIsCurrent) {
      setErrorState(
        createScopedPageState(
          workspace.workspaceScopeKey,
          "陪伴对象已切换，请重新打开日程表单后再保存。",
        ),
      );
      setFormOpen(false);
      setFormOwner(null);
      return;
    }
    const owner = formOwner;
    const recipientTimezone =
      workspace.recipient?.timezone || "Asia/Shanghai";
    setBusyState(createScopedPageState(owner.scopeKey, "create"));
    setErrorState(createScopedPageState(owner.scopeKey, ""));
    try {
      const created = await apiClient.request<RoutineView>(
        `/households/${owner.householdId}/care-recipients/${owner.recipientId}/routines`,
        {
          method: "POST",
          body: {
            type,
            title: title.trim(),
            instructions: instructions.trim(),
            confirmationQuestion: question.trim(),
            schedule: {
              timezone: recipientTimezone,
              localTimeMinutes: toMinutes(time),
              weekdayMask: 127,
              startDate: dateInTimeZone(new Date(), recipientTimezone),
              graceMinutes: 5,
              familyNoticeMinutes: 15,
            },
          },
        },
      );
      if (
        !isScopedMutationOwnerCurrent(
          owner,
          currentScopeIdentity.current,
        )
      )
        return;
      setPageState((current) => {
        if (
          !isScopedMutationOwnerCurrent(
            owner,
            currentScopeIdentity.current,
          )
        )
          return current;
        const currentValue =
          current.scopeKey === owner.scopeKey
            ? current.value
            : EMPTY_ROUTINE_PAGE_DATA;
        return createScopedPageState(owner.scopeKey, {
          ...currentValue,
          routines: [...currentValue.routines, created],
        });
      });
      setTitle("");
      setInstructions("");
      setQuestion("");
      setFormOpen(false);
      setFormOwner(null);
    } catch (createError) {
      if (
        isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current)
      ) {
        setErrorState(
          createScopedPageState(owner.scopeKey, readableError(createError)),
        );
      }
    } finally {
      if (
        isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current)
      ) {
        setBusyState((current) =>
          current.scopeKey === owner.scopeKey && current.value === "create"
            ? createScopedPageState(owner.scopeKey, "")
            : current,
        );
      }
    }
  };

  const taskAction = async (
    task: FamilyTaskView,
    action: "claim" | "resolve" | "dismiss",
  ) => {
    if (!workspace.householdId || !workspace.recipientId) return;
    const owner = createScopedMutationOwner(
      scopeIdentity,
      workspace.householdId,
      workspace.recipientId,
    );
    setBusyState(createScopedPageState(owner.scopeKey, task.id));
    setErrorState(createScopedPageState(owner.scopeKey, ""));
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
          owner.householdId,
          task.id,
          action,
          body,
        ]),
        (idempotencyKey) =>
          apiClient.request<FamilyTaskView>(
            `/households/${owner.householdId}/family-tasks/${task.id}/${action}`,
            {
              method: "POST",
              headers: { "Idempotency-Key": idempotencyKey },
              body,
            },
          ),
      );
      if (
        !isScopedMutationOwnerCurrent(
          owner,
          currentScopeIdentity.current,
        )
      )
        return;
      setPageState((current) =>
        !isScopedMutationOwnerCurrent(
          owner,
          currentScopeIdentity.current,
        ) || current.scopeKey !== owner.scopeKey
          ? current
          : createScopedPageState(owner.scopeKey, {
              ...current.value,
              tasks: current.value.tasks.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }),
      );
    } catch (actionError) {
      if (
        isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current)
      ) {
        setErrorState(
          createScopedPageState(owner.scopeKey, readableError(actionError)),
        );
      }
    } finally {
      if (
        isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current)
      ) {
        setBusyState((current) =>
          current.scopeKey === owner.scopeKey && current.value === task.id
            ? createScopedPageState(owner.scopeKey, "")
            : current,
        );
      }
    }
  };

  const verifyOccurrence = async (
    occurrence: OccurrenceView,
    verified: boolean,
  ) => {
    if (!workspace.householdId || !workspace.recipientId) return;
    if (
      !verified &&
      !window.confirm("确认记录为未完成吗？此操作会关闭本次日程实例。")
    )
      return;
    const owner = createScopedMutationOwner(
      scopeIdentity,
      workspace.householdId,
      workspace.recipientId,
    );
    setBusyState(createScopedPageState(owner.scopeKey, occurrence.id));
    setErrorState(createScopedPageState(owner.scopeKey, ""));
    try {
      const normalizedCommand = JSON.stringify([
        "family-verify",
        owner.householdId,
        occurrence.id,
        occurrence.version,
        verified,
        null,
      ]);
      const updated = await careCommands.execute(
        normalizedCommand,
        (idempotencyKey) =>
          apiClient.request<OccurrenceView>(
            `/households/${owner.householdId}/occurrences/${occurrence.id}/family-verify`,
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
      if (
        !isScopedMutationOwnerCurrent(
          owner,
          currentScopeIdentity.current,
        )
      )
        return;
      setPageState((current) =>
        !isScopedMutationOwnerCurrent(
          owner,
          currentScopeIdentity.current,
        ) || current.scopeKey !== owner.scopeKey
          ? current
          : createScopedPageState(owner.scopeKey, {
              ...current.value,
              occurrences: current.value.occurrences.map((item) =>
                item.id === updated.id ? updated : item,
              ),
            }),
      );
      await load();
    } catch (verifyError) {
      if (
        isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current)
      ) {
        setErrorState(
          createScopedPageState(owner.scopeKey, readableError(verifyError)),
        );
      }
    } finally {
      if (
        isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current)
      ) {
        setBusyState((current) =>
          current.scopeKey === owner.scopeKey &&
          current.value === occurrence.id
            ? createScopedPageState(owner.scopeKey, "")
            : current,
        );
      }
    }
  };

  const toggleForm = () => {
    if (formOpen && formIsCurrent) {
      setFormOpen(false);
      setFormOwner(null);
      return;
    }
    if (!workspace.householdId || !workspace.recipientId) return;
    setFormOwner(
      createScopedMutationOwner(
        scopeIdentity,
        workspace.householdId,
        workspace.recipientId,
      ),
    );
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setFormOwner(null);
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
        <p>请先创建并选择一位长者。</p>
      </section>
    );
  }

  return (
    <div className="resource-page">
      <section className="resource-toolbar">
        <div>
          <strong>日程与家庭待办</strong>
          <p>安排提醒并处理待办事项。</p>
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
            onClick={toggleForm}
            aria-expanded={formOpen && formIsCurrent}
          >
            <Plus aria-hidden="true" size={18} /> 新建日程
          </button>
        </div>
      </section>

      {formOpen && formIsCurrent && (
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
              onClick={closeForm}
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
              <p>新建日程后，提醒将按设定时间生成。</p>
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
                        ? "家属录入"
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
              <p>当前没有需要处理的事项。</p>
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
              <h2>提醒记录</h2>
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
              <p>暂无提醒记录。</p>
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
                    <small>家属填写的提醒内容</small>
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
              <p className="eyebrow">动态</p>
              <h2>最近动态</h2>
            </div>
            <span className="count-badge">{events.length}</span>
          </div>
          {loading ? (
            <div className="list-loading">正在加载事件…</div>
          ) : events.length === 0 ? (
            <div className="compact-empty">
              <ClipboardCheck aria-hidden="true" size={28} />
              <strong>暂无事件</strong>
              <p>暂无动态。</p>
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
