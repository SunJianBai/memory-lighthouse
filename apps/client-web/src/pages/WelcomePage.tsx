import {
  ArrowRight,
  BellRing,
  Download,
  Github,
  HeartHandshake,
  BookOpenText,
  ShieldCheck,
} from "lucide-react";
import { hrefFor, navigate } from "../app/navigation";
import { useAuth } from "../auth/auth-context";
import { BrandMark } from "../components/BrandMark";

const roleCards = [
  {
    title: "家属工作区",
    description: "管理长者资料与陪伴安排。",
    route: "workspace-overview" as const,
    icon: HeartHandshake,
    tone: "green",
  },
  {
    title: "陪伴设备模式",
    description: "在长者设备上开始陪伴。",
    route: "companion" as const,
    icon: BellRing,
    tone: "blue",
  },
];

export const WelcomePage = () => {
  const auth = useAuth();
  const primaryRoute =
    auth.status === "authenticated" ? "workspace-overview" : "login";
  return (
    <main id="main-content" className="welcome-page" tabIndex={-1}>
      <header className="welcome-header">
        <BrandMark />
        <div className="welcome-header-actions">
          <a
            className="quiet-button"
            href={hrefFor("guide")}
          >
            <BookOpenText aria-hidden="true" size={19} />
            使用指南
          </a>
          <a
            className="github-source-link"
            href="https://github.com/SunJianBai/memory-lighthouse"
            target="_blank"
            rel="noreferrer"
            aria-label="在 GitHub 查看守忆灯塔开源项目"
          >
            <Github aria-hidden="true" size={20} />
            <span>开源项目</span>
          </a>
          <button
            className="quiet-button"
            type="button"
            onClick={() => navigate(primaryRoute)}
          >
            {auth.status === "authenticated" ? "进入家属工作区" : "登录 / 注册"}
          </button>
        </div>
      </header>

      <section className="welcome-hero" aria-labelledby="welcome-title">
        <div className="hero-copy">
          <h1 id="welcome-title">守忆灯塔</h1>
          <p>
            长者陪伴、记忆档案、日程提醒和家庭远程通话。
          </p>
          <p className="welcome-model-note">MiniCPM-o 4.5 全双工全模态应用</p>
          <div className="hero-actions">
            <button
              className="primary-button large"
              type="button"
              onClick={() => navigate(primaryRoute)}
            >
              {auth.status === "authenticated"
                ? "进入家属工作区"
                : "登录家属工作区"}
              <ArrowRight aria-hidden="true" size={20} />
            </button>
            <button
              className="secondary-button large"
              type="button"
              onClick={() => navigate("companion")}
            >
              <BellRing aria-hidden="true" size={20} />
              进入陪伴设备模式
            </button>
            <a
              className="secondary-button large"
              href="https://github.com/SunJianBai/memory-lighthouse/releases/latest/download/memory-lighthouse-android.apk"
              download
            >
              <Download aria-hidden="true" size={20} />
              下载 Android 应用
            </a>
          </div>
          <details className="trust-row">
            <summary>隐私与安全</summary>
            <span>
              <ShieldCheck aria-hidden="true" size={17} /> 权限可随时管理
            </span>
            <span>不识别药片与剂量</span>
            <span>不把沉默判定为危险</span>
          </details>
        </div>

        <aside className="welcome-start" aria-labelledby="welcome-start-title">
          <h2 id="welcome-start-title">首次使用</h2>
          <ol>
            <li><strong>创建家庭</strong><span>注册账号，验证邮箱并添加陪伴对象。</span></li>
            <li><strong>整理档案与日程</strong><span>补充生活偏好、家庭记忆和提醒安排。</span></li>
            <li><strong>连接陪伴设备</strong><span>通过二维码或激活码完成绑定。</span></li>
          </ol>
          <a className="guide-text-link" href={hrefFor("guide")}>查看使用指南 <ArrowRight size={18} aria-hidden="true" /></a>
        </aside>
      </section>

      <section className="role-section" aria-labelledby="role-title">
        <div className="section-heading">
          <h2 id="role-title">选择使用端</h2>
        </div>
        <div className="role-grid">
          {roleCards.map((card) => {
            const Icon = card.icon;
            return (
              <button
                key={card.route}
                className={`role-card tone-${card.tone}`}
                type="button"
                onClick={() => navigate(card.route)}
              >
                <span className="role-icon">
                  <Icon aria-hidden="true" size={26} />
                </span>
                <strong>{card.title}</strong>
                <p>{card.description}</p>
                <span className="role-link">
                  进入页面 <ArrowRight aria-hidden="true" size={18} />
                </span>
              </button>
            );
          })}
        </div>
      </section>
    </main>
  );
};
