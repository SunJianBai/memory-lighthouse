import {
  BellRing,
  BookHeart,
  HeartHandshake,
  MonitorPlay,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { PropsWithChildren } from "react";
import type { AppRoute } from "../domain/types";
import { navigate } from "../app/navigation";
import { BrandMark } from "./BrandMark";

const navItems: Array<{
  route: AppRoute;
  label: string;
  icon: typeof BellRing;
}> = [
  { route: "care", label: "陪伴端", icon: BellRing },
  { route: "family", label: "家属端", icon: HeartHandshake },
  { route: "memories", label: "记忆中心", icon: BookHeart },
  { route: "demo", label: "演示台", icon: MonitorPlay },
  { route: "settings", label: "设置", icon: Settings },
];

type AppShellProps = PropsWithChildren<{
  route: AppRoute;
  title: string;
  description?: string;
}>;

export const AppShell = ({
  route,
  title,
  description,
  children,
}: AppShellProps) => (
  <div className="app-shell">
    <aside className="sidebar" aria-label="主要导航">
      <button
        className="brand-button"
        type="button"
        onClick={() => navigate("welcome")}
        aria-label="返回守忆灯塔首页"
      >
        <BrandMark />
      </button>
      <nav className="side-nav">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.route}
              className={`nav-item ${route === item.route ? "is-active" : ""}`}
              type="button"
              aria-current={route === item.route ? "page" : undefined}
              onClick={() => navigate(item.route)}
            >
              <Icon aria-hidden="true" size={21} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
      <div className="privacy-note">
        <ShieldCheck aria-hidden="true" size={20} />
        <div>
          <strong>本地优先</strong>
          <span>敏感记忆默认只存于此浏览器</span>
        </div>
      </div>
    </aside>
    <div className="app-column">
      <header className="topbar">
        <div>
          <p className="eyebrow">守忆灯塔 · 产品级演示</p>
          <h1>{title}</h1>
          {description && <p className="page-description">{description}</p>}
        </div>
        <span className="safety-badge">
          <ShieldCheck aria-hidden="true" size={18} />
          非医疗诊断工具
        </span>
      </header>
      <main id="main-content" className="page-content" tabIndex={-1}>
        {children}
      </main>
      <nav className="bottom-nav" aria-label="移动端导航">
        {navItems.slice(0, 5).map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.route}
              type="button"
              className={route === item.route ? "is-active" : ""}
              onClick={() => navigate(item.route)}
            >
              <Icon aria-hidden="true" size={20} />
              <span>{item.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  </div>
);
