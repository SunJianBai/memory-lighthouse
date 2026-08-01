import {
  BellRing,
  BookHeart,
  CalendarDays,
  ChevronDown,
  House,
  LogOut,
  Menu,
  MonitorSmartphone,
  PhoneCall,
  Settings,
  ShieldCheck,
} from "lucide-react";
import type { PropsWithChildren } from "react";
import { hrefFor, navigate, type ClientRoute } from "../app/navigation";
import { useAuth } from "../auth/auth-context";
import { useWorkspace } from "../workspace/workspace-context";
import { BrandMark } from "./BrandMark";

const familyNavigation: Array<{
  route: ClientRoute;
  label: string;
  shortLabel: string;
  icon: typeof House;
}> = [
  { route: "workspace-overview", label: "家庭概览", shortLabel: "概览", icon: House },
  { route: "workspace-memories", label: "记忆档案", shortLabel: "记忆", icon: BookHeart },
  { route: "workspace-routines", label: "日程与待办", shortLabel: "日程", icon: CalendarDays },
  { route: "workspace-devices", label: "陪伴设备", shortLabel: "设备", icon: MonitorSmartphone },
  { route: "workspace-remote", label: "远程通话", shortLabel: "通话", icon: PhoneCall },
  { route: "workspace-privacy", label: "隐私与授权", shortLabel: "隐私", icon: ShieldCheck },
  { route: "workspace-settings", label: "账号设置", shortLabel: "设置", icon: Settings },
];

type ProductShellProps = PropsWithChildren<{
  route: ClientRoute;
  title: string;
  description: string;
}>;

export const ProductShell = ({
  route,
  title,
  description,
  children,
}: ProductShellProps) => {
  const { user, logout } = useAuth();
  const workspace = useWorkspace();
  const email = user?.identities.find((identity) => identity.type === "EMAIL");

  return (
    <div className="product-shell">
      <aside className="product-sidebar" aria-label="家属工作区导航">
        <button
          className="brand-button product-brand"
          type="button"
          onClick={() => navigate("home")}
          aria-label="返回守忆灯塔首页"
        >
          <BrandMark />
        </button>
        <div className="workspace-switcher" aria-label="切换工作区">
          <button className="is-active" type="button" aria-current="page">
            <House aria-hidden="true" size={19} />
            家属工作区
          </button>
          <button type="button" onClick={() => navigate("companion")}>
            <BellRing aria-hidden="true" size={19} />
            陪伴设备模式
          </button>
        </div>
        <nav className="product-side-nav">
          {familyNavigation.map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.route}
                className={route === item.route ? "is-active" : ""}
                href={hrefFor(item.route)}
                aria-current={route === item.route ? "page" : undefined}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(item.route);
                }}
              >
                <Icon aria-hidden="true" size={20} />
                {item.label}
              </a>
            );
          })}
        </nav>
        <div className="authority-note">
          <ShieldCheck aria-hidden="true" size={19} />
          <p>页面切换不会改变权限，每次操作都由服务器重新鉴权。</p>
        </div>
      </aside>

      <div className="product-column">
        <header className="product-topbar">
          <div className="mobile-brand-row">
            <BrandMark />
            <button
              className="icon-button"
              type="button"
              onClick={() => navigate("workspace-settings")}
              aria-label="打开账号设置"
            >
              <Menu aria-hidden="true" size={22} />
            </button>
          </div>
          <div className="workspace-context-bar">
            <label>
              <span>家庭</span>
              <span className="select-wrap">
                <select
                  value={workspace.householdId}
                  onChange={(event) => workspace.selectHousehold(event.target.value)}
                  disabled={workspace.loading || workspace.households.length === 0}
                >
                  {workspace.households.length === 0 && <option value="">尚未创建家庭</option>}
                  {workspace.households.map((household) => (
                    <option key={household.id} value={household.id}>{household.name}</option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" size={17} />
              </span>
            </label>
            <label>
              <span>陪伴对象</span>
              <span className="select-wrap">
                <select
                  value={workspace.recipientId}
                  onChange={(event) => workspace.selectRecipient(event.target.value)}
                  disabled={workspace.loading || workspace.recipients.length === 0}
                >
                  {workspace.recipients.length === 0 && <option value="">尚未添加陪伴对象</option>}
                  {workspace.recipients.map((recipient) => (
                    <option key={recipient.id} value={recipient.id}>{recipient.preferredName}</option>
                  ))}
                </select>
                <ChevronDown aria-hidden="true" size={17} />
              </span>
            </label>
          </div>
          <div className="account-brief">
            <span className={email?.verifiedAt ? "verified" : "unverified"}>
              {email?.verifiedAt ? "邮箱已验证" : "邮箱待验证"}
            </span>
            <strong>{user?.displayName}</strong>
            <button
              className="icon-button"
              type="button"
              aria-label="退出登录"
              onClick={() => void logout()}
            >
              <LogOut aria-hidden="true" size={20} />
            </button>
          </div>
        </header>

        <main id="main-content" className="product-main" tabIndex={-1}>
          <header className="product-page-heading">
            <p className="eyebrow">家属工作区</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </header>
          {workspace.error && (
            <div className="inline-alert danger" role="alert">
              <span>{workspace.error}</span>
              <button type="button" onClick={() => void workspace.refresh()}>重试</button>
            </div>
          )}
          {children}
        </main>

        <nav className="product-bottom-nav" aria-label="移动端家属工作区导航">
          {familyNavigation.slice(0, 4).map((item) => {
            const Icon = item.icon;
            return (
              <a
                key={item.route}
                className={route === item.route ? "is-active" : ""}
                href={hrefFor(item.route)}
                onClick={(event) => {
                  event.preventDefault();
                  navigate(item.route);
                }}
              >
                <Icon aria-hidden="true" size={20} />
                <span>{item.shortLabel}</span>
              </a>
            );
          })}
          <details className="mobile-more-nav">
            <summary aria-label="更多导航">
              <Menu aria-hidden="true" size={20} />
              <span>更多</span>
            </summary>
            <div>
              {familyNavigation.slice(4).map((item) => {
                const Icon = item.icon;
                return (
                  <a
                    key={item.route}
                    href={hrefFor(item.route)}
                    onClick={(event) => {
                      event.preventDefault();
                      navigate(item.route);
                    }}
                  >
                    <Icon aria-hidden="true" size={19} /> {item.label}
                  </a>
                );
              })}
            </div>
          </details>
        </nav>
      </div>
    </div>
  );
};
