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
import { RoutineLifecycleDialog } from "./RoutinesApiPage.dialog";

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
  // A new account, binding or epoch must not paint the previous page for one frame.
  return (
    <RoutinePageBody
      key={`${user?.id}:${workspace.workspaceScopeKey}:${workspace.workspaceScopeEpoch}`}
    />
  );
};

const RoutinePageBody = () => {
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
  const [lifecycle, setLifecycle] = useState<{
    owner: ScopedMutationOwner;
    routine: RoutineView;
    action: "pause" | "resume";
    error: string;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [needsRoutineRefresh, setNeedsRoutineRefresh] = useState(false);
  const mutationPending = useRef(false);
  const lifecycleFocusRoutineId = useRef<string | null>(null);
  const lifecycleFocusTarget = useRef<HTMLButtonElement | null>(null);
  const refreshButton = useRef<HTMLButtonElement | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
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
  useEffect(() => {
    if (!lifecycle && !busyId && !loading && lifecycleFocusRoutineId.current) {
      const target = lifecycleFocusTarget.current;
      if (target?.isConnected && !target.disabled) target.focus();
      else refreshButton.current?.focus();
      lifecycleFocusRoutineId.current = null;
    }
  }, [lifecycle, busyId, loading]);
  const error = pageValueForScope(errorState, workspace.workspaceScopeKey, "");
  const historyAccessError = pageValueForScope(
    historyAccessState,
    workspace.workspaceScopeKey,
    null,
  );
  const formIsCurrent = isScopedMutationOwnerCurrent(formOwner, scopeIdentity);
  const ownerIsCurrent = (owner: ScopedMutationOwner) =>
    mounted.current &&
    isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current);
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
        !mounted.current ||
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
      if (!mounted.current) return false;
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
        mounted.current &&
        loadRequests.current.isCurrent(request) &&
        currentScopeKey.current === owner.scopeKey &&
        currentScopeIdentity.current.epoch === ownerEpoch;
      setLoadingScopeKey(owner.scopeKey);
      setErrorState(createScopedPageState(owner.scopeKey, ""));
      try {
        const [nextRoutines, nextTasks] = await Promise.allSettled([
          apiClient
            .request<RoutineView[]>(
              `/households/${owner.householdId}/care-recipients/${owner.recipientId}/routines?includePaused=true`,
            )
            .catch((failure: unknown) => {
              if (
                requestIsCurrent() &&
                failure instanceof ApiError &&
                [401, 403, 404].includes(failure.status)
              ) {
                setLifecycle(null);
                setFormOpen(false);
                setFormOwner(null);
                setEditingRoutine(null);
                setPageState((current) =>
                  createScopedPageState(owner.scopeKey, {
                    ...current.value,
                    routines: [],
                    errors: {
                      ...current.value.errors,
                      routines: readableError(failure),
                    },
                  }),
                );
                setErrorState(
                  createScopedPageState(owner.scopeKey, readableError(failure)),
                );
                if (failure.status === 401)
                  denyHistoryAccess(
                    { key: owner.scopeKey, epoch: ownerEpoch },
                    readableError(failure),
                  );
              }
              throw failure;
            }),
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
        const routineAccessDenied =
          nextRoutines.status === "rejected" &&
          nextRoutines.reason instanceof ApiError &&
          [401, 403, 404].includes(nextRoutines.reason.status);
        if (routineAccessDenied) {
          setLifecycle(null);
          setFormOpen(false);
          setFormOwner(null);
          setEditingRoutine(null);
        }
        if (nextRoutines.status === "fulfilled") setNeedsRoutineRefresh(false);
        setPageState((current) =>
          createScopedPageState(owner.scopeKey, {
            routines:
              nextRoutines.status === "fulfilled"
                ? nextRoutines.value
                : routineAccessDenied
                  ? []
                  : current.scopeKey === owner.scopeKey
                    ? current.value.routines
                    : [],
            tasks:
              guardedTasks.status === "fulfilled" ? guardedTasks.value : [],
            errors,
          }),
        );
        return nextRoutines.status === "fulfilled";
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
        return false;
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
    if (busyId || loading || mutationPending.current || needsRoutineRefresh)
      return;
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
    mutationPending.current = true;
    setBusyState(createScopedPageState(owner.scopeKey, "save-routine"));
    setErrorState(createScopedPageState(owner.scopeKey, ""));
    setNotice("");
    let accepted = false;
    try {
      try {
        await (editingRoutine
          ? await careCommands.execute(
              JSON.stringify([
                "routine-update",
                owner.householdId,
                editingRoutine.id,
                editingRoutine.version,
                input,
              ]),
              async (idempotencyKey) => {
                if (!ownerIsCurrent(owner)) throw new Error("工作区已切换");
                const receipt = await apiClient.request<RoutineView>(
                  `/households/${owner.householdId}/routines/${editingRoutine.id}`,
                  {
                    method: "PATCH",
                    headers: { "Idempotency-Key": idempotencyKey },
                    body: { ...input, version: editingRoutine.version },
                  },
                );
                accepted = true;
                return receipt;
              },
            )
          : await apiClient.request<RoutineView>(
              `/households/${owner.householdId}/care-recipients/${owner.recipientId}/routines`,
              { method: "POST", body: input },
            ));
      } catch (failure) {
        if (!accepted) throw failure;
      }
      if (!ownerIsCurrent(owner)) return;
      setFormOpen(false);
      setFormOwner(null);
      setEditingRoutine(null);
      const refreshed = await load();
      if (ownerIsCurrent(owner)) {
        setNeedsRoutineRefresh(!refreshed);
        setNotice(
          refreshed
            ? "日程已保存。"
            : "操作已受理，状态暂未刷新，请刷新后再操作。",
        );
      }
    } catch (createError) {
      if (ownerIsCurrent(owner)) {
        if (isRoutineAccessError(createError))
          clearRoutineAccess(owner, createError);
        else if (
          createError instanceof ApiError &&
          createError.status === 409
        ) {
          closeForm();
          const refreshed = await load(false);
          if (ownerIsCurrent(owner)) setNeedsRoutineRefresh(!refreshed);
        }
        if (!ownerIsCurrent(owner)) return;
        setErrorState(
          createScopedPageState(
            owner.scopeKey,
            createError instanceof ApiError && createError.status === 409
              ? "日程已被其他家属更新，请刷新后重试"
              : readableError(createError),
          ),
        );
      }
    } finally {
      mutationPending.current = false;
      if (ownerIsCurrent(owner)) {
        setBusyState((current) =>
          current.scopeKey === owner.scopeKey &&
          current.value === "save-routine"
            ? createScopedPageState(owner.scopeKey, "")
            : current,
        );
      }
    }
  };

  function isRoutineAccessError(error: unknown): error is ApiError {
    return error instanceof ApiError && [401, 403, 404].includes(error.status);
  }

  function clearRoutineAccess(owner: ScopedMutationOwner, failure: ApiError) {
    if (!ownerIsCurrent(owner)) return;
    loadRequests.current.invalidate();
    setLoadingScopeKey("");
    setLifecycle(null);
    closeForm();
    setPageState((current) =>
      createScopedPageState(owner.scopeKey, {
        ...current.value,
        routines: [],
        errors: { ...current.value.errors, routines: readableError(failure) },
      }),
    );
    if (failure.status === 401)
      denyHistoryAccess(
        { key: owner.scopeKey, epoch: owner.scopeEpoch },
        readableError(failure),
      );
    setErrorState(
      createScopedPageState(owner.scopeKey, readableError(failure)),
    );
  }

  const startLifecycle = (routine: RoutineView) => {
    if (
      busyId ||
      loading ||
      mutationPending.current ||
      needsRoutineRefresh ||
      !workspace.householdId ||
      !workspace.recipientId ||
      !["ACTIVE", "PAUSED"].includes(routine.status)
    )
      return;
    closeForm();
    setNotice("");
    setErrorState(createScopedPageState(workspace.workspaceScopeKey, ""));
    setLifecycle({
      owner: createScopedMutationOwner(
        scopeIdentity,
        workspace.householdId,
        workspace.recipientId,
      ),
      routine,
      action: routine.status === "ACTIVE" ? "pause" : "resume",
      error: "",
    });
  };

  const submitLifecycle = async () => {
    if (
      !lifecycle ||
      busyId ||
      mutationPending.current ||
      !ownerIsCurrent(lifecycle.owner)
    )
      return;
    const { owner, routine, action } = lifecycle;
    mutationPending.current = true;
    setBusyState(createScopedPageState(owner.scopeKey, routine.id));
    setLifecycle({ ...lifecycle, error: "" });
    let accepted = false;
    try {
      try {
        await careCommands.execute(
          JSON.stringify([
            "routine-lifecycle",
            user?.id,
            owner.householdId,
            owner.recipientId,
            routine.id,
            action,
            routine.version,
          ]),
          async (idempotencyKey) => {
            // The registry may await storage or retry a lost response: recheck the owner each time.
            if (!ownerIsCurrent(owner)) throw new Error("工作区已切换");
            const receipt = await apiClient.request<RoutineView>(
              `/households/${owner.householdId}/routines/${routine.id}/${action}`,
              {
                method: "POST",
                headers: { "Idempotency-Key": idempotencyKey },
                body: { version: routine.version },
              },
            );
            accepted = true;
            return receipt;
          },
        );
      } catch (failure) {
        // Receipt cleanup can fail after a successful server response; do not describe that as a failed mutation.
        if (!accepted) throw failure;
      }
      if (!ownerIsCurrent(owner)) return;
      setLifecycle(null);
      setNotice("操作已受理，正在刷新状态…");
      // A replay receipt describes the original command, not necessarily the current version.
      const refreshed = await load();
      if (!ownerIsCurrent(owner)) return;
      setNeedsRoutineRefresh(!refreshed);
      setNotice(
        refreshed
          ? action === "pause"
            ? "暂停操作已受理，已刷新当前日程。"
            : "恢复操作已受理，已刷新当前日程。"
          : "操作已受理，状态暂未刷新，请刷新后再操作。",
      );
    } catch (failure) {
      if (!ownerIsCurrent(owner)) return;
      if (isRoutineAccessError(failure)) clearRoutineAccess(owner, failure);
      else if (
        failure instanceof ApiError &&
        failure.code === "ROUTINE_NO_FUTURE_OCCURRENCE"
      ) {
        setLifecycle({ ...lifecycle, error: readableError(failure) });
      } else if (failure instanceof ApiError && failure.status === 409) {
        setLifecycle(null);
        const refreshed = await load(false);
        if (!ownerIsCurrent(owner)) return;
        setNeedsRoutineRefresh(!refreshed);
        setErrorState(
          createScopedPageState(
            owner.scopeKey,
            "日程已被其他家属更新，请刷新后重试",
          ),
        );
      } else setLifecycle({ ...lifecycle, error: readableError(failure) });
    } finally {
      mutationPending.current = false;
      if (ownerIsCurrent(owner))
        setBusyState(createScopedPageState(owner.scopeKey, ""));
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
      if (!ownerIsCurrent(owner)) return;
      await load();
    } catch (actionError) {
      if (ownerIsCurrent(owner)) {
        await load();
        if (!ownerIsCurrent(owner)) return;
        setErrorState(
          createScopedPageState(
            owner.scopeKey,
            `${readableError(actionError)}。已尝试刷新待办，请核对最新状态。`,
          ),
        );
      }
    } finally {
      if (ownerIsCurrent(owner)) {
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
      if (!ownerIsCurrent(owner)) return;
      await load();
    } catch (verifyError) {
      if (ownerIsCurrent(owner)) {
        if (
          verifyError instanceof ApiError &&
          [401, 403, 404].includes(verifyError.status)
        )
          denyHistoryAccess(
            { key: owner.scopeKey, epoch: owner.scopeEpoch },
            readableError(verifyError),
          );
        setErrorState(
          createScopedPageState(owner.scopeKey, readableError(verifyError)),
        );
      }
    } finally {
      if (ownerIsCurrent(owner)) {
        setBusyState((current) =>
          current.scopeKey === owner.scopeKey && current.value === occurrence.id
            ? createScopedPageState(owner.scopeKey, "")
            : current,
        );
      }
    }
  };

  const toggleForm = () => {
    if (busyId || loading || mutationPending.current || needsRoutineRefresh)
      return;
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
    if (
      busyId ||
      loading ||
      mutationPending.current ||
      needsRoutineRefresh ||
      !workspace.householdId ||
      !workspace.recipientId
    )
      return;
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
    <>
      <div className="resource-page" inert={Boolean(lifecycle)}>
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
              ref={refreshButton}
              onClick={() => void load()}
            >
              <RefreshCw aria-hidden="true" size={18} /> 刷新
            </button>
            <button
              className="primary-button"
              type="button"
              onClick={toggleForm}
              disabled={Boolean(busyId) || loading || needsRoutineRefresh}
              aria-expanded={formOpen && formIsCurrent}
            >
              <Plus aria-hidden="true" size={18} /> 新建日程
            </button>
          </div>
        </section>

        {notice && (
          <div className="inline-alert routine-operation-notice" role="status">
            <span>{notice}</span>
            {needsRoutineRefresh && (
              <button
                className="secondary-button"
                type="button"
                disabled={loading || Boolean(busyId)}
                onClick={async () => {
                  if (await load()) setNotice("已刷新当前日程。");
                }}
              >
                刷新状态
              </button>
            )}
          </div>
        )}

        {formOpen && formIsCurrent && (
          <RoutineEditor
            key={`${workspace.workspaceScopeKey}:${workspace.workspaceScopeEpoch}:${editingRoutine?.id ?? "new"}`}
            routine={editingRoutine}
            timezone={workspace.recipient?.timezone ?? "Asia/Shanghai"}
            busy={Boolean(busyId) || loading || needsRoutineRefresh}
            error={error}
            onSave={(input) => void saveRoutine(input)}
            onCancel={closeForm}
          />
        )}

        {error && !(formOpen && formIsCurrent) && (
          <div className="inline-alert danger" role="alert">
            <span>{error}</span>
            <button
              type="button"
              disabled={Boolean(busyId) || loading}
              onClick={() => void load()}
            >
              重试
            </button>
          </div>
        )}

        <div className="routine-task-columns">
          <section className="panel-card">
            <div className="panel-heading">
              <div>

                <h2>日程安排</h2>
              </div>
              <span className="count-badge">
                {resourceErrors.routines ? "—" : routines.length}
              </span>
            </div>
            {loading ? (
              <div className="list-loading">正在加载日程…</div>
            ) : resourceErrors.routines && routines.length === 0 ? (
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
                      <span
                        className={`status-pill ${routine.status === "ACTIVE" ? "success" : "neutral"}`}
                      >
                        {routine.status === "ACTIVE"
                          ? "已启用"
                          : routine.status === "PAUSED"
                            ? "已暂停"
                            : routine.status === "DELETED"
                              ? "已删除"
                              : "状态未知"}
                      </span>
                      {needsRoutineRefresh && <small>状态待刷新</small>}
                      {["ACTIVE", "PAUSED"].includes(routine.status) && (
                        <>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={Boolean(busyId) || needsRoutineRefresh}
                            aria-label={`编辑日程：${routine.title}`}
                            onClick={() => editRoutine(routine)}
                          >
                            编辑
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={Boolean(busyId) || needsRoutineRefresh}
                            ref={(node) => {
                              if (
                                lifecycleFocusRoutineId.current === routine.id
                              )
                                lifecycleFocusTarget.current = node;
                            }}
                            aria-label={`${routine.status === "ACTIVE" ? "暂停" : "恢复"}日程：${routine.title}`}
                            onClick={(event) => {
                              lifecycleFocusRoutineId.current = routine.id;
                              lifecycleFocusTarget.current =
                                event.currentTarget;
                              startLifecycle(routine);
                            }}
                          >
                            {routine.status === "ACTIVE" ? "暂停" : "恢复"}
                          </button>
                        </>
                      )}
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
              onVerify={(item, verified) =>
                void verifyOccurrence(item, verified)
              }
              accessError={historyAccessError}
              onRetryAccess={() => void load()}
              onAccessDenied={(message) =>
                denyHistoryAccess(scopeIdentity, message)
              }
            />
          ))}
        </div>
      </div>
      {lifecycle && ownerIsCurrent(lifecycle.owner) && (
        <RoutineLifecycleDialog
          routine={lifecycle.routine}
          action={lifecycle.action}
          busy={Boolean(busyId)}
          error={lifecycle.error}
          onConfirm={() => void submitLifecycle()}
          onCancel={() => setLifecycle(null)}
          onEdit={() => {
            const routine = lifecycle.routine;
            lifecycleFocusRoutineId.current = null;
            setLifecycle(null);
            editRoutine(routine);
          }}
        />
      )}
    </>
  );
};
