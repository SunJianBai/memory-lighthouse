import { CalendarClock, Plus, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ApiError, apiClient, readableError } from "../../api/api-client";
import { IdempotentCommandRegistry } from "../../api/idempotent-command";
import { useAuth } from "../../auth/auth-context";
import type {
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
import { CareHistoryPanel } from "../../components/CareHistoryPanel";

type RoutinePageData = {
  routines: RoutineView[];
  tasks: FamilyTaskBoardItem[];
  errors: Partial<Record<"routines" | "tasks", string>>;
};

const EMPTY_ROUTINE_PAGE_DATA: RoutinePageData = {
  routines: [],
  tasks: [],
  errors: {},
};
type HistoryAccessError = { sequence: number; message: string };

export const RoutinesApiPage = () => {
  const { user } = useAuth();
  const workspace = useWorkspace();
  const [pageState, setPageState] = useState<ScopedPageState<RoutinePageData>>(
    () => createScopedPageState("", EMPTY_ROUTINE_PAGE_DATA),
  );
  const [loadingScopeKey, setLoadingScopeKey] = useState("");
  const [historyRevision, setHistoryRevision] = useState(0);
  const [historyAccessState, setHistoryAccessState] = useState<
    ScopedPageState<HistoryAccessError | null>
  >(() => createScopedPageState("", null));
  const accessSequence = useRef(0);
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
  const { routines, tasks, errors: resourceErrors } = pageData;
  const loading =
    loadingScopeKey === workspace.workspaceScopeKey ||
    (Boolean(workspace.householdId && workspace.recipientId) &&
      pageState.scopeKey !== workspace.workspaceScopeKey);
  const busyId = pageValueForScope(busyState, workspace.workspaceScopeKey, "");
  const error = pageValueForScope(errorState, workspace.workspaceScopeKey, "");
  const historyAccessError = pageValueForScope(
    historyAccessState,
    workspace.workspaceScopeKey,
    null,
  );
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

  const denyHistoryAccess = useCallback(
    (owner: { key: string; epoch: number }, message: string) => {
      if (
        owner.key !== currentScopeIdentity.current.key ||
        owner.epoch !== currentScopeIdentity.current.epoch
      )
        return;
      // VIEW_EVENTS is independent of routine management: invalidate only protected reads.
      setHistoryAccessState(
        createScopedPageState(owner.key, {
          sequence: ++accessSequence.current,
          message,
        }),
      );
      setPageState((current) =>
        current.scopeKey !== owner.key
          ? current
          : createScopedPageState(owner.key, {
              ...current.value,
              tasks: [],
              errors: { ...current.value.errors, tasks: message },
            }),
      );
    },
    [],
  );

  const load = useCallback(
    async (refreshHistory = true) => {
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
      if (refreshHistory) {
        setHistoryAccessState(
          createScopedPageState(workspace.workspaceScopeKey, null),
        );
        setHistoryRevision((revision) => revision + 1);
      }
      const owner = createWorkspaceOperationOwner(
        workspace.workspaceScopeKey,
        workspace.householdId,
        workspace.recipientId,
      );
      const request = loadRequests.current.begin(owner.scopeKey);
      const ownerEpoch = workspace.workspaceScopeEpoch;
      const ownerAccessSequence = accessSequence.current;
      const requestIsCurrent = () =>
        loadRequests.current.isCurrent(request) &&
        currentScopeKey.current === owner.scopeKey &&
        currentScopeIdentity.current.epoch === ownerEpoch;
      setLoadingScopeKey(owner.scopeKey);
      setErrorState(createScopedPageState(owner.scopeKey, ""));
      try {
        const [nextRoutines, nextTasks] = await Promise.allSettled([
          apiClient.request<RoutineView[]>(
            `/households/${owner.householdId}/care-recipients/${owner.recipientId}/routines`,
          ),
          apiClient
            .request<unknown>(
              `/households/${owner.householdId}/care-recipients/${owner.recipientId}/family-task-board`,
            )
            .then((board) =>
              parseFamilyTaskBoard(board, owner.householdId, owner.recipientId),
            )
            .catch((failure: unknown) => {
              if (
                requestIsCurrent() &&
                ownerAccessSequence === accessSequence.current &&
                failure instanceof ApiError &&
                [401, 403, 404].includes(failure.status)
              )
                denyHistoryAccess(
                  { key: owner.scopeKey, epoch: ownerEpoch },
                  readableError(failure),
                );
              throw failure;
            }),
        ]);
        if (!requestIsCurrent()) return;
        const guardedTasks =
          ownerAccessSequence === accessSequence.current
            ? nextTasks
            : {
                status: "rejected" as const,
                reason: new Error("照护权限已变更，请刷新重试"),
              };
        const results = {
          routines: nextRoutines,
          tasks: guardedTasks,
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
            tasks:
              guardedTasks.status === "fulfilled" ? guardedTasks.value : [],
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
    },
    [
      workspace.householdId,
      workspace.recipientId,
      workspace.workspaceScopeKey,
      workspace.workspaceScopeEpoch,
      denyHistoryAccess,
    ],
  );

  useEffect(() => {
    loadRequests.current.invalidate();
    setPageState(
      createScopedPageState(
        workspace.workspaceScopeKey,
        EMPTY_ROUTINE_PAGE_DATA,
      ),
    );
    setLoadingScopeKey("");
    setHistoryAccessState(
      createScopedPageState(workspace.workspaceScopeKey, null),
    );
    setBusyState(createScopedPageState(workspace.workspaceScopeKey, ""));
    setErrorState(createScopedPageState(workspace.workspaceScopeKey, ""));
    setFormOpen(false);
    setFormOwner(null);
    setEditingRoutine(null);
  }, [workspace.workspaceScopeKey, workspace.workspaceScopeEpoch]);

  useEffect(() => {
    void load(false);
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
      await careCommands.execute(normalizedCommand, (idempotencyKey) =>
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

  if (!workspace.householdId || !workspace.recipientId) {
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
        {(["occurrences", "events"] as const).map((kind) => (
          <CareHistoryPanel
            key={`${user?.id}:${workspace.workspaceScopeKey}:${workspace.workspaceScopeEpoch}:${workspace.recipient?.timezone}:${kind}`}
            kind={kind}
            householdId={workspace.householdId!}
            recipientId={workspace.recipientId!}
            timezone={workspace.recipient?.timezone}
            revision={historyRevision}
            busyId={busyId}
            onVerify={(item, verified) => void verifyOccurrence(item, verified)}
            accessError={historyAccessError}
            onRetryAccess={() => void load()}
            onAccessDenied={(message) =>
              denyHistoryAccess(scopeIdentity, message)
            }
          />
        ))}
      </div>
    </div>
  );
};
