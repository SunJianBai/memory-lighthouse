import { lazy, Suspense, useEffect, useState } from "react";
import type { SensitiveFragmentAction } from "../security/sensitive-fragment";
import { useAuth } from "../auth/auth-context";
import { ProductShell } from "../components/ProductShell";
import { AppShell } from "../components/AppShell";
import type { AppRoute } from "../domain/types";
import { FamilyPage } from "../pages/FamilyPage";
import { MemoriesPage } from "../pages/MemoriesPage";
import { OnboardingPage } from "../pages/OnboardingPage";
import { WelcomePage } from "../pages/WelcomePage";
import { AccountSettingsPage } from "../pages/product/AccountSettingsPage";
import { AuthPage } from "../pages/product/AuthPage";
import { InvitationAcceptPage } from "../pages/product/InvitationAcceptPage";
import { MemoriesApiPage } from "../pages/product/MemoriesApiPage";
import { OverviewPage } from "../pages/product/OverviewPage";
import { PrivacyPage } from "../pages/product/PrivacyPage";
import { RoutinesApiPage } from "../pages/product/RoutinesApiPage";
import {
  routeFromLocation,
  type ClientRoute,
} from "./navigation";

const CarePage = lazy(() => import("../pages/CarePage").then((module) => ({ default: module.CarePage })));
const DemoPage = lazy(() => import("../pages/DemoPage").then((module) => ({ default: module.DemoPage })));
const SettingsPage = lazy(() => import("../pages/SettingsPage").then((module) => ({ default: module.SettingsPage })));
const CompanionPage = lazy(() => import("../pages/product/CompanionPage").then((module) => ({ default: module.CompanionPage })));
const DevicesPage = lazy(() => import("../pages/product/DevicesPage").then((module) => ({ default: module.DevicesPage })));
const RemoteCallPage = lazy(() => import("../pages/product/RemoteCallPage").then((module) => ({ default: module.RemoteCallPage })));

const SectionLoading = () => (
  <div className="section-loading" role="status">
    <span className="loading-beacon" />
    <span>正在加载此工作区…</span>
  </div>
);

const demoMeta: Record<
  Exclude<AppRoute, "welcome">,
  { title: string; description: string }
> = {
  onboarding: { title: "建立陪伴档案", description: "用家属已确认的信息，为助手建立安全、可删除的演示记忆。" },
  care: { title: "陪伴端 Demo", description: "保留原比赛 Demo 的大字交互、视频、语音与主动提醒。" },
  family: { title: "家属端 Demo", description: "保留原 Demo 的任务状态、事件摘要与人工确认闭环。" },
  memories: { title: "记忆中心 Demo", description: "本地演示人物、药物日程、偏好、位置和照片资料。" },
  demo: { title: "现场演示台", description: "一镜到底展示提醒、主动纠正、确认和家属协同。" },
  settings: { title: "Demo 模型与隐私设置", description: "切换 Ascend 本地模型、ModelBest 公网服务或确定性回放。" },
};

const productMeta: Partial<Record<ClientRoute, { title: string; description: string }>> = {
  "workspace-overview": { title: "家庭概览", description: "选择家庭和陪伴对象，完成记忆、日程、设备与隐私配置。" },
  "workspace-memories": { title: "记忆档案", description: "管理服务器加密保存、可追溯修订和可删除的陪伴记忆。" },
  "workspace-routines": { title: "日程与待办", description: "维护家属原样录入的确定性日程，并处理家庭协同事项。" },
  "workspace-devices": { title: "陪伴设备", description: "通过二维码或动态码激活一人一设备绑定。" },
  "workspace-privacy": { title: "隐私与 Consent 中心", description: "逐项查看、授权或撤回摄像头、麦克风、模型与远程协助能力。" },
  "workspace-remote": { title: "远程关怀通话", description: "呼叫陪伴设备，等待现场接听后进行不录音、不转写的实时对话。" },
  "workspace-settings": { title: "账号与安全", description: "验证邮箱、查看登录会话并撤销不再使用的设备。" },
  "accept-invitation": { title: "家庭邀请", description: "确认并接受家庭管理员发送的一次性成员邀请。" },
};

const DemoApplication = ({ route }: { route: `demo-${AppRoute}` }) => {
  const demoRoute = route.slice(5) as AppRoute;
  if (demoRoute === "welcome") return <WelcomePage demoLanding />;
  const meta = demoMeta[demoRoute];
  return (
    <AppShell route={demoRoute} title={meta.title} description={meta.description}>
      <Suspense fallback={<SectionLoading />}>
        {demoRoute === "onboarding" && <OnboardingPage />}
        {demoRoute === "care" && <CarePage />}
        {demoRoute === "family" && <FamilyPage />}
        {demoRoute === "memories" && <MemoriesPage />}
        {demoRoute === "demo" && <DemoPage />}
        {demoRoute === "settings" && <SettingsPage />}
      </Suspense>
    </AppShell>
  );
};

const LoadingScreen = () => (
  <main id="main-content" className="route-loading" tabIndex={-1} aria-live="polite">
    <span className="loading-beacon" />
    <strong>正在恢复安全会话</strong>
    <p>访问令牌只保存在当前页面内存中。</p>
  </main>
);

export const App = ({ sensitiveAction }: { sensitiveAction: SensitiveFragmentAction | null }) => {
  const auth = useAuth();
  const [route, setRoute] = useState<ClientRoute>(() => routeFromLocation());

  useEffect(() => {
    const onPopState = () => setRoute(routeFromLocation());
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>("#main-content")?.focus({ preventScroll: true });
    });
  }, [route]);

  if (route.startsWith("demo-")) return <DemoApplication route={route as `demo-${AppRoute}`} />;
  if (route === "home") return <WelcomePage />;

  const sensitiveToken = sensitiveAction?.token;
  if (route === "verify-email") return <AuthPage mode="verify-email" token={sensitiveAction?.kind === "verify-email" ? sensitiveToken : undefined} />;
  if (route === "reset-password") return <AuthPage mode="reset-password" token={sensitiveAction?.kind === "reset-password" ? sensitiveToken : undefined} />;
  if (route === "forgot-password") return <AuthPage mode="forgot-password" />;
  if (route === "register") return <AuthPage mode="register" />;

  if (auth.status === "bootstrapping") return <LoadingScreen />;

  const protectedRoute = route === "companion" || route.startsWith("workspace-") || route === "accept-invitation";
  if ((route === "login" || protectedRoute) && auth.status !== "authenticated") {
    return <AuthPage mode="login" returnToInvitation={route === "accept-invitation"} />;
  }
  if (route === "login") return <AuthPage mode="login" />;
  if (route === "companion") return <Suspense fallback={<LoadingScreen />}><CompanionPage /></Suspense>;

  const meta = productMeta[route] ?? productMeta["workspace-overview"]!;
  return (
    <ProductShell route={route} title={meta.title} description={meta.description}>
      <Suspense fallback={<SectionLoading />}>
        {route === "workspace-overview" && <OverviewPage />}
        {route === "workspace-memories" && <MemoriesApiPage />}
        {route === "workspace-routines" && <RoutinesApiPage />}
        {route === "workspace-devices" && <DevicesPage />}
        {route === "workspace-privacy" && <PrivacyPage />}
        {route === "workspace-remote" && <RemoteCallPage />}
        {route === "workspace-settings" && <AccountSettingsPage />}
        {route === "accept-invitation" && <InvitationAcceptPage token={sensitiveAction?.kind === "accept-invitation" ? sensitiveToken : undefined} />}
      </Suspense>
    </ProductShell>
  );
};
