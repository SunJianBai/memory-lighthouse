import { useEffect, useState } from "react";
import { AppShell } from "../components/AppShell";
import type { AppRoute } from "../domain/types";
import { CarePage } from "../pages/CarePage";
import { DemoPage } from "../pages/DemoPage";
import { FamilyPage } from "../pages/FamilyPage";
import { MemoriesPage } from "../pages/MemoriesPage";
import { OnboardingPage } from "../pages/OnboardingPage";
import { SettingsPage } from "../pages/SettingsPage";
import { WelcomePage } from "../pages/WelcomePage";
import { routeFromHash } from "./navigation";

const routeMeta: Record<
  Exclude<AppRoute, "welcome">,
  { title: string; description: string }
> = {
  onboarding: {
    title: "建立陪伴档案",
    description: "用家属已确认的信息，为助手建立安全、可删除的记忆。",
  },
  care: {
    title: "陪伴端",
    description: "面向长者的大字交互界面，支持视频、语音与主动提醒。",
  },
  family: {
    title: "家属端",
    description: "只呈现可解释的任务状态、事件摘要与需要人工确认的事项。",
  },
  memories: {
    title: "记忆中心",
    description: "管理人物、药物日程、偏好、常用位置与照片资料。",
  },
  demo: {
    title: "现场演示台",
    description: "一镜到底跑通晨间提醒、主动纠正、确认和家属协同。",
  },
  settings: {
    title: "模型与隐私设置",
    description: "切换 Ascend 本地模型、公网服务或确定性演示回放。",
  },
};

export const App = () => {
  const [route, setRoute] = useState<AppRoute>(() => routeFromHash());

  useEffect(() => {
    const onHashChange = () => {
      setRoute(routeFromHash());
      window.scrollTo({ top: 0, behavior: "instant" });
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  if (route === "welcome") return <WelcomePage />;

  const meta = routeMeta[route];
  return (
    <AppShell route={route} title={meta.title} description={meta.description}>
      {route === "onboarding" && <OnboardingPage />}
      {route === "care" && <CarePage />}
      {route === "family" && <FamilyPage />}
      {route === "memories" && <MemoriesPage />}
      {route === "demo" && <DemoPage />}
      {route === "settings" && <SettingsPage />}
    </AppShell>
  );
};
