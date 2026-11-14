import {
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  ArrowDown,
  ArrowRight,
  AudioLines,
  BookHeart,
  BookOpenText,
  CalendarCheck,
  Check,
  ChevronDown,
  Download,
  Github,
  HeartHandshake,
  Lightbulb,
  Mic,
  Monitor,
  Phone,
  QrCode,
  ShieldCheck,
  Smartphone,
  Users,
} from "lucide-react";
import { hrefFor } from "../app/navigation";
import { useAuth } from "../auth/auth-context";
import { BrandMark } from "../components/BrandMark";
import { guideFaqs } from "./guide-content";
import "./WelcomePage.css";

const repositoryUrl = "https://github.com/SunJianBai/memory-lighthouse";
const androidDownloadUrl = `${repositoryUrl}/releases/latest/download/memory-lighthouse-android.apk`;
const features = [
  {
    id: "memories",
    title: "记忆档案",
    icon: BookHeart,
    description: "记录人物关系、生活偏好和重要信息，供陪伴时参考。",
    details: ["家属录入与维护", "按陪伴对象分别管理", "使用前需完成记忆授权"],
    note: "不是自动记住所有对话。",
  },
  {
    id: "companion",
    title: "AI 陪伴",
    icon: AudioLines,
    description: "在长者设备上进行实时语音交流，需要时可授权使用摄像头。",
    details: ["实时语音交流", "按需开启视频模式", "随时结束当前陪伴"],
    note: "需要设备联网、模型服务可用。",
  },
  {
    id: "routines",
    title: "日程与待办",
    icon: CalendarCheck,
    description: "设置日常提醒，查看确认记录，与其他家属分工处理待办。",
    details: ["单次或周期提醒", "暂停与恢复日程", "家属认领和处理待办"],
    note: "提醒需要保持陪伴会话运行。",
  },
  {
    id: "remote",
    title: "远程通话",
    icon: Phone,
    description: "呼叫陪伴设备，与长者直接交流，并在授权后查看设备画面。",
    details: ["家属发起呼叫", "陪伴端现场接听", "通话结束后断开连接"],
    note: "不是静默监控；通话不录音、不转写。",
  },
] as const;
const conversations = [
  {
    question: "我下午想出去走走。",
    answer: "可以去附近的公园，按您平时的习惯，饭后再出门。",
  },
  {
    question: "小陈周末会来吗？",
    answer: "档案里记着她常在周末来探望。这周的安排，可以请家属再确认一下。",
  },
];

