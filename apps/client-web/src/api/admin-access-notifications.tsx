import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from "react";
import { apiClient, readableError } from "./api-client";

export const ADMIN_ACCESS_PAGE_SIZE = 20;
export const ADMIN_ACCESS_POLL_INTERVAL_MS = 30_000;

export type AdminAccessNotificationState = "UNREAD" | "READ" | "HISTORICAL";
export type AdminAccessFeedStatus = "disabled" | "loading" | "ready" | "error";

export type AdminAccessRecord = {
  id: string;
  occurredAt: string;
  category: string;
  categoryLabel: string;
  reason: string;
  notificationState: AdminAccessNotificationState;
  readAt: string | null;
};

export type AdminAccessPage = {
  items: AdminAccessRecord[];
  nextCursor: string | null;
  unreadCount: number;
};

export type AdminAccessReadResult = {
  inspectionId: string;
  readAt: string;
};

export type AdminAccessRequest = <T>(
  path: string,
  options?: { method?: string },
) => Promise<T>;

type HouseholdRole = "OWNER" | "CAREGIVER" | "VIEWER";

type AdminAccessLoadOptions = {
  cursor?: string | null;
  request?: AdminAccessRequest;
};

type ScopedFeedState = {
  scopeKey: string;
  scopeEpoch: number;
  page: AdminAccessPage;
  status: AdminAccessFeedStatus;
  feedError: string;
  actionError: string;
  refreshing: boolean;
  loadingMore: boolean;
  markingReadIds: ReadonlySet<string>;
};

type ScopeIdentity = {
  key: string;
  epoch: number;
};

const emptyPage = (): AdminAccessPage => ({
  items: [],
  nextCursor: null,
  unreadCount: 0,
});

const emptyMarkingReadIds = new Set<string>();

const emptyScopedFeed = (
  scopeKey = "",
  scopeEpoch = 0,
  status: AdminAccessFeedStatus = "disabled",
): ScopedFeedState => ({
  scopeKey,
  scopeEpoch,
  page: emptyPage(),
  status,
  feedError: "",
  actionError: "",
  refreshing: false,
  loadingMore: false,
  markingReadIds: emptyMarkingReadIds,
});

const clientRequest: AdminAccessRequest = (path, options) =>
  apiClient.request(path, options);

const isSameScope = (
  state: Pick<ScopedFeedState, "scopeKey" | "scopeEpoch">,
  scope: ScopeIdentity,
): boolean => state.scopeKey === scope.key && state.scopeEpoch === scope.epoch;

const compareAdminAccessRecords = (
  left: AdminAccessRecord,
  right: AdminAccessRecord,
): number => {
  const timeOrder = right.occurredAt.localeCompare(left.occurredAt);
  return timeOrder !== 0 ? timeOrder : right.id.localeCompare(left.id);
};

const mergeRecord = (
  current: AdminAccessRecord | undefined,
  incoming: AdminAccessRecord,
): AdminAccessRecord => {
  // Read receipts are monotonic. A response that started before a read mutation
  // must never visually turn a locally confirmed READ record back into UNREAD.
  if (
    current?.notificationState === "READ" &&
    incoming.notificationState === "UNREAD"
  ) {
    return {
      ...incoming,
      notificationState: "READ",
      readAt: current.readAt,
    };
  }
  return incoming;
};

const mergeItems = (
  current: readonly AdminAccessRecord[],
  incoming: readonly AdminAccessRecord[],
): AdminAccessRecord[] => {
  const records = new Map(current.map((record) => [record.id, record]));
  for (const record of incoming) {
    records.set(record.id, mergeRecord(records.get(record.id), record));
  }
  return [...records.values()].sort(compareAdminAccessRecords);
};

export const mergeAdminAccessRefresh = (
  current: AdminAccessPage,
  incoming: AdminAccessPage,
  preserveUnreadCount = false,
): AdminAccessPage => {
  const currentIds = new Set(current.items.map((record) => record.id));
  const currentNewestId = current.items[0]?.id;
  const overlapsCurrentWindow =
    !currentNewestId || incoming.items.some((record) => record.id === currentNewestId);
  const unseenUnreadCount = incoming.items.filter(
    (record) => record.notificationState === "UNREAD" && !currentIds.has(record.id),
  ).length;

  return {
    items: mergeItems(current.items, incoming.items),
    // When the refreshed window overlaps the records already held, the current
    // cursor remains the furthest loaded boundary. If it does not overlap, use
    // the new cursor so a burst of more than one page cannot create a gap.
    nextCursor:
      current.items.length > 0 && overlapsCurrentWindow
        ? current.nextCursor
        : incoming.nextCursor,
    unreadCount: preserveUnreadCount
      ? current.unreadCount + unseenUnreadCount
      : incoming.unreadCount,
  };
};

