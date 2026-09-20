import {
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Plus,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import {
  scheduleSummary,
  scheduleTime as showTime,
  type RoutineFormInput,
} from "./routine-schedule";
import { RoutineEditor } from "../../components/RoutineEditor";
import {
  parseFamilyTaskBoard,
  type FamilyTaskBoardItem,
} from "../../api/family-task-board";
import { FamilyTaskPanel } from "../../components/FamilyTaskPanel";
import {
  careEventSeverityLabel,
  careEventSourceLabel,
  careEventTypeLabel,
  careHistoryTimezoneLabel,
  formatCareHistoryTime,
  occurrenceStatusLabel,
} from "./care-history-presentation";

function CareHistoryTime({
  value,
  timezone,
}: {
  value: string;
  timezone: string | undefined;
}) {
  const formatted = formatCareHistoryTime(value, timezone);
  return <time dateTime={formatted.dateTime}>{formatted.text}</time>;
}

type RoutinePageData = {
  routines: RoutineView[];
  tasks: FamilyTaskBoardItem[];
  occurrences: OccurrenceView[];
  events: CareEventView[];
  errors: Partial<
    Record<"routines" | "tasks" | "occurrences" | "events", string>
  >;
};

const EMPTY_ROUTINE_PAGE_DATA: RoutinePageData = {
  routines: [],
  tasks: [],
  occurrences: [],
  events: [],
  errors: {},
};

export const RoutinesApiPage = () => {
  const { user } = useAuth();
  const workspace = useWorkspace();
  const [pageState, setPageState] = useState<ScopedPageState<RoutinePageData>>(
    () => createScopedPageState("", EMPTY_ROUTINE_PAGE_DATA),
  );
  const [loadingScopeKey, setLoadingScopeKey] = useState("");
  const [busyState, setBusyState] = useState<ScopedPageState<string>>(() =>
    createScopedPageState("", ""),
  );
  const [errorState, setErrorState] = useState<ScopedPageState<string>>(() =>
    createScopedPageState("", ""),
  );
  const [formOpen, setFormOpen] = useState(false);
  const [formOwner, setFormOwner] = useState<ScopedMutationOwner | null>(null);
  const [editingRoutine, setEditingRoutine] = useState<RoutineView | null>(
    null,
  );
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
  const {
    routines,
    tasks,
    occurrences,
    events,
    errors: resourceErrors,
  } = pageData;
  const loading =
    loadingScopeKey === workspace.workspaceScopeKey ||
    (Boolean(workspace.householdId && workspace.recipientId) &&
      pageState.scopeKey !== workspace.workspaceScopeKey);
  const busyId = pageValueForScope(busyState, workspace.workspaceScopeKey, "");
  const error = pageValueForScope(errorState, workspace.workspaceScopeKey, "");
  const formIsCurrent = isScopedMutationOwnerCurrent(formOwner, scopeIdentity);
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
    const ownerEpoch = workspace.workspaceScopeEpoch;
    const requestIsCurrent = () =>
      loadRequests.current.isCurrent(request) &&
      currentScopeKey.current === owner.scopeKey &&
      currentScopeIdentity.current.epoch === ownerEpoch;
    setLoadingScopeKey(owner.scopeKey);
    setErrorState(createScopedPageState(owner.scopeKey, ""));
    try {
      const from = new Date(Date.now() - 24 * 60 * 60 * 1_000).toISOString();
      const to = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString();
      const [nextRoutines, nextTasks, nextOccurrences, nextEvents] =
        await Promise.allSettled([
          apiClient.request<RoutineView[]>(
            `/households/${owner.householdId}/care-recipients/${owner.recipientId}/routines`,
          ),
          apiClient
            .request<unknown>(
              `/households/${owner.householdId}/care-recipients/${owner.recipientId}/family-task-board`,
            )
            .then((board) =>
              parseFamilyTaskBoard(board, owner.householdId, owner.recipientId),
            ),
          apiClient.request<OccurrenceView[]>(
            `/households/${owner.householdId}/care-recipients/${owner.recipientId}/occurrences?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
          ),
          apiClient.request<CareEventView[]>(
            `/households/${owner.householdId}/care-recipients/${owner.recipientId}/events`,
          ),
        ]);
      if (!requestIsCurrent()) return;
      const results = {
        routines: nextRoutines,
        tasks: nextTasks,
        occurrences: nextOccurrences,
        events: nextEvents,
      };
      const errors = Object.fromEntries(
        Object.entries(results).flatMap(([key, result]) =>
          result.status === "rejected"
            ? [[key, readableError(result.reason)]]
            : [],
        ),
      );
      const labels = {
        routines: "日程",
        tasks: "待办",
        occurrences: "提醒记录",
        events: "最近动态",
      };
      setErrorState(
        createScopedPageState(
          owner.scopeKey,
          Object.entries(errors)
            .map(
              ([key, message]) =>
                `${labels[key as keyof typeof labels]}：${message}`,
            )
            .join("；"),
        ),
      );
      setPageState(
        createScopedPageState(owner.scopeKey, {
          routines:
            nextRoutines.status === "fulfilled" ? nextRoutines.value : [],
          tasks: nextTasks.status === "fulfilled" ? nextTasks.value : [],
          occurrences:
            nextOccurrences.status === "fulfilled" ? nextOccurrences.value : [],
          events:
            nextEvents.status === "fulfilled"
              ? nextEvents.value.slice(0, 30)
              : [],
          errors,
        }),
      );
    } catch (loadError) {
      if (requestIsCurrent()) {
        setErrorState(
          createScopedPageState(owner.scopeKey, readableError(loadError)),
        );
        setPageState(
          createScopedPageState(owner.scopeKey, {
            ...EMPTY_ROUTINE_PAGE_DATA,
            errors: { tasks: readableError(loadError) },
          }),
        );
      }
    } finally {
      if (requestIsCurrent()) {
        setLoadingScopeKey("");
      }
    }
  }, [
    workspace.householdId,
    workspace.recipientId,
    workspace.workspaceScopeKey,
    workspace.workspaceScopeEpoch,
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
    setEditingRoutine(null);
  }, [workspace.workspaceScopeKey, workspace.workspaceScopeEpoch]);

  useEffect(() => {
    void load();
    return () => loadRequests.current.invalidate();
  }, [load]);

  const saveRoutine = async (input: RoutineFormInput) => {
    if (busyId) return;
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
    setBusyState(createScopedPageState(owner.scopeKey, "save-routine"));
    setErrorState(createScopedPageState(owner.scopeKey, ""));
    try {
      const created = editingRoutine
        ? await careCommands.execute(
            JSON.stringify([
              "routine-update",
              owner.householdId,
              editingRoutine.id,
              editingRoutine.version,
              input,
            ]),
            (idempotencyKey) =>
              apiClient.request<RoutineView>(
                `/households/${owner.householdId}/routines/${editingRoutine.id}`,
                {
                  method: "PATCH",
                  headers: { "Idempotency-Key": idempotencyKey },
                  body: { ...input, version: editingRoutine.version },
                },
              ),
          )
        : await apiClient.request<RoutineView>(
            `/households/${owner.householdId}/care-recipients/${owner.recipientId}/routines`,
            { method: "POST", body: input },
          );
      if (!isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current))
        return;
      setPageState((current) => {
        if (!isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current))
          return current;
        const currentValue =
          current.scopeKey === owner.scopeKey
            ? current.value
            : EMPTY_ROUTINE_PAGE_DATA;
        return createScopedPageState(owner.scopeKey, {
          ...currentValue,
          routines: editingRoutine
            ? currentValue.routines.map((item) =>
                item.id === created.id ? created : item,
              )
            : [...currentValue.routines, created],
        });
      });
      setFormOpen(false);
      setFormOwner(null);
      setEditingRoutine(null);
      await load();
    } catch (createError) {
      if (isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current)) {
        setErrorState(
          createScopedPageState(owner.scopeKey, readableError(createError)),
        );
      }
    } finally {
      if (isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current)) {
        setBusyState((current) =>
          current.scopeKey === owner.scopeKey &&
          current.value === "save-routine"
            ? createScopedPageState(owner.scopeKey, "")
            : current,
        );
      }
    }
  };

  const taskAction = async (
    task: FamilyTaskView,
    action: "claim" | "release" | "resolve" | "dismiss",
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
        action === "claim" || action === "release"
          ? { version: task.version }
          : {
              version: task.version,
              resolutionCode:
                action === "resolve" ? "FAMILY_CONFIRMED" : "NOT_ACTIONABLE",
            };
      await careCommands.execute(
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
      if (!isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current))
        return;
      await load();
    } catch (actionError) {
      if (isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current)) {
        await load();
        if (!isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current))
          return;
        setErrorState(
          createScopedPageState(
            owner.scopeKey,
            `${readableError(actionError)}。已尝试刷新待办，请核对最新状态。`,
          ),
        );
      }
    } finally {
      if (isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current)) {
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
      !window.confirm("确认记录为未完成吗？此操作会关闭本次提醒。")
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
      if (!isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current))
        return;
      setPageState((current) =>
        !isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current) ||
        current.scopeKey !== owner.scopeKey
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
      if (isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current)) {
        setErrorState(
          createScopedPageState(owner.scopeKey, readableError(verifyError)),
        );
      }
    } finally {
      if (isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current)) {
        setBusyState((current) =>
          current.scopeKey === owner.scopeKey && current.value === occurrence.id
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
    setEditingRoutine(null);
    setErrorState(createScopedPageState(workspace.workspaceScopeKey, ""));
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
    setEditingRoutine(null);
  };

  const editRoutine = (routine: RoutineView) => {
    if (busyId || !workspace.householdId || !workspace.recipientId) return;
    setFormOwner(
      createScopedMutationOwner(
        scopeIdentity,
        workspace.householdId,
        workspace.recipientId,
      ),
    );
    setEditingRoutine(routine);
    setErrorState(createScopedPageState(workspace.workspaceScopeKey, ""));
    setFormOpen(true);
  };

  if (!workspace.recipientId) {
    return (
      <section className="empty-resource-state">
        <CalendarClock aria-hidden="true" size={34} />
        <h2>未选择陪伴对象</h2>
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
            disabled={loading || Boolean(busyId)}
            onClick={() => void load()}
          >
            <RefreshCw aria-hidden="true" size={18} /> 刷新
          </button>
          <button
            className="primary-button"
            type="button"
            onClick={toggleForm}
            disabled={Boolean(busyId)}
            aria-expanded={formOpen && formIsCurrent}
          >
            <Plus aria-hidden="true" size={18} /> 新建日程
          </button>
        </div>
      </section>

      {formOpen && formIsCurrent && (
        <RoutineEditor
          key={`${workspace.workspaceScopeKey}:${workspace.workspaceScopeEpoch}:${editingRoutine?.id ?? "new"}`}
          routine={editingRoutine}
          timezone={workspace.recipient?.timezone ?? "Asia/Shanghai"}
          busy={Boolean(busyId)}
          error={error}
          onSave={(input) => void saveRoutine(input)}
          onCancel={closeForm}
        />
      )}

      {error && !(formOpen && formIsCurrent) && (
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
            <span className="count-badge">
              {resourceErrors.routines ? "—" : routines.length}
            </span>
          </div>
          {loading ? (
            <div className="list-loading">正在加载日程…</div>
          ) : resourceErrors.routines ? (
            <div className="compact-empty" role="status">
              日程未能加载，请核对权限或刷新重试。
            </div>
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
                    <p className="routine-rule-summary">
                      {scheduleSummary(routine.schedules[0])}
                    </p>
                    <small>
                      {routine.contentProvenance === "FAMILY_ENTERED_VERBATIM"
                        ? "家属录入"
                        : routine.contentProvenance}
                    </small>
                  </div>
                  <div className="routine-card-actions">
                    <span className="status-pill success">
                      {routine.status === "ACTIVE" ? "已启用" : "已停用"}
                    </span>
                    <button
                      type="button"
                      className="secondary-button"
                      disabled={Boolean(busyId)}
                      aria-label={`编辑日程：${routine.title}`}
                      onClick={() => editRoutine(routine)}
                    >
                      编辑
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>

        <FamilyTaskPanel
          key={`${workspace.workspaceScopeKey}:${workspace.workspaceScopeEpoch}`}
          tasks={tasks}
          loading={loading}
          error={resourceErrors.tasks ?? ""}
          busyId={busyId}
          timezone={workspace.recipient?.timezone ?? "Asia/Shanghai"}
          onAction={(task, action) => void taskAction(task, action)}
        />
      </div>

      <div className="routine-task-columns">
        <section className="panel-card">
          <div className="panel-heading">
            <div>
              <h2>提醒记录</h2>
              <p className="care-history-timezone">
                {careHistoryTimezoneLabel(workspace.recipient?.timezone)}
              </p>
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
            <div className="list-loading">正在加载提醒记录…</div>
          ) : resourceErrors.occurrences ? (
            <div className="compact-empty" role="status">
              提醒记录未能加载，请核对权限或刷新重试。
            </div>
          ) : occurrences.length === 0 ? (
            <div className="compact-empty">
              <CalendarClock aria-hidden="true" size={28} />
              <strong>暂无提醒记录</strong>
            </div>
          ) : (
            <div className="family-task-list care-history-list">
              {occurrences.map((occurrence) => (
                <article key={occurrence.id}>
                  <div>
                    <span
                      className={`status-pill ${occurrence.status === "CONFIRMED" ? "success" : occurrence.status === "NEEDS_FAMILY_REVIEW" ? "attention" : "neutral"}`}
                    >
                      {occurrenceStatusLabel(occurrence.status)}
                    </span>
                    <strong>{occurrence.routineTitle}</strong>
                    <p>
                      <CareHistoryTime
                        value={occurrence.scheduledAtUtc}
                        timezone={workspace.recipient?.timezone}
                      />
                    </p>
                    <p>{occurrence.instructions}</p>
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
              <h2>最近动态</h2>
              <p className="care-history-timezone">
                {careHistoryTimezoneLabel(workspace.recipient?.timezone)}
              </p>
            </div>
            <span className="count-badge">{events.length}</span>
          </div>
          {loading ? (
            <div className="list-loading">正在加载动态…</div>
          ) : resourceErrors.events ? (
            <div className="compact-empty" role="status">
              最近动态未能加载，请核对权限或刷新重试。
            </div>
          ) : events.length === 0 ? (
            <div className="compact-empty">
              <ClipboardCheck aria-hidden="true" size={28} />
              <strong>暂无动态</strong>
            </div>
          ) : (
            <div className="family-task-list care-history-list">
              {events.map((event) => (
                <article key={event.id}>
                  <div>
                    <span
                      className={`status-pill ${event.severity === "ATTENTION" ? "attention" : "neutral"}`}
                    >
                      {careEventSeverityLabel(event.severity)}
                    </span>
                    <strong>{event.title}</strong>
                    <p>
                      <CareHistoryTime
                        value={event.occurredAt}
                        timezone={workspace.recipient?.timezone}
                      />
                    </p>
                    <p>{event.summary}</p>
                    <p>
                      {careEventSourceLabel(event.sourceType)} ·{" "}
                      {careEventTypeLabel(event.type)}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};