function FeaturePreview() {
  const [selected, setSelected] = useState(0);
  const [completed, setCompleted] = useState(false);
  const [topic, setTopic] = useState(0);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const feature = features[selected];
  function moveTab(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    if (
      ![
        "ArrowRight",
        "ArrowLeft",
        "ArrowDown",
        "ArrowUp",
        "Home",
        "End",
      ].includes(event.key)
    )
      return;
    event.preventDefault();
    const next =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? features.length - 1
          : (index +
              (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) +
              features.length) %
            features.length;
    setSelected(next);
    tabRefs.current[next]?.focus();
  }
  return (
    <section
      className="landing-exhibit"
      id="features"
      aria-labelledby="feature-title"
    >
      <div className="landing-exhibit-heading">
        <h2 id="feature-title">功能预览</h2>
        <span>示例内容，不关联真实家庭</span>
      </div>
      <div className="landing-exhibit-body">
        <div className="landing-feature-index">
          <div
            className="landing-tabs"
            role="tablist"
            aria-label="选择预览功能"
            style={{ "--selected-tab": selected } as CSSProperties}
          >
            {features.map((item, index) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  id={`preview-tab-${item.id}`}
                  aria-controls="feature-preview-panel"
                  aria-selected={selected === index}
                  tabIndex={selected === index ? 0 : -1}
                  ref={(element) => {
                    tabRefs.current[index] = element;
                  }}
                  onClick={() => setSelected(index)}
                  onKeyDown={(event) => moveTab(event, index)}
                >
                  <Icon size={21} aria-hidden="true" />
                  <span>{item.title}</span>
                  <ArrowRight
                    className="landing-tab-arrow"
                    size={17}
                    aria-hidden="true"
                  />
                </button>
              );
            })}
          </div>
          <div className="landing-index-foot">
            <Lightbulb size={20} aria-hidden="true" />
            <span>
              家属管理
              <br />
              长者设备使用
            </span>
          </div>
        </div>
        <div
          className="landing-feature-panel"
          role="tabpanel"
          id="feature-preview-panel"
          aria-labelledby={`preview-tab-${feature.id}`}
          tabIndex={0}
        >
          <div className="landing-feature-layout" key={feature.id}>
            <div className="landing-example">
              {feature.id === "memories" && (
                <div className="landing-memory-example">
                  <div className="landing-record-heading">
                    <div className="landing-person" aria-hidden="true">
                      陈
                    </div>
                    <div>
                      <h3>陈阿姨的档案</h3>
                      <span>由家属维护 · 示例</span>
                    </div>
                    <BookHeart size={27} aria-hidden="true" />
                  </div>
                  <dl className="landing-memory-records">
                    <div>
                      <dt>生活偏好</dt>
                      <dd>
                        <strong>饭后去公园散步</strong>
                        <span>喜欢平坦的小路，通常走半小时。</span>
                      </dd>
                    </div>
                    <div>
                      <dt>人物关系</dt>
                      <dd>
                        <strong>小陈 · 女儿</strong>
                        <span>周末常来探望，喜欢一起做饭。</span>
                      </dd>
                    </div>
                    <div>
                      <dt>日常称呼</dt>
                      <dd>
                        <strong>陈阿姨</strong>
                        <span>陪伴时使用的称呼。</span>
                      </dd>
                    </div>
                  </dl>
                  <div className="landing-record-footer">
                    <ShieldCheck size={16} aria-hidden="true" />
                    授权后用于陪伴
                  </div>
                </div>
              )}
              {feature.id === "companion" && (
                <div className="landing-voice-example">
                  <div className="landing-example-top">
                    <h3>语音交流</h3>
                    <span>对话示意</span>
                  </div>
                  <div className="landing-voice-mark" aria-hidden="true">
                    <AudioLines size={54} strokeWidth={1.3} />
                  </div>
                  <div className="landing-transcript" key={topic}>
                    <p>
                      <span>长者</span>
                      {conversations[topic].question}
                    </p>
                    <p>
                      <span>陪伴助手</span>
                      {conversations[topic].answer}
                    </p>
                  </div>
                  <button
                    className="landing-text-action"
                    type="button"
                    onClick={() => setTopic((topic + 1) % conversations.length)}
                  >
                    换一段对话 <ArrowRight size={17} aria-hidden="true" />
                  </button>
                  <small>预设示例，未连接模型或麦克风。</small>
                </div>
              )}
              {feature.id === "routines" && (
                <div className="landing-routine-example">
                  <div className="landing-example-top">
                    <h3>今日安排</h3>
                    <span>日程示例</span>
                  </div>
                  <ol className="landing-schedule">
                    <li>
                      <time>08:30</time>
                      <div>
                        <strong>早餐后喝水</strong>
                        <span>每天 · 已确认</span>
                      </div>
                      <Check size={19} aria-label="已确认" />
                    </li>
                    <li>
                      <time>16:00</time>
                      <div>
                        <strong>去公园散步</strong>
                        <span>每周一、三、五</span>
                      </div>
                      <span
                        className="landing-schedule-dot"
                        aria-hidden="true"
                      />
                    </li>
                  </ol>
                  <div
                    className={`landing-demo-task${completed ? " is-complete" : ""}`}
                  >
                    <span>家庭待办 · 示例</span>
                    <strong>确认周末探望时间</strong>
                    <div>
                      <span role="status">
                        {completed ? "已完成（示例）" : "小陈负责 · 待处理"}
                      </span>
                      <button
                        type="button"
                        onClick={() => setCompleted(!completed)}
                      >
                        {completed ? "撤销完成" : "试着完成"}
                        <Check size={16} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {feature.id === "remote" && (
                <div className="landing-call-example">
                  <div className="landing-example-top">
                    <h3>家庭通话</h3>
                    <span>连接流程示意</span>
                  </div>
                  <div
                    className="landing-call-diagram"
                    aria-label="家属发起呼叫，陪伴设备现场接听后开始通话"
                  >
                    <div>
                      <Smartphone
                        size={38}
                        strokeWidth={1.4}
                        aria-hidden="true"
                      />
                      <strong>家属端</strong>
                      <span>发起呼叫</span>
                    </div>
                    <div className="landing-call-connector" aria-hidden="true">
                      <span />
                      <Phone size={23} />
                      <span />
                    </div>
                    <div>
                      <Monitor size={46} strokeWidth={1.4} aria-hidden="true" />
                      <strong>陪伴设备</strong>
                      <span>现场接听</span>
                    </div>
                  </div>
                  <p className="landing-call-consent">
                    <ShieldCheck size={19} aria-hidden="true" />
                    先授权，再接听
                  </p>
                  <p>查看画面还需开启远程视频授权。</p>
                </div>
              )}
            </div>
            <aside className="landing-feature-context">
              <h3>{feature.title}</h3>
              <p>{feature.description}</p>
              <ul>
                {feature.details.map((detail) => (
                  <li key={detail}>
                    <Check size={15} aria-hidden="true" />
                    {detail}
                  </li>
                ))}
              </ul>
              <a
                className="landing-inline-link"
                href={`${hrefFor("guide")}#guide-capabilities`}
              >
                查看操作说明 <ArrowRight size={17} aria-hidden="true" />
              </a>
              <p className="landing-context-note">{feature.note}</p>
            </aside>
          </div>
        </div>
      </div>
    </section>
  );
}