export const appendAdminAccessPage = (
  current: AdminAccessPage,
  incoming: AdminAccessPage,
): AdminAccessPage => ({
  items: mergeItems(current.items, incoming.items),
  nextCursor: incoming.nextCursor,
  // Loading older records must not replace the latest global unread count with
  // a response that may have raced a foreground refresh or read mutation.
  unreadCount: current.unreadCount,
});

export const applyAdminAccessRead = (
  current: AdminAccessPage,
  result: AdminAccessReadResult,
): AdminAccessPage => {
  const wasUnread = current.items.some(
    (item) =>
      item.id === result.inspectionId && item.notificationState === "UNREAD",
  );
  return {
    ...current,
    unreadCount: Math.max(0, current.unreadCount - (wasUnread ? 1 : 0)),
    items: current.items.map((item) =>
      item.id === result.inspectionId
        ? { ...item, notificationState: "READ", readAt: result.readAt }
        : item,
    ),
  };
};

export const isHouseholdOwner = (
  roleCodes: readonly HouseholdRole[] | null | undefined,
): boolean => roleCodes?.includes("OWNER") ?? false;

export const loadAdminAccessNotifications = async (
  householdId: string,
  roleCodes: readonly HouseholdRole[] | null | undefined,
  options: AdminAccessLoadOptions = {},
): Promise<AdminAccessPage | null> => {
  if (!householdId || !isHouseholdOwner(roleCodes)) return null;
  const query = new URLSearchParams({ limit: String(ADMIN_ACCESS_PAGE_SIZE) });
  if (options.cursor) query.set("cursor", options.cursor);
  return (options.request ?? clientRequest)<AdminAccessPage>(
    `/households/${householdId}/privacy/admin-accesses?${query.toString()}`,
  );
};

export const markAdminAccessNotificationRead = async (
  householdId: string,
  inspectionId: string,
  roleCodes: readonly HouseholdRole[] | null | undefined,
  request: AdminAccessRequest = clientRequest,
): Promise<AdminAccessReadResult | null> => {
  if (!householdId || !inspectionId || !isHouseholdOwner(roleCodes)) return null;
  return request<AdminAccessReadResult>(
    `/households/${householdId}/privacy/admin-accesses/${inspectionId}/read`,
    { method: "POST" },
  );
};

export type AdminAccessNotificationsValue = {
  isOwner: boolean;
  page: AdminAccessPage;
  status: AdminAccessFeedStatus;
  loading: boolean;
  refreshing: boolean;
  loadingMore: boolean;
  error: string;
  markingReadIds: ReadonlySet<string>;
  refresh: () => Promise<void>;
  loadMore: () => Promise<void>;
  markRead: (inspectionId: string) => Promise<void>;
};

const AdminAccessNotificationsContext =
  createContext<AdminAccessNotificationsValue | null>(null);

