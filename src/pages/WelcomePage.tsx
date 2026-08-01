import {
  ArrowRight,
  BellRing,
  BookHeart,
  HeartHandshake,
  MonitorPlay,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { navigate } from "../app/navigation";
import { BrandMark } from "../components/BrandMark";
import { useAppState } from "../state/app-state";

const roleCards = [
  {
    title: "我是长者",
    description: "开始语音和视频陪伴，查看今天的下一项任务。",
    route: "care" as const,
    icon: BellRing,
    tone: "blue",
  },
  {
    title: "我是家属",
    description: "查看任务状态、待确认事件和陪伴摘要。",
    route: "family" as const,
    icon: HeartHandshake,
    tone: "green",
  },
  {
    title: "我是演示者",
    description: "按照比赛脚本，一镜到底展示完整产品闭环。",
    route: "demo" as const,
    icon: MonitorPlay,
    tone: "amber",
  },
];

export const WelcomePage = () => {
  const { state } = useAppState();
  return (
    <main id="main-content" className="welcome-page">
      <header className="welcome-header">
        <BrandMark />
        <button
          className="quiet-button"
          type="button"
          onClick={() => navigate("settings")}
        >
          模型与隐私设置
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
            守忆灯塔面向轻度认知障碍长者，在家属明确授权的日常任务中持续看、持续听，
            通过自然语音陪伴、主动提醒和可解释记录，让每一次协助都有温度，也有边界。
          </p>
          <div className="hero-actions">
            <button
              className="primary-button large"
              type="button"
              onClick={() => navigate("demo")}
            >
              开始完整演示
              <ArrowRight aria-hidden="true" size={20} />
            </button>
            <button
              className="secondary-button large"
              type="button"
              onClick={() => navigate("onboarding")}
            >
              <BookHeart aria-hidden="true" size={20} />
              {state.initialized ? "编辑陪伴档案" : "建立陪伴档案"}
            </button>
          </div>
          <div className="trust-row" aria-label="产品安全原则">
            <span>
              <ShieldCheck aria-hidden="true" size={17} /> 默认本地保存
            </span>
            <span>不识别药片与剂量</span>
            <span>不把沉默判定为危险</span>
          </div>
        </div>

        <div className="lighthouse-visual" aria-label="守忆灯塔交互状态示意">
          <div className="visual-orbit orbit-one" />
          <div className="visual-orbit orbit-two" />
          <div className="beacon-card">
            <div className="beacon-pulse">
              <BellRing aria-hidden="true" size={36} />
            </div>
            <span>正在温和守候</span>
            <strong>{state.recipient.preferredName}，早上好</strong>
            <p>下一项：08:30 晨间任务</p>
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
          <h2 id="role-title">同一份记忆，三种清晰视角</h2>
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
