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
import { apiClient, readableError } from "../api/api-client";
import type {
  CareRecipientView,
  CompanionBindingView,
  HouseholdView,
} from "../api/types";
import { useAuth } from "../auth/auth-context";
import {
  LatestScopedRequest,
  WorkspaceScopeTracker,
  workspaceScopeKey as createWorkspaceScopeKey,
} from "./workspace-scope";

const HOUSEHOLD_KEY = "memory-lighthouse.selected-household";
const RECIPIENT_KEY = "memory-lighthouse.selected-recipient";

type WorkspaceContextValue = {
  households: HouseholdView[];
  recipients: CareRecipientView[];
  bindings: CompanionBindingView[];
  household: HouseholdView | null;
  recipient: CareRecipientView | null;
  householdId: string;
  recipientId: string;
  workspaceScopeKey: string;
  workspaceScopeEpoch: number;
  loading: boolean;
  error: string;
  selectHousehold: (id: string) => void;
  selectRecipient: (id: string) => void;
  refresh: () => Promise<void>;
  refreshBindings: () => Promise<void>;
  createHousehold: (name: string, timezone: string) => Promise<void>;
  createRecipient: (input: {
    name: string;
    preferredName?: string;
    timezone: string;
    homeLabel?: string;
  }) => Promise<void>;
};

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

const stored = (key: string): string => {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
};

const persist = (key: string, value: string): void => {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    // Selection persistence is optional; authorization never depends on it.
  }
};

export const WorkspaceProvider = ({ children }: PropsWithChildren) => {
  const { status, user } = useAuth();
  // Changing accounts can leave auth status unchanged. Remount the entire scope,
  // including page drafts and in-flight request owners, when its identity changes.
  return (
    <AccountWorkspaceProvider key={`${status}:${user?.id ?? "anonymous"}`}>
      {children}
    </AccountWorkspaceProvider>
  );
};

