import {
  ArrowRight,
  BellRing,
  Download,
  HeartHandshake,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { navigate } from "../app/navigation";
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
        <button
          className="quiet-button"
          type="button"
          onClick={() => navigate(primaryRoute)}
        >
          {auth.status === "authenticated" ? "进入家属工作区" : "登录 / 注册"}
        </button>
      </header>

      <section className="welcome-hero" aria-labelledby="welcome-title">
        <div className="hero-copy">
          <span className="hero-kicker">
            <Sparkles aria-hidden="true" size={18} />
            MiniCPM-o 4.5 全双工全模态应用
          </span>
          <h1 id="welcome-title">
            记得住生活细节，
            <span>也懂得何时轻声提醒。</span>
          </h1>
          <p>
            记录生活、按时提醒，让家人随时了解陪伴情况。
          </p>
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

        <div className="lighthouse-visual" aria-label="守忆灯塔交互状态示意">
          <div className="visual-orbit orbit-one" />
          <div className="visual-orbit orbit-two" />
          <div className="beacon-card">
            <div className="beacon-pulse">
              <BellRing aria-hidden="true" size={36} />
            </div>
            <span>正在温和守候</span>
            <strong>准备开始今天的陪伴</strong>
            <p>登录家属工作区，或激活陪伴设备</p>
          </div>
          <div className="floating-note note-top">
            <span className="status-dot green" />
            摄像头仅在会话中开启
          </div>
          <div className="floating-note note-bottom">
            <HeartHandshake aria-hidden="true" size={18} />
            家属可查看待确认事件
          </div>
        </div>
      </section>

      <section className="role-section" aria-labelledby="role-title">
        <div className="section-heading">
          <p className="eyebrow">选择体验入口</p>
          <h2 id="role-title">选择使用方式</h2>
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