export const WelcomePage = () => {
  const auth = useAuth();
  const signedIn = auth.status === "authenticated";
  const restoring = auth.status === "bootstrapping";
  const primaryRoute = signedIn ? "workspace-overview" : "login";
  const primaryLabel = signedIn ? "进入家属工作区" : "登录家属工作区";
  return (
    <main id="main-content" className="landing-page" tabIndex={-1}>
      <header className="landing-header landing-width">
        <a
          href={hrefFor("home")}
          className="landing-brand"
          aria-label="守忆灯塔首页"
        >
          <BrandMark />
        </a>
        <nav aria-label="主页导航">
          <a className="landing-nav-feature" href="#features">
            产品功能
          </a>
          <a href={hrefFor("guide")}>使用指南</a>
          <a
            className="landing-github"
            href={repositoryUrl}
            target="_blank"
            rel="noreferrer"
            aria-label="在 GitHub 查看守忆灯塔开源项目"
          >
            <Github size={20} aria-hidden="true" />
            <span>开源项目</span>
          </a>
          <a className="landing-header-entry" href={hrefFor(primaryRoute)}>
            {signedIn ? "工作区" : "登录"}
            <ArrowRight size={16} aria-hidden="true" />
          </a>
        </nav>
      </header>
      <section
        className="landing-intro landing-width"
        aria-labelledby="welcome-title"
      >
        <div className="landing-title-group">
          <h1 id="welcome-title">守忆灯塔</h1>
          <p>长者陪伴与家庭照护</p>
        </div>
        <div className="landing-intro-copy">
          <p>
            在家属端整理记忆、安排日程，
            <br className="landing-desktop-break" />
            在长者设备上开启陪伴与远程通话。
          </p>
          <div className="landing-intro-actions">
            {restoring ? (
              <button
                className="primary-button"
                type="button"
                disabled
                aria-busy="true"
              >
                正在恢复登录状态
              </button>
            ) : (
              <a className="primary-button" href={hrefFor(primaryRoute)}>
                {primaryLabel}
                <ArrowRight size={19} aria-hidden="true" />
              </a>
            )}
            <a className="landing-inline-link" href="#getting-started">
              首次使用 <ArrowDown size={17} aria-hidden="true" />
            </a>
          </div>
        </div>
      </section>
      <div className="landing-width">
        <FeaturePreview />
      </div>
      <div className="landing-capability-strip landing-width">
        <span>
          <AudioLines size={19} aria-hidden="true" />
          MiniCPM-o 4.5 全双工全模态应用
        </span>
        <a href="#platforms">
          <Monitor size={17} aria-hidden="true" />
          Web
          <Smartphone size={17} aria-hidden="true" />
          Android
          <ArrowDown size={15} aria-hidden="true" />
        </a>
      </div>

      <section
        className="landing-setup landing-width"
        id="getting-started"
        aria-labelledby="setup-title"
      >
        <div className="landing-setup-copy">
          <h2 id="setup-title">首次使用</h2>
          <ol className="landing-steps">
            <li>
              <span>1</span>
              <div>
                <h3>注册账号与创建家庭</h3>
                <p>验证邮箱，创建家庭并添加陪伴对象。</p>
              </div>
            </li>
            <li>
              <span>2</span>
              <div>
                <h3>连接陪伴设备</h3>
                <p>扫描二维码，或输入动态激活码，由家属确认绑定。</p>
              </div>
            </li>
            <li>
              <span>3</span>
              <div>
                <h3>授权并开始陪伴</h3>
                <p>设置必要授权，在长者设备上点击“开始陪伴”。</p>
              </div>
            </li>
          </ol>
          <a
            className="landing-inline-link"
            href={`${hrefFor("guide")}#guide-start`}
          >
            查看图文指南 <ArrowRight size={18} aria-hidden="true" />
          </a>
        </div>
        <figure className="landing-binding">
          <div className="landing-binding-visual">
            <div className="landing-phone">
              <span className="landing-device-label">
                <Users size={15} aria-hidden="true" />
                家属端
              </span>
              <div className="landing-phone-screen">
                <h3>添加陪伴设备</h3>
                <QrCode size={64} strokeWidth={1.2} aria-hidden="true" />
                <span>扫码或输入激活码</span>
                <div
                  className="landing-code-placeholder"
                  aria-label="动态激活码示意"
                >
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                  <i />
                </div>
                <span className="landing-device-action">
                  确认绑定 <Check size={14} aria-hidden="true" />
                </span>
              </div>
            </div>
            <div className="landing-binding-arrow" aria-hidden="true">
              <ArrowRight size={26} />
            </div>
            <div className="landing-tablet">
              <span className="landing-device-label">
                <Monitor size={15} aria-hidden="true" />
                陪伴端
              </span>
              <div className="landing-tablet-screen">
                <Lightbulb size={36} strokeWidth={1.5} aria-hidden="true" />
                <h3>守忆灯塔</h3>
                <p>
                  选择要绑定的设备
                  <br />
                  等待家属确认
                </p>
                <span className="landing-device-action">
                  开始陪伴 <Mic size={14} aria-hidden="true" />
                </span>
              </div>
            </div>
          </div>
          <figcaption>
            <ShieldCheck size={17} aria-hidden="true" />
            <span>设备绑定示意 · 一台设备对应一位长者</span>
          </figcaption>
        </figure>
      </section>

      <section
        className="landing-platforms"
        id="platforms"
        aria-labelledby="platform-title"
      >
        <div className="landing-platforms-inner landing-width">
          <figure className="landing-home-scene">
            <img
              src={`${import.meta.env.BASE_URL}images/home-family-companion.webp`}
              width="1280"
              height="853"
              loading="lazy"
              decoding="async"
              alt="长者与家属坐在家中，一起设置桌面支架上的平板设备"
            />
            <figcaption>居家使用场景 · AI 生成示意图</figcaption>
          </figure>
          <div className="landing-platform-intro">
            <h2 id="platform-title">选择使用端</h2>
            <p>
              网页和原生 Android 应用，
              <br />
              均可使用家属或陪伴模式。
            </p>
            <a className="landing-download" href={androidDownloadUrl}>
              <Download size={21} aria-hidden="true" />
              <span>
                下载 Android 应用<small>APK 安装包 · GitHub Release</small>
              </span>
              <ArrowRight size={19} aria-hidden="true" />
            </a>
            <a
              className="landing-release-link"
              href={`${repositoryUrl}/releases`}
              target="_blank"
              rel="noreferrer"
            >
              查看版本记录
            </a>
          </div>
          <div className="landing-platform-entries">
            <a href={hrefFor(primaryRoute)}>
              <HeartHandshake size={30} strokeWidth={1.5} aria-hidden="true" />
              <div>
                <h3>家属工作区</h3>
                <p>管理家庭、档案、日程和陪伴设备。</p>
                <span>
                  进入工作区 <ArrowRight size={18} aria-hidden="true" />
                </span>
              </div>
            </a>
            <a href={hrefFor("companion")}>
              <Monitor size={30} strokeWidth={1.5} aria-hidden="true" />
              <div>
                <h3>陪伴设备模式</h3>
                <p>在长者设备上开启 AI 陪伴、接听家属来电。</p>
                <span>
                  进入陪伴端 <ArrowRight size={18} aria-hidden="true" />
                </span>
              </div>
            </a>
          </div>
        </div>
      </section>
      <section
        className="landing-faq landing-width"
        aria-labelledby="faq-title"
      >
        <div>
          <h2 id="faq-title">使用前了解</h2>
          <a
            className="landing-inline-link"
            href={`${hrefFor("guide")}#guide-faq`}
          >
            更多帮助 <ArrowRight size={17} aria-hidden="true" />
          </a>
        </div>
        <div className="landing-faq-items">
          {[guideFaqs[0], guideFaqs[4], guideFaqs[5]].map((faq) => (
            <details key={faq.question}>
              <summary>
                {faq.question}
                <ChevronDown size={19} aria-hidden="true" />
              </summary>
              <p>{faq.answer}</p>
            </details>
          ))}
        </div>
      </section>
      <footer className="landing-footer landing-width">
        <BrandMark compact />
        <p>开源项目 · 资料与支持</p>
        <nav aria-label="页脚导航">
          <a href={hrefFor("guide")}>
            <BookOpenText size={17} aria-hidden="true" />
            使用指南
          </a>
          <a href={repositoryUrl} target="_blank" rel="noreferrer">
            <Github size={17} aria-hidden="true" />
            GitHub
          </a>
          <a href={`${repositoryUrl}/issues`} target="_blank" rel="noreferrer">
            反馈问题 <ArrowRight size={15} aria-hidden="true" />
          </a>
        </nav>
      </footer>
    </main>
  );
};
