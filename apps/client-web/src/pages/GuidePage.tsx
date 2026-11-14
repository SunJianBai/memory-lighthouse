import { useEffect } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookHeart,
  CalendarCheck,
  Camera,
  CheckCircle2,
  ChevronDown,
  Download,
  HeartHandshake,
  Mic,
  MonitorSmartphone,
  PhoneCall,
  QrCode,
  ShieldCheck,
  Users,
} from "lucide-react";
import { hrefFor } from "../app/navigation";
import { BrandMark } from "../components/BrandMark";
import {
  guideCapabilities,
  guideFaqs,
  guideSections,
  quickStartSteps,
} from "./guide-content";

const capabilityIcons = {
  companion: Mic,
  memories: BookHeart,
  routines: CalendarCheck,
  family: Users,
  remote: PhoneCall,
  privacy: ShieldCheck,
};

export const GuidePage = () => {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = "使用指南 · 守忆灯塔";
    return () => {
      document.title = previousTitle;
    };
  }, []);

  return (
    <main id="main-content" className="guide-page" tabIndex={-1}>
      <header className="guide-header">
        <a
          className="brand-button"
          href={hrefFor("home")}
          aria-label="返回守忆灯塔首页"
        >
          <BrandMark />
        </a>
        <a className="quiet-button" href={hrefFor("home")}>
          <ArrowLeft aria-hidden="true" size={18} />
          返回首页
        </a>
      </header>

      <section className="guide-hero" aria-labelledby="guide-title">
        <div>

          <h1 id="guide-title">使用指南</h1>
          <p>了解设备配置、日常使用和主要功能。无需登录即可阅读。</p>
        </div>
        <span className="guide-platforms">
          <MonitorSmartphone aria-hidden="true" size={19} /> Web · Android
        </span>
      </section>
      <nav className="guide-anchor-nav" aria-label="指南目录">
        {guideSections.map((section, index) => (
          <a key={section.id} href={`#${section.id}`}>
            <span aria-hidden="true">0{index + 1}</span>
            {section.title}
          </a>
        ))}
      </nav>

      <section
        id="guide-start"
        className="guide-section"
        aria-labelledby="guide-start-title"
        tabIndex={-1}
      >
        <div className="guide-section-heading">
          <h2 id="guide-start-title">快速开始</h2>
          <p>首次使用建议由家属协助配置，准备家属端和一台陪伴设备。</p>
        </div>
        <ol className="guide-step-grid">
          {quickStartSteps.map((step, index) => (
            <li key={step.title}>
              <span className="guide-step-number" aria-hidden="true">
                0{index + 1}
              </span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
              <a className="guide-text-link" href={hrefFor(step.route)}>
                {step.action}
                <ArrowRight aria-hidden="true" size={16} />
              </a>
            </li>
          ))}
        </ol>
        <figure className="guide-activation-figure">
          <figcaption>
            <strong>设备绑定流程</strong>
            <span>操作示意 · 不含真实激活信息</span>
          </figcaption>
          <ol className="guide-activation-flow">
            <li>
              <div className="guide-flow-heading">
                <span>1</span>
                <strong>家属端生成</strong>
              </div>
              <div className="guide-activation-preview" aria-hidden="true">
                <QrCode size={52} />
                <div>
                  <span>公开编号</span>
                  <b>8 位动态码</b>
                </div>
              </div>
              <p>在“陪伴设备”生成二维码与动态码。</p>
            </li>
            <li>
              <div className="guide-flow-heading">
                <span>2</span>
                <strong>陪伴端提交</strong>
              </div>
              <div className="guide-activation-preview" aria-hidden="true">
                <MonitorSmartphone size={42} />
                <div>
                  <span>扫码，或填写</span>
                  <b>公开编号 + 动态码</b>
                </div>
              </div>
              <p>打开陪伴设备模式，扫码或填写公开编号与动态码后提交。</p>
            </li>
            <li>
              <div className="guide-flow-heading">
                <span>3</span>
                <strong>家属端批准</strong>
              </div>
              <div className="guide-activation-preview" aria-hidden="true">
                <ShieldCheck size={42} />
                <div>
                  <span>核对设备信息</span>
                  <b>确认并批准</b>
                </div>
              </div>
              <p>回到家属端批准，等待设备显示激活完成。</p>
            </li>
          </ol>
          <p className="guide-figure-note">
            提交激活码不等于已绑定，必须完成最后的家属确认。
          </p>
        </figure>
      </section>

      <section
        id="guide-roles"
        className="guide-section"
        aria-labelledby="guide-roles-title"
        tabIndex={-1}
      >
        <div className="guide-section-heading">
          <h2 id="guide-roles-title">使用端说明</h2>
          <p>
            Web 和 Android 均提供家属端与陪伴端入口。以下操作以 Web 端为例。
          </p>
        </div>
        <div className="guide-role-block">
          <div className="guide-role-copy">
            <span className="guide-icon">
              <HeartHandshake aria-hidden="true" size={25} />
            </span>
            <h3>家属端</h3>
            <p>管理资料与陪伴安排，查看需要跟进的事项。</p>
            <ul>
              <li>
                <CheckCircle2 aria-hidden="true" size={18} />
                先选择家庭和陪伴对象
              </li>
              <li>
                <CheckCircle2 aria-hidden="true" size={18} />
                录入记忆、添加日程、管理设备
              </li>
              <li>
                <CheckCircle2 aria-hidden="true" size={18} />
                发起通话或处理家庭待办
              </li>
            </ul>
            <a className="primary-button" href={hrefFor("workspace-overview")}>
              进入家属端
              <ArrowRight aria-hidden="true" size={18} />
            </a>
          </div>
          <figure className="guide-role-figure">
            <div
              className="guide-ui-figure family-figure"
              role="img"
              aria-label="家属端示意：顶部选择家庭与陪伴对象，再进入记忆档案、日程与待办、陪伴设备。"
            >
              <div className="figure-sidebar" aria-hidden="true">
                <span />
                <span />
                <span />
                <span />
              </div>
              <div className="figure-content" aria-hidden="true">
                <div className="figure-scope">
                  <span>家庭：示例家庭</span>
                  <span>陪伴对象：示例长者</span>
                </div>
                <div className="figure-title">家庭概览</div>
                <div className="figure-actions">
                  <span>
                    <BookHeart size={22} />
                    记忆档案
                  </span>
                  <span>
                    <CalendarCheck size={22} />
                    日程与待办
                  </span>
                  <span>
                    <MonitorSmartphone size={22} />
                    陪伴设备
                  </span>
                </div>
                <p className="figure-callout">
                  <span>1</span>核对顶部对象，再查看或修改资料
                </p>
              </div>
            </div>
            <figcaption>界面示意 · 示例数据，不展示真实家庭资料</figcaption>
          </figure>
        </div>
        <div className="guide-role-block reverse">
          <div className="guide-role-copy">
            <span className="guide-icon">
              <MonitorSmartphone aria-hidden="true" size={25} />
            </span>
            <h3>陪伴端</h3>
            <p>在长者设备上运行，进行 AI 陪伴和接听家属来电。</p>
            <ul>
              <li>
                <CheckCircle2 aria-hidden="true" size={18} />
                激活后点击“开始陪伴”
              </li>
              <li>
                <CheckCircle2 aria-hidden="true" size={18} />
                按提示允许麦克风等设备权限
              </li>
              <li>
                <CheckCircle2 aria-hidden="true" size={18} />
                保持页面运行，用完点击“结束陪伴”
              </li>
            </ul>
            <div className="guide-role-actions">
              <a className="primary-button" href={hrefFor("companion")}>
                进入陪伴端
                <ArrowRight aria-hidden="true" size={18} />
              </a>
              <a
                className="secondary-button"
                href="https://github.com/SunJianBai/memory-lighthouse/releases/latest/download/memory-lighthouse-android.apk"
                download
              >
                <Download aria-hidden="true" size={18} />
                下载 Android 应用
              </a>
            </div>
          </div>
          <figure className="guide-role-figure">
            <div
              className="guide-ui-figure companion-figure"
              role="img"
              aria-label="陪伴端示意：激活后点击开始陪伴，需要画面时还需授权摄像头。"
            >
              <div className="companion-camera" aria-hidden="true">
                <Camera size={28} />
                <span>授权后显示摄像头画面</span>
              </div>
              <div className="companion-status" aria-hidden="true">
                <CheckCircle2 size={16} />
                <span>设备已激活</span>
              </div>
              <div className="companion-control" aria-hidden="true">
                <Mic size={22} />
                <strong>开始陪伴</strong>
              </div>
            </div>
            <figcaption>界面示意 · 点击开始后才会申请会话设备权限</figcaption>
          </figure>
        </div>
      </section>

      <section
        id="guide-capabilities"
        className="guide-section"
        aria-labelledby="guide-capabilities-title"
        tabIndex={-1}
      >
        <div className="guide-section-heading">
          <h2 id="guide-capabilities-title">功能与操作</h2>
          <p>展开需要的功能，查看操作步骤。</p>
        </div>
        <div className="guide-capability-grid">
          {guideCapabilities.map((capability) => {
            const Icon = capabilityIcons[capability.id];
            return (
              <details className="guide-feature" key={capability.id}>
                <summary>
                  <span className="guide-icon">
                    <Icon aria-hidden="true" size={22} />
                  </span>
                  <span>
                    <strong>{capability.title}</strong>
                    <span className="guide-feature-description">
                      {capability.description}
                    </span>
                  </span>
                  <ChevronDown
                    className="guide-chevron"
                    aria-hidden="true"
                    size={18}
                  />
                </summary>
                <div className="guide-feature-body">
                  <ol>
                    {capability.steps.map((step) => (
                      <li key={step}>{step}</li>
                    ))}
                  </ol>
                  <p>{capability.note}</p>
                  <a
                    className="guide-text-link"
                    href={hrefFor(capability.route)}
                  >
                    {capability.action}
                    <ArrowRight aria-hidden="true" size={16} />
                  </a>
                </div>
              </details>
            );
          })}
        </div>
      </section>

      <section
        id="guide-faq"
        className="guide-section"
        aria-labelledby="guide-faq-title"
        tabIndex={-1}
      >
        <div className="guide-section-heading">
          <h2 id="guide-faq-title">常见问题</h2>
        </div>
        <div className="guide-faq-list">
          {guideFaqs.map((faq) => (
            <details key={faq.question}>
              <summary>
                {faq.question}
                <ChevronDown
                  className="guide-chevron"
                  aria-hidden="true"
                  size={18}
                />
              </summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>

      <aside
        className="guide-security-note"
        aria-labelledby="guide-security-title"
      >
        <ShieldCheck aria-hidden="true" size={26} />
        <div>
          <h2 id="guide-security-title">使用范围</h2>
          <p>用于日常陪伴与家庭协同，不提供医疗诊断，不替代紧急求助。</p>
        </div>
        <a className="guide-text-link" href={hrefFor("workspace-privacy")}>
          管理授权
          <ArrowRight aria-hidden="true" size={16} />
        </a>
      </aside>
      <footer className="guide-footer">
        <span>守忆灯塔 · 使用指南</span>
        <a className="guide-text-link" href="#main-content">
          返回顶部
        </a>
      </footer>
    </main>
  );
};