export const useAdminAccessNotificationsController = (
  householdId: string,
  roleCodes: readonly HouseholdRole[] | null | undefined,
): AdminAccessNotificationsValue => {
  const isOwner = isHouseholdOwner(roleCodes);
  const scopeKey = isOwner && householdId ? `OWNER:${householdId}` : "";
  const scopeIdentityRef = useRef<ScopeIdentity>({ key: scopeKey, epoch: 0 });
  if (scopeIdentityRef.current.key !== scopeKey) {
    scopeIdentityRef.current = {
      key: scopeKey,
      epoch: scopeIdentityRef.current.epoch + 1,
    };
  }
  const scopeEpoch = scopeIdentityRef.current.epoch;
  const requestScope = useMemo<ScopeIdentity>(
    () => ({ key: scopeKey, epoch: scopeEpoch }),
    [scopeEpoch, scopeKey],
  );

  const [state, setState] = useState<ScopedFeedState>(() => emptyScopedFeed());
  const stateRef = useRef(state);
  const roleCodesRef = useRef(roleCodes);
  const refreshVersion = useRef(0);
  const loadMoreVersion = useRef(0);
  const successfulReadVersion = useRef(0);
  const refreshInFlight = useRef<{
    scope: ScopeIdentity;
    id: number;
    promise: Promise<void>;
  } | null>(null);
  const loadMoreInFlight = useRef<{
    scope: ScopeIdentity;
    id: number;
    promise: Promise<void>;
  } | null>(null);
  const markingReadIdsRef = useRef<{
    scope: ScopeIdentity;
    ids: Set<string>;
  }>({ scope: requestScope, ids: new Set() });

  stateRef.current = state;
  roleCodesRef.current = roleCodes;

  const scopeIsCurrent = useCallback(
    (scope: ScopeIdentity): boolean =>
      scopeIdentityRef.current.key === scope.key &&
      scopeIdentityRef.current.epoch === scope.epoch,
    [],
  );

  const runRefresh = useCallback(
    (mode: "initial" | "manual" | "silent"): Promise<void> => {
      const scope = requestScope;
      if (!scope.key || !householdId || !isOwner) return Promise.resolve();

      const activeRefresh = refreshInFlight.current;
      if (
        activeRefresh &&
        activeRefresh.scope.key === scope.key &&
        activeRefresh.scope.epoch === scope.epoch
      ) {
        if (mode === "manual") {
          setState((current) =>
            isSameScope(current, scope)
              ? {
                  ...current,
                  status: "loading",
                  feedError: "",
                  refreshing: true,
                }
              : current,
          );
        }
        return activeRefresh.promise;
      }

      if (
        mode === "silent" &&
        loadMoreInFlight.current &&
        loadMoreInFlight.current.scope.key === scope.key &&
        loadMoreInFlight.current.scope.epoch === scope.epoch
      ) {
        return Promise.resolve();
      }

      const version = ++refreshVersion.current;
      const readVersionAtStart = successfulReadVersion.current;
      if (mode !== "silent") {
        setState((current) => {
          const sameScope = isSameScope(current, scope);
          return {
            ...(sameScope ? current : emptyScopedFeed(scope.key, scope.epoch)),
            scopeKey: scope.key,
            scopeEpoch: scope.epoch,
            status: "loading",
            feedError: "",
            refreshing: mode === "manual",
          };
        });
      }

      const promise = (async () => {
        try {
          const next = await loadAdminAccessNotifications(
            householdId,
            roleCodesRef.current,
          );
          if (
            !next ||
            version !== refreshVersion.current ||
            !scopeIsCurrent(scope)
          ) return;

          setState((current) => {
            const currentPage = isSameScope(current, scope)
              ? current.page
              : emptyPage();
            return {
              ...(isSameScope(current, scope)
                ? current
                : emptyScopedFeed(scope.key, scope.epoch)),
              scopeKey: scope.key,
              scopeEpoch: scope.epoch,
              page: mergeAdminAccessRefresh(
                currentPage,
                next,
                successfulReadVersion.current !== readVersionAtStart,
              ),
              status: "ready",
              feedError: "",
              refreshing: false,
            };
          });
        } catch (loadError) {
          if (
            version !== refreshVersion.current ||
            !scopeIsCurrent(scope)
          ) return;
          setState((current) => ({
            ...(isSameScope(current, scope)
              ? current
              : emptyScopedFeed(scope.key, scope.epoch)),
            scopeKey: scope.key,
            scopeEpoch: scope.epoch,
            status: "error",
            feedError: readableError(loadError),
            refreshing: false,
          }));
        } finally {
          const active = refreshInFlight.current;
          if (
            active?.id === version &&
            active.scope.key === scope.key &&
            active.scope.epoch === scope.epoch
          ) {
            refreshInFlight.current = null;
          }
        }
      })();

      refreshInFlight.current = { scope, id: version, promise };
      return promise;
    },
    [householdId, isOwner, requestScope, scopeIsCurrent],
  );

  useEffect(() => {
    refreshVersion.current += 1;
    loadMoreVersion.current += 1;
    refreshInFlight.current = null;
    loadMoreInFlight.current = null;
    markingReadIdsRef.current = { scope: requestScope, ids: new Set() };

    if (!requestScope.key) {
      setState(emptyScopedFeed("", requestScope.epoch, "disabled"));
      return undefined;
    }

    setState(emptyScopedFeed(requestScope.key, requestScope.epoch, "loading"));
    void runRefresh("initial");
    const pollTimer = window.setInterval(() => {
      void runRefresh("silent");
    }, ADMIN_ACCESS_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(pollTimer);
      refreshVersion.current += 1;
      loadMoreVersion.current += 1;
    };
  }, [requestScope, runRefresh]);

  const refresh = useCallback(() => runRefresh("manual"), [runRefresh]);

  const loadMore = useCallback((): Promise<void> => {
    const scope = requestScope;
    if (!scope.key || !householdId || !isOwner) return Promise.resolve();

    const current = stateRef.current;
    if (!isSameScope(current, scope) || !current.page.nextCursor) {
      return Promise.resolve();
    }
    const activeLoad = loadMoreInFlight.current;
    if (
      activeLoad &&
      activeLoad.scope.key === scope.key &&
      activeLoad.scope.epoch === scope.epoch
    ) return activeLoad.promise;

    const cursor = current.page.nextCursor;
    const version = ++loadMoreVersion.current;
    setState((latest) =>
      isSameScope(latest, scope)
        ? { ...latest, actionError: "", loadingMore: true }
        : latest,
    );

    const promise = (async () => {
      try {
        const next = await loadAdminAccessNotifications(
          householdId,
          roleCodesRef.current,
          { cursor },
        );
        if (
          !next ||
          version !== loadMoreVersion.current ||
          !scopeIsCurrent(scope)
        ) return;
        setState((latest) =>
          isSameScope(latest, scope)
            ? {
                ...latest,
                page: appendAdminAccessPage(latest.page, next),
                actionError: "",
                loadingMore: false,
              }
            : latest,
        );
      } catch (loadError) {
        if (
          version !== loadMoreVersion.current ||
          !scopeIsCurrent(scope)
        ) return;
        setState((latest) =>
          isSameScope(latest, scope)
            ? {
                ...latest,
                actionError: readableError(loadError),
                loadingMore: false,
              }
            : latest,
        );
      } finally {
        const active = loadMoreInFlight.current;
        if (
          active?.id === version &&
          active.scope.key === scope.key &&
          active.scope.epoch === scope.epoch
        ) {
          loadMoreInFlight.current = null;
        }
      }
    })();

    loadMoreInFlight.current = { scope, id: version, promise };
    return promise;
  }, [householdId, isOwner, requestScope, scopeIsCurrent]);

  const markRead = useCallback(
    async (inspectionId: string): Promise<void> => {
      const scope = requestScope;
      if (!scope.key || !householdId || !isOwner || !inspectionId) return;

      if (
        markingReadIdsRef.current.scope.key !== scope.key ||
        markingReadIdsRef.current.scope.epoch !== scope.epoch
      ) {
        markingReadIdsRef.current = { scope, ids: new Set() };
      }
      if (markingReadIdsRef.current.ids.has(inspectionId)) return;

      markingReadIdsRef.current.ids.add(inspectionId);
      setState((current) =>
        isSameScope(current, scope)
          ? {
              ...current,
              actionError: "",
              markingReadIds: new Set(markingReadIdsRef.current.ids),
            }
          : current,
      );

      try {
        const result = await markAdminAccessNotificationRead(
          householdId,
          inspectionId,
          roleCodesRef.current,
        );
        if (!result || !scopeIsCurrent(scope)) return;
        successfulReadVersion.current += 1;
        setState((current) =>
          isSameScope(current, scope)
            ? {
                ...current,
                page: applyAdminAccessRead(current.page, result),
                actionError: "",
              }
            : current,
        );
      } catch (markError) {
        if (!scopeIsCurrent(scope)) return;
        setState((current) =>
          isSameScope(current, scope)
            ? { ...current, actionError: readableError(markError) }
            : current,
        );
      } finally {
        if (
          markingReadIdsRef.current.scope.key === scope.key &&
          markingReadIdsRef.current.scope.epoch === scope.epoch
        ) {
          markingReadIdsRef.current.ids.delete(inspectionId);
          const remainingIds = new Set(markingReadIdsRef.current.ids);
          setState((current) =>
            isSameScope(current, scope)
              ? { ...current, markingReadIds: remainingIds }
              : current,
          );
        }
      }
    },
    [householdId, isOwner, requestScope, scopeIsCurrent],
  );

  const visibleState = useMemo<ScopedFeedState>(() => {
    if (!isOwner || !requestScope.key) {
      return emptyScopedFeed("", requestScope.epoch, "disabled");
    }
    if (!isSameScope(state, requestScope)) {
      return emptyScopedFeed(requestScope.key, requestScope.epoch, "loading");
    }
    return state;
  }, [isOwner, requestScope, state]);

  return useMemo(
    () => ({
      isOwner,
      page: visibleState.page,
      status: visibleState.status,
      loading: visibleState.status === "loading",
      refreshing: visibleState.refreshing,
      loadingMore: visibleState.loadingMore,
      error: visibleState.actionError || visibleState.feedError,
      markingReadIds: visibleState.markingReadIds,
      refresh,
      loadMore,
      markRead,
    }),
    [isOwner, loadMore, markRead, refresh, visibleState],
  );
};

export const AdminAccessNotificationsProvider = ({
  value,
  children,
}: PropsWithChildren<{ value: AdminAccessNotificationsValue }>) => (
  <AdminAccessNotificationsContext.Provider value={value}>
    {children}
  </AdminAccessNotificationsContext.Provider>
);

export const useAdminAccessNotifications = (): AdminAccessNotificationsValue => {
  const context = useContext(AdminAccessNotificationsContext);
  if (!context) {
    throw new Error(
      "useAdminAccessNotifications must be used within AdminAccessNotificationsProvider",
    );
  }
  return context;
};