const AccountWorkspaceProvider = ({ children }: PropsWithChildren) => {
  const { status } = useAuth();
  const [households, setHouseholds] = useState<HouseholdView[]>([]);
  const [recipients, setRecipients] = useState<CareRecipientView[]>([]);
  const [bindings, setBindings] = useState<CompanionBindingView[]>([]);
  // Remembered IDs are preferences, not evidence that the current user can see them.
  const [householdId, setHouseholdId] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const householdListRequests = useRef(new LatestScopedRequest());
  const householdResourceRequests = useRef(new LatestScopedRequest());
  const bindingRefreshRequests = useRef(new LatestScopedRequest());
  const scopeTracker = useRef(new WorkspaceScopeTracker());
  const resourceHousehold = useRef("");

  const scopeIdentity = scopeTracker.current.observe(
    createWorkspaceScopeKey(householdId, recipientId),
  );

  const loadHouseholdResources = useCallback(
    async (id: string): Promise<boolean> => {
      const request = householdResourceRequests.current.begin(id);
      bindingRefreshRequests.current.invalidate();
      if (resourceHousehold.current !== id) {
        resourceHousehold.current = id;
        setRecipients([]);
        setBindings([]);
        setRecipientId("");
      }
      if (!id) {
        setRecipients([]);
        setBindings([]);
        setRecipientId("");
        return true;
      }
      try {
        const [nextRecipients, nextBindings] = await Promise.all([
          apiClient.request<CareRecipientView[]>(
            `/households/${id}/care-recipients`,
          ),
          apiClient.request<CompanionBindingView[]>(
            `/households/${id}/companion-bindings`,
          ),
        ]);
        if (!householdResourceRequests.current.isCurrent(request)) return false;
        setRecipients(nextRecipients);
        setBindings(nextBindings);
        setRecipientId((current) => {
          const preferred = current || stored(RECIPIENT_KEY);
          const next = nextRecipients.some((item) => item.id === preferred)
            ? preferred
            : (nextRecipients[0]?.id ?? "");
          persist(RECIPIENT_KEY, next);
          return next;
        });
        return true;
      } catch (loadError) {
        if (!householdResourceRequests.current.isCurrent(request)) return false;
        throw loadError;
      }
    },
    [],
  );

  const refresh = useCallback(async () => {
    if (status !== "authenticated") return;
    const request = householdListRequests.current.begin("households");
    setLoading(true);
    setError("");
    try {
      const next = await apiClient.request<HouseholdView[]>("/households");
      if (!householdListRequests.current.isCurrent(request)) return;
      setHouseholds(next);
      const preferred = householdId || stored(HOUSEHOLD_KEY);
      const selected = next.some((item) => item.id === preferred)
        ? preferred
        : (next[0]?.id ?? "");
      setHouseholdId(selected);
      persist(HOUSEHOLD_KEY, selected);
      await loadHouseholdResources(selected);
    } catch (loadError) {
      if (householdListRequests.current.isCurrent(request)) {
        setError(readableError(loadError));
      }
    } finally {
      if (householdListRequests.current.isCurrent(request)) setLoading(false);
    }
  }, [householdId, loadHouseholdResources, status]);

  useEffect(() => {
    if (status === "authenticated") void refresh();
    if (status === "anonymous") {
      householdListRequests.current.invalidate();
      householdResourceRequests.current.invalidate();
      bindingRefreshRequests.current.invalidate();
      setHouseholds([]);
      setRecipients([]);
      setBindings([]);
    }
    return () => {
      householdListRequests.current.invalidate();
      householdResourceRequests.current.invalidate();
      bindingRefreshRequests.current.invalidate();
    };
  }, [status]); // refresh deliberately runs once when authentication changes.

  const selectHousehold = useCallback(
    (id: string) => {
      householdListRequests.current.invalidate();
      setHouseholdId(id);
      persist(HOUSEHOLD_KEY, id);
      setLoading(true);
      setError("");
      void loadHouseholdResources(id)
        .then((applied) => {
          if (applied) setLoading(false);
        })
        .catch((loadError) => {
          setError(readableError(loadError));
          setLoading(false);
        });
    },
    [loadHouseholdResources],
  );

  const selectRecipient = useCallback((id: string) => {
    setRecipientId(id);
    persist(RECIPIENT_KEY, id);
  }, []);

  const refreshBindings = useCallback(async () => {
    if (!householdId) return;
    const request = bindingRefreshRequests.current.begin(householdId);
    try {
      const next = await apiClient.request<CompanionBindingView[]>(
        `/households/${householdId}/companion-bindings`,
      );
      if (bindingRefreshRequests.current.isCurrent(request)) setBindings(next);
    } catch (loadError) {
      if (bindingRefreshRequests.current.isCurrent(request)) throw loadError;
    }
  }, [householdId]);

  const createHousehold = useCallback(
    async (name: string, timezone: string) => {
      const created = await apiClient.request<HouseholdView>("/households", {
        method: "POST",
        body: { name, timezone },
      });
      setHouseholds((current) => [...current, created]);
      selectHousehold(created.id);
    },
    [selectHousehold],
  );

  const createRecipient = useCallback(
    async (input: {
      name: string;
      preferredName?: string;
      timezone: string;
      homeLabel?: string;
    }) => {
      if (!householdId) throw new Error("请先创建或选择家庭");
      const created = await apiClient.request<CareRecipientView>(
        `/households/${householdId}/care-recipients`,
        { method: "POST", body: input },
      );
      setRecipients((current) => [...current, created]);
      selectRecipient(created.id);
    },
    [householdId, selectRecipient],
  );

  const household = households.find((item) => item.id === householdId) ?? null;
  const recipient = recipients.find((item) => item.id === recipientId) ?? null;

  const value = useMemo<WorkspaceContextValue>(
    () => ({
      households,
      recipients,
      bindings,
      household,
      recipient,
      householdId,
      recipientId,
      workspaceScopeKey: scopeIdentity.key,
      workspaceScopeEpoch: scopeIdentity.epoch,
      loading,
      error,
      selectHousehold,
      selectRecipient,
      refresh,
      refreshBindings,
      createHousehold,
      createRecipient,
    }),
    [
      bindings,
      createHousehold,
      createRecipient,
      error,
      household,
      householdId,
      households,
      loading,
      recipient,
      recipientId,
      recipients,
      refresh,
      refreshBindings,
      selectHousehold,
      selectRecipient,
      scopeIdentity.epoch,
      scopeIdentity.key,
    ],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = (): WorkspaceContextValue => {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return context;
};
