import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
  const { status } = useAuth();
  const [households, setHouseholds] = useState<HouseholdView[]>([]);
  const [recipients, setRecipients] = useState<CareRecipientView[]>([]);
  const [bindings, setBindings] = useState<CompanionBindingView[]>([]);
  const [householdId, setHouseholdId] = useState(() => stored(HOUSEHOLD_KEY));
  const [recipientId, setRecipientId] = useState(() => stored(RECIPIENT_KEY));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadHouseholdResources = useCallback(async (id: string) => {
    if (!id) {
      setRecipients([]);
      setBindings([]);
      setRecipientId("");
      return;
    }
    const [nextRecipients, nextBindings] = await Promise.all([
      apiClient.request<CareRecipientView[]>(`/households/${id}/care-recipients`),
      apiClient.request<CompanionBindingView[]>(`/households/${id}/companion-bindings`),
    ]);
    setRecipients(nextRecipients);
    setBindings(nextBindings);
    setRecipientId((current) => {
      const next = nextRecipients.some((item) => item.id === current)
        ? current
        : nextRecipients[0]?.id ?? "";
      persist(RECIPIENT_KEY, next);
      return next;
    });
  }, []);

  const refresh = useCallback(async () => {
    if (status !== "authenticated") return;
    setLoading(true);
    setError("");
    try {
      const next = await apiClient.request<HouseholdView[]>("/households");
      setHouseholds(next);
      const selected = next.some((item) => item.id === householdId)
        ? householdId
        : next[0]?.id ?? "";
      setHouseholdId(selected);
      persist(HOUSEHOLD_KEY, selected);
      await loadHouseholdResources(selected);
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoading(false);
    }
  }, [householdId, loadHouseholdResources, status]);

  useEffect(() => {
    if (status === "authenticated") void refresh();
    if (status === "anonymous") {
      setHouseholds([]);
      setRecipients([]);
      setBindings([]);
    }
  }, [status]); // refresh deliberately runs once when authentication changes.

  const selectHousehold = useCallback(
    (id: string) => {
      setHouseholdId(id);
      persist(HOUSEHOLD_KEY, id);
      setLoading(true);
      setError("");
      void loadHouseholdResources(id)
        .catch((loadError) => setError(readableError(loadError)))
        .finally(() => setLoading(false));
    },
    [loadHouseholdResources],
  );

  const selectRecipient = useCallback((id: string) => {
    setRecipientId(id);
    persist(RECIPIENT_KEY, id);
  }, []);

  const refreshBindings = useCallback(async () => {
    if (!householdId) return;
    const next = await apiClient.request<CompanionBindingView[]>(
      `/households/${householdId}/companion-bindings`,
    );
    setBindings(next);
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

  const household =
    households.find((item) => item.id === householdId) ?? null;
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
