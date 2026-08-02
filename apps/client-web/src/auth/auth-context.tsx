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
import { ApiError, apiClient } from "../api/api-client";
import { clearPersistentIdempotencyNamespace } from "../api/idempotent-command";
import type { SessionTokenView, UserView } from "../api/types";

type RegisterInput = {
  email: string;
  username?: string;
  password: string;
  displayName?: string;
};

type AuthContextValue = {
  status: "bootstrapping" | "anonymous" | "authenticated";
  user: UserView | null;
  login: (identifier: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  lockToDeviceMode: () => Promise<void>;
  refreshUser: () => Promise<void>;
  requestEmailVerification: (email: string) => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export const AuthProvider = ({ children }: PropsWithChildren) => {
  const [status, setStatus] =
    useState<AuthContextValue["status"]>("bootstrapping");
  const [user, setUser] = useState<UserView | null>(null);
  const mounted = useRef(true);
  const initialRefreshStarted = useRef(false);
  const activeUserId = useRef<string | null>(null);

  const markAnonymous = useCallback(() => {
    if (activeUserId.current) {
      clearPersistentIdempotencyNamespace(activeUserId.current);
      activeUserId.current = null;
    }
    apiClient.setAccessToken(null);
    if (mounted.current) {
      setUser(null);
      setStatus("anonymous");
    }
  }, []);

  const loadMe = useCallback(async (): Promise<UserView> => {
    const next = await apiClient.request<UserView>("/me", {
      retryAuthentication: false,
    });
    if (activeUserId.current && activeUserId.current !== next.id) {
      clearPersistentIdempotencyNamespace(activeUserId.current);
    }
    activeUserId.current = next.id;
    if (mounted.current) setUser(next);
    return next;
  }, []);

  const applySession = useCallback(
    async (session: SessionTokenView): Promise<void> => {
      apiClient.setAccessToken(session.accessToken);
      await loadMe();
      if (mounted.current) setStatus("authenticated");
    },
    [loadMe],
  );

  const refresh = useCallback(async (): Promise<boolean> => {
    try {
      const session = await apiClient.request<SessionTokenView>(
        "/auth/refresh",
        {
          method: "POST",
          body: { clientType: "WEB" },
          authenticated: false,
          retryAuthentication: false,
        },
      );
      await applySession(session);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        markAnonymous();
        return false;
      }
      if (mounted.current) setStatus("anonymous");
      return false;
    }
  }, [applySession, markAnonymous]);

  useEffect(() => {
    mounted.current = true;
    apiClient.setRefreshHandler(refresh);
    // React StrictMode replays effects in development. Refresh tokens rotate,
    // so a second bootstrap request could look like credential replay.
    if (!initialRefreshStarted.current) {
      initialRefreshStarted.current = true;
      void refresh();
    }
    return () => {
      mounted.current = false;
      apiClient.setRefreshHandler(null);
    };
  }, [refresh]);

  const login = useCallback(
    async (identifier: string, password: string) => {
      const session = await apiClient.request<SessionTokenView>("/auth/login", {
        method: "POST",
        body: { identifier, password, clientType: "WEB" },
        authenticated: false,
        retryAuthentication: false,
      });
      await applySession(session);
    },
    [applySession],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const session = await apiClient.request<SessionTokenView>(
        "/auth/register",
        {
          method: "POST",
          body: {
            email: input.email,
            username: input.username || undefined,
            password: input.password,
            displayName: input.displayName || undefined,
            clientType: "WEB",
          },
          authenticated: false,
          retryAuthentication: false,
        },
      );
      await applySession(session);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await apiClient.request<{ loggedOut: true }>("/auth/logout", {
        method: "POST",
        retryAuthentication: false,
      });
    } finally {
      markAnonymous();
    }
  }, [markAnonymous]);

  const logoutAll = useCallback(async () => {
    try {
      await apiClient.request<{ loggedOut: true }>("/auth/logout-all", {
        method: "POST",
        retryAuthentication: false,
      });
    } finally {
      markAnonymous();
    }
  }, [markAnonymous]);

  const lockToDeviceMode = useCallback(async () => {
    await apiClient.request<{ locked: true }>("/auth/device-mode-lock", {
      method: "POST",
      body: {},
      authenticated: false,
      retryAuthentication: false,
    });
    markAnonymous();
  }, [markAnonymous]);

  const refreshUser = useCallback(async () => {
    await loadMe();
  }, [loadMe]);

  const requestEmailVerification = useCallback(async (email: string) => {
    await apiClient.request<{ accepted: true }>("/auth/email-verifications", {
      method: "POST",
      body: { email },
    });
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user,
      login,
      register,
      logout,
      logoutAll,
      lockToDeviceMode,
      refreshUser,
      requestEmailVerification,
    }),
    [
      login,
      lockToDeviceMode,
      logout,
      logoutAll,
      refreshUser,
      register,
      requestEmailVerification,
      status,
      user,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = (): AuthContextValue => {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used within AuthProvider");
  return context;
};
