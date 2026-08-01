import {
  BellRing,
  Camera,
  Check,
  CircleStop,
  Glasses,
  Hand,
  HeartHandshake,
  MessageCircleMore,
  Mic,
  Play,
  RotateCcw,
  ScanEye,
  ShieldAlert,
  Sparkles,
  Volume2,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  createInitialAgentState,
  transitionAgent,
} from "../agent/agent-engine";
import {
  findDueRoutine,
  findNextRoutine,
  routineOccurrenceKey,
} from "../agent/routine-scheduler";
import type { Routine } from "../domain/types";
import { useOmniSession } from "../hooks/use-omni-session";
import { useAppState } from "../state/app-state";
import {
  formatClock,
  formatLongDate,
  formatMetric,
} from "../utils/format";

const phaseLabels = {
  idle: "等待开始",
  observing: "正在观察与倾听",
  reminding: "正在主动提醒",
  awaiting_confirmation: "等待本人确认",
  completed: "本次任务已闭环",
  needs_attention: "待家属查看",
};

type CareExperienceProps = {
  presenterMode?: boolean;
};

export const CareExperience = ({
  presenterMode = false,
}: CareExperienceProps) => {
  const { state, addEvent } = useAppState();
  const [agent, dispatch] = useReducer(
    transitionAgent,
    undefined,
    () => createInitialAgentState(),
  );
  const [clock, setClock] = useState(new Date());
  const [presenterCue, setPresenterCue] = useState(
    "先启动会话，再按顺序触发场景。",
  );
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastAutomaticRoutineRef = useRef("");
  const enabledRoutines = useMemo(
    () => state.routines.filter((routine) => routine.enabled),
    [state.routines],
  );
  const activeRoutine: Routine | undefined = useMemo(
    () =>
      presenterMode
        ? enabledRoutines[0]
        : findNextRoutine(enabledRoutines, clock),
    [clock, enabledRoutines, presenterMode],
  );
  const { session, start, stop, speakReplay } = useOmniSession(
    state,
    activeRoutine,
  );

  useEffect(() => {
    const timer = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!videoRef.current) return;
    videoRef.current.srcObject = session.videoStream;
  }, [session.videoStream]);

  const nextRoutine = activeRoutine ?? enabledRoutines[0];

  const record = (
    title: string,
    summary: string,
    type: Parameters<typeof addEvent>[0]["type"],
    severity: Parameters<typeof addEvent>[0]["severity"] = "info",
    status: Parameters<typeof addEvent>[0]["status"] = "resolved",
    source: Parameters<typeof addEvent>[0]["source"] = "demo",
  ) =>
    addEvent({
      type,
      severity,
      status,
      title,
      summary,
      occurredAt: new Date().toISOString(),
      routineId: nextRoutine?.id,
      source,
    });

  const beginSession = async () => {
    dispatch({ type: "SESSION_STARTED", at: new Date().toISOString() });
    record(
      "陪伴会话开始",
      `${session.providerLabel}准备接收语音与视频。`,
      "session_started",
    );
    await start();
  };

  const endSession = () => {
    stop("user_stop");
    dispatch({ type: "SESSION_ENDED", at: new Date().toISOString() });
    record(
      "陪伴会话结束",
      "摄像头、麦克风和语音播放均已关闭。",
      "session_ended",
    );
  };

  const sayIfReplay = (text: string) => {
    if (state.provider.provider === "replay") {
      speakReplay(text);
    }
  };

  const triggerRoutine = (routine: Routine | undefined = nextRoutine) => {
    if (!routine) return;
    const at = new Date().toISOString();
    dispatch({ type: "ROUTINE_DUE", routineId: routine.id, at });
    dispatch({ type: "REMINDER_DELIVERED", at });
    setPresenterCue(
      state.provider.provider === "replay"
        ? "提醒已由回放引擎发出。下一步请拿起标有“下午”的演示盒。"
        : "请保持安静并把“早 · 08:30”标签放入镜头，观察模型是否主动提醒。",
    );
    const text = `${state.recipient.preferredName}，现在是${routine.scheduledTime}，我们一起确认一下${routine.title}。${routine.instructions}`;
    sayIfReplay(text);
    record(
      `${routine.title}已提醒`,
      "系统根据家属录入的时间与标签发出提醒，等待本人确认。",
      "reminder_spoken",
      "info",
      "open",
      "agent",
    );
  };

  useEffect(() => {
    if (presenterMode || session.status !== "live" || agent.phase !== "observing") {
      return;
    }
    const due = findDueRoutine(enabledRoutines, clock);
    if (!due) return;
    const occurrenceKey = routineOccurrenceKey(due, clock);
    if (lastAutomaticRoutineRef.current === occurrenceKey) return;
    lastAutomaticRoutineRef.current = occurrenceKey;
    triggerRoutine(due);
  }, [agent.phase, clock, enabledRoutines, presenterMode, session.status]);

  const triggerWrongBox = () => {
    const text = "先等一下，我看到你拿的是标有“下午”的盒子。我还不能确认，请看看右边标有“早 · 08:30”的白色盒子。";
    setPresenterCue(
      state.provider.provider === "replay"
        ? "主动纠正已完成。现在请说“是右边这个吗？”，展示用户可打断。"
        : "请拿起“下午”标签盒并自然说话；此按钮只显示演员提示，不伪造模型输出。",
    );
    sayIfReplay(text);
    record(
      "标签与当前任务不一致",
      "画面中出现“下午”标签；系统未判断药物，只提示重新核对已录入标签。",
      "needs_confirmation",
      "attention",
      "open",
      "agent",
    );
  };

  const confirmRoutine = () => {
    dispatch({ type: "USER_CONFIRMED", at: new Date().toISOString() });
    const text = `好的，${state.recipient.preferredName}。我记录的是“本人已口头确认”，不是医学判断。今天这项任务完成了。`;
    sayIfReplay(text);
    setPresenterCue("长者端闭环完成。切换到家属端可查看带边界说明的事件摘要。");
    record(
      `${nextRoutine?.title ?? "晨间任务"}已确认`,
      "本人通过页面或语音明确确认完成；系统未判断具体药片和剂量。",
      "user_confirmed",
      "info",
      "resolved",
      "user",
    );
  };

  const repeatReminder = () => {
    const text = nextRoutine
      ? `好的，我慢一点再说一次。现在只需要先看看${nextRoutine.instructions}`
      : "好的，我会慢一点再说一次。";
    sayIfReplay(text);
    setPresenterCue("已按长者需求缩短并重复指令。");
  };

  const requestFamily = () => {
    dispatch({ type: "CONFIRMATION_TIMEOUT", at: new Date().toISOString() });
    const person = state.trustedPeople[0];
    sayIfReplay(
      `好的，我不会猜测。已经把这件事标记为待${person?.relationship ?? "家属"}查看。`,
    );
    setPresenterCue("事件已进入家属端“待确认”，不显示为紧急告警。");
    record(
      "晨间任务等待家属确认",
      "长者未明确确认，系统没有判定危险，已将事项加入家属待办。",
      "family_contacted",
      "important",
      "open",
      "agent",
    );
  };

  const findGlasses = () => {
    const memory = state.memories.find((item) => item.tags.includes("眼镜"));
    const text = memory
      ? `${state.recipient.preferredName}，家属记录里写着：${memory.content}我们先去那里看看，好吗？`
      : "我还没有眼镜位置的可靠记录，可以请家属补充。";
    sayIfReplay(text);
    setPresenterCue("已展示“上传记忆 → 对话中主动取用”的闭环。");
    record(
      "调用眼镜位置记忆",
      memory?.content ?? "未找到可靠的位置记忆。",
      "memory_used",
      "info",
      "resolved",
      "agent",
    );
  };

  const statusTone =
    agent.phase === "needs_attention"
      ? "attention"
      : agent.phase === "completed"
        ? "success"
        : session.status === "error"
          ? "danger"
          : "live";

  return (
    <div className={`care-experience ${presenterMode ? "presenter-layout" : ""}`}>
      <section className="care-stage" aria-label="长者陪伴界面">
        <div className="care-stage-header">
          <div>
            <span className="care-date">{formatLongDate(clock)}</span>
            <strong className="care-clock">{formatClock(clock)}</strong>
          </div>
          <span className={`agent-status tone-${statusTone}`}>
            <span className="status-dot" />
            {phaseLabels[agent.phase]}
          </span>
        </div>

        <div className="camera-stage">
          {session.videoStream ? (
            <video
              ref={videoRef}
              autoPlay
              muted
              playsInline
              aria-label="当前摄像头画面"
            />
          ) : (
            <div className="camera-placeholder">
              <ScanEye aria-hidden="true" size={44} />
              <strong>
                {session.cameraState === "error"
                  ? "摄像头不可用，语音陪伴仍可继续"
                  : "摄像头尚未开启"}
              </strong>
              <span>
                {session.cameraState === "error"
                  ? session.cameraMessage || "请检查设备或浏览器权限"
                  : "只有开始陪伴后才会申请权限"}
              </span>
            </div>
          )}
          <div className="camera-overlay top-left">
            <Camera aria-hidden="true" size={17} />
            {session.cameraState === "live"
              ? "画面已接入"
              : session.cameraState === "error"
                ? "画面不可用"
                : "本地预览关闭"}
          </div>
          <div className="camera-overlay top-right">
            <Mic aria-hidden="true" size={17} />
            {session.status === "live" ? "正在倾听" : "麦克风关闭"}
          </div>
          {session.signals.modelSpeaking && (
            <div className="speaking-wave" aria-label="助手正在说话">
              <span />
              <span />
              <span />
              <span />
              <Volume2 aria-hidden="true" size={19} />
            </div>
          )}
        </div>

        <div className="assistant-caption" aria-live="polite">
          <span className="caption-avatar">
            <Sparkles aria-hidden="true" size={21} />
          </span>
          <div>
            <small>守忆灯塔</small>
            <p>
              {session.assistantText ||
                (session.status === "live"
                  ? agent.message
                  : `${state.recipient.preferredName}，准备好后请点“开始陪伴”。`)}
            </p>
          </div>
        </div>

        {session.error && (
          <div className="inline-alert danger" role="alert">
            <ShieldAlert aria-hidden="true" size={20} />
            <div>
              <strong>真实模型连接失败</strong>
              <span>{session.error}。可以在设置中切回演示回放继续完整流程。</span>
            </div>
          </div>
        )}

        <div className="next-routine-card">
          <span className="routine-time">{nextRoutine?.scheduledTime ?? "—"}</span>
          <div>
            <small>当前日程</small>
            <strong>{nextRoutine?.title ?? "今天没有待办任务"}</strong>
            <p>{nextRoutine?.instructions}</p>
          </div>
          <BellRing aria-hidden="true" size={24} />
        </div>

        <div className="care-actions">
          {session.status !== "live" ? (
            <button
              className="primary-button care-main-action"
              type="button"
              onClick={() => void beginSession()}
            >
              <Play aria-hidden="true" size={24} />
              开始陪伴
            </button>
          ) : (
            <button
              className="danger-button care-main-action"
              type="button"
              onClick={endSession}
            >
              <CircleStop aria-hidden="true" size={24} />
              结束陪伴
            </button>
          )}
          <button
            className="care-action-button success"
            type="button"
            disabled={session.status !== "live"}
            onClick={confirmRoutine}
          >
            <Check aria-hidden="true" size={24} />
            我完成了
          </button>
          <button
            className="care-action-button"
            type="button"
            disabled={session.status !== "live"}
            onClick={repeatReminder}
          >
            <RotateCcw aria-hidden="true" size={23} />
            请再说一遍
          </button>
          <button
            className="care-action-button"
            type="button"
            disabled={session.status !== "live"}
            onClick={requestFamily}
          >
            <HeartHandshake aria-hidden="true" size={23} />
            联系家人
          </button>
        </div>

        <p className="care-boundary">
          守忆灯塔只复述家属录入的信息，不识别药片、剂量或诊断健康状况。
        </p>
      </section>

      {presenterMode && (
        <aside className="presenter-panel" aria-label="现场演示控制">
          <div className="presenter-panel-header">
            <span className="live-chip">
              <span className="status-dot" /> PRESENTATION
            </span>
            <h2>一镜到底演示控制</h2>
            <p>
              当前 Provider：<strong>{session.providerLabel}</strong>
            </p>
          </div>

          <div className="presenter-cue" aria-live="polite">
            <Hand aria-hidden="true" size={21} />
            <div>
              <small>下一步演员提示</small>
              <p>{presenterCue}</p>
            </div>
          </div>

          <div className="scenario-list">
            <button type="button" onClick={() => triggerRoutine()}>
              <span>01</span>
              <div>
                <strong>触发晨间日程</strong>
                <small>确定性规则主动提醒</small>
              </div>
              <BellRing aria-hidden="true" size={20} />
            </button>
            <button type="button" onClick={triggerWrongBox}>
              <span>02</span>
              <div>
                <strong>展示拿错标签盒</strong>
                <small>视觉理解与主动纠正</small>
              </div>
              <ScanEye aria-hidden="true" size={20} />
            </button>
            <button type="button" onClick={repeatReminder}>
              <span>03</span>
              <div>
                <strong>用户打断并追问</strong>
                <small>全双工、短句恢复</small>
              </div>
              <MessageCircleMore aria-hidden="true" size={20} />
            </button>
            <button type="button" onClick={findGlasses}>
              <span>04</span>
              <div>
                <strong>询问眼镜位置</strong>
                <small>调用家属上传的长期记忆</small>
              </div>
              <Glasses aria-hidden="true" size={20} />
            </button>
            <button type="button" onClick={requestFamily}>
              <span>05</span>
              <div>
                <strong>模拟未明确确认</strong>
                <small>进入家属协同，不制造告警</small>
              </div>
              <HeartHandshake aria-hidden="true" size={20} />
            </button>
          </div>

          <div className="runtime-metrics compact-grid">
            <div>
              <small>首字延迟</small>
              <strong>{formatMetric(session.metrics.firstTextMs)}</strong>
            </div>
            <div>
              <small>首音延迟</small>
              <strong>{formatMetric(session.metrics.firstAudioMs)}</strong>
            </div>
            <div>
              <small>视频帧</small>
              <strong>{session.metrics.visionFramesSent}</strong>
            </div>
            <div>
              <small>音频下溢</small>
              <strong>{session.metrics.underruns}</strong>
            </div>
          </div>

          <div className="presenter-note">
            <ShieldAlert aria-hidden="true" size={18} />
            <p>
              演示回放用于离线备用并明确标注；真实模型模式下，按钮只给演员提示，不伪造模型输出。
            </p>
          </div>
        </aside>
      )}
    </div>
  );
};
