import { lazy, Suspense, useEffect, useState } from "react";
import type { SensitiveFragmentAction } from "../security/sensitive-fragment";
import { useAuth } from "../auth/auth-context";
import { ProductShell } from "../components/ProductShell";
import { WelcomePage } from "../pages/WelcomePage";
import { AccountSettingsPage } from "../pages/product/AccountSettingsPage";
import { AuthPage } from "../pages/product/AuthPage";
import { InvitationAcceptPage } from "../pages/product/InvitationAcceptPage";
import { MemoriesApiPage } from "../pages/product/MemoriesApiPage";
import { OverviewPage } from "../pages/product/OverviewPage";
import { PrivacyPage } from "../pages/product/PrivacyPage";
import { RoutinesApiPage } from "../pages/product/RoutinesApiPage";
import { routeFromLocation, type ClientRoute } from "./navigation";
import { requiresFamilySession } from "./access-boundary";

const CompanionPage = lazy(() =>
  import("../pages/product/CompanionPage").then((module) => ({
    default: module.CompanionPage,
  })),
);
const DevicesPage = lazy(() =>
  import("../pages/product/DevicesPage").then((module) => ({
    default: module.DevicesPage,
  })),
);
const RemoteCallPage = lazy(() =>
  import("../pages/product/RemoteCallPage").then((module) => ({
    default: module.RemoteCallPage,
  })),
);

const SectionLoading = () => (
  <div className="section-loading" role="status">
    <span className="loading-beacon" />
    <span>正在加载此工作区…</span>
  </div>
);

const productMeta: Partial<
  Record<ClientRoute, { title: string; description: string }>
> = {
  "workspace-overview": {
    title: "家庭概览",
    description: "管理家庭与陪伴配置。",
  },
  "workspace-memories": {
    title: "记忆档案",
    description: "管理陪伴记忆。",
  },
  "workspace-routines": {
    title: "日程与待办",
    description: "管理日程与家庭待办。",
  },
  "workspace-devices": {
    title: "陪伴设备",
    description: "添加和管理陪伴设备。",
  },
  "workspace-privacy": {
    title: "隐私与授权",
    description: "管理长者的隐私授权。",
  },
  "workspace-remote": {
    title: "远程关怀通话",
    description: "呼叫陪伴设备并进行实时对话。",
  },
  "workspace-settings": {
    title: "账号与安全",
    description: "管理邮箱与登录设备。",
  },
  "accept-invitation": {
    title: "家庭邀请",
    description: "接受家庭邀请。",
  },
};

const LoadingScreen = () => (
  <main
    id="main-content"
    className="route-loading"
    tabIndex={-1}
    aria-live="polite"
  >
    <span className="loading-beacon" />
    <strong>正在恢复登录状态</strong>
  </main>
);

export const App = ({
  sensitiveAction,
}: {
  sensitiveAction: SensitiveFragmentAction | null;
}) => {
  const auth = useAuth();
  const [route, setRoute] = useState<ClientRoute>(() => routeFromLocation());

  useEffect(() => {
    const onPopState = () => setRoute(routeFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    const targetId = window.location.hash.replace(/^#/, "");
    window.requestAnimationFrame(() => {
      const target = targetId ? document.getElementById(targetId) : null;
      if (target) {
        target.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "start",
        });
        target.focus({ preventScroll: true });
        return;
      }
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
      document
        .querySelector<HTMLElement>("#main-content")
        ?.focus({ preventScroll: true });
    });
  }, [route]);

  if (route === "home") return <WelcomePage />;

  const sensitiveToken = sensitiveAction?.token;
  if (route === "verify-email" && auth.status === "bootstrapping")
    return <LoadingScreen />;
  if (route === "verify-email") return <AuthPage mode="verify-email" />;
  if (route === "reset-password")
    return (
      <AuthPage
        mode="reset-password"
        token={
          sensitiveAction?.kind === "reset-password"
            ? sensitiveToken
            : undefined
        }
      />
    );
  if (route === "forgot-password") return <AuthPage mode="forgot-password" />;
  if (route === "register") return <AuthPage mode="register" />;

  if (auth.status === "bootstrapping") return <LoadingScreen />;

  const protectedRoute = requiresFamilySession(route);
  if (
    (route === "login" || protectedRoute) &&
    auth.status !== "authenticated"
  ) {
    return (
      <AuthPage
        mode="login"
        returnToInvitation={route === "accept-invitation"}
      />
    );
  }
  if (route === "login") return <AuthPage mode="login" />;
  if (route === "companion")
    return (
      <Suspense fallback={<LoadingScreen />}>
        <CompanionPage />
      </Suspense>
    );

  const meta = productMeta[route] ?? productMeta["workspace-overview"]!;
  return (
    <ProductShell
      route={route}
      title={meta.title}
      description={meta.description}
    >
      <Suspense fallback={<SectionLoading />}>
        {route === "workspace-overview" && <OverviewPage />}
        {route === "workspace-memories" && <MemoriesApiPage />}
        {route === "workspace-routines" && <RoutinesApiPage />}
        {route === "workspace-devices" && <DevicesPage />}
        {route === "workspace-privacy" && <PrivacyPage />}
        {route === "workspace-remote" && <RemoteCallPage />}
        {route === "workspace-settings" && <AccountSettingsPage />}
        {route === "accept-invitation" && (
          <InvitationAcceptPage
            token={
              sensitiveAction?.kind === "accept-invitation"
                ? sensitiveToken
                : undefined
            }
          />
        )}
      </Suspense>
    </ProductShell>
  );
};
