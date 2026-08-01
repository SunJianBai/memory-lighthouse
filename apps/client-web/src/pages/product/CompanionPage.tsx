import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  CircleStop,
  Keyboard,
  Mic,
  MonitorSmartphone,
  PhoneCall,
  PhoneOff,
  QrCode,
  ScanLine,
  ShieldCheck,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { readableError } from "../../api/api-client";
import type {
  CompanionSessionStartView,
  DeviceContextView,
  RemoteSessionView,
} from "../../api/types";
import { navigate } from "../../app/navigation";
import { useAuth } from "../../auth/auth-context";
import { BrandMark } from "../../components/BrandMark";
import { CareExperience } from "../../components/CareExperience";
import {
  deviceSession,
  parseQrActivation,
  type ActivationClaim,
} from "../../device/device-session";
import type { AppState, MemoryKind } from "../../domain/types";
import {
  BrowserRemoteSignalAdapter,
  LiveMediaConnection,
  type LiveMediaStatus,
} from "../../realtime/live-media";
import { useAppState } from "../../state/app-state";

type BarcodeResult = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeResult[]>;
};
type BarcodeDetectorConstructor = new (options: {
  formats: string[];
}) => BarcodeDetectorLike;

const knownMemoryKinds = new Set<MemoryKind>([
  "person",
  "medication",
  "routine",
  "preference",
  "place",
  "story",
]);
const memoryKind = (value: string): MemoryKind => {
  const normalized = value.toLowerCase() as MemoryKind;
  return knownMemoryKinds.has(normalized) ? normalized : "story";
};

const routineCategory = (value: string) => {
  if (value === "MEDICATION") return "medication" as const;
  if (value === "HYDRATION") return "hydration" as const;
  if (value === "APPOINTMENT") return "departure" as const;
  return "daily" as const;
};

const occurrenceClock = (scheduledAtUtc: string, timezone: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(scheduledAtUtc));

const runtimeStateFromContext = (
  base: AppState,
  context: DeviceContextView,
  snapshot?: CompanionSessionStartView["careSnapshot"],
): AppState => {
  const provider =
    context.model.provider.toLowerCase().includes("local") ||
    context.model.provider.toLowerCase().includes("ascend")
      ? "local"
      : "cloud";
  return {
    ...base,
    initialized: true,
    recipient: {
      id: context.recipientId,
      name: context.recipient.preferredName,
      preferredName: context.recipient.preferredName,
      birthday: "",
      homeLabel: "家庭陪伴设备",
      communicationNotes: "仅使用服务器本次返回的最小陪伴上下文。",
    },
    trustedPeople: [],
    medications: [],
    routines: (snapshot?.occurrences ?? []).map((occurrence) => ({
      id: occurrence.routineId,
      title: occurrence.routineTitle,
      category: routineCategory(occurrence.routineType),
      scheduledTime: occurrenceClock(
        occurrence.scheduledAtUtc,
        context.recipient.timezone,
      ),
      weekdays: [new Date(occurrence.scheduledAtUtc).getDay()],
      instructions: occurrence.instructions,
      confirmationQuestion:
        occurrence.confirmationQuestion || "完成后请明确告诉我，好吗？",
      graceMinutes: 5,
      familyNoticeMinutes: 15,
      enabled: ["DUE", "AWAITING_CONFIRMATION"].includes(occurrence.status),
      occurrenceId: occurrence.id,
      occurrenceVersion: occurrence.version,
      occurrenceStatus: occurrence.status,
      scheduledAtUtc: occurrence.scheduledAtUtc,
    })),
    memories: (snapshot?.memories ?? []).map((memory) => ({
      id: memory.id,
      kind: memoryKind(memory.kind),
      title: memory.title,
      content: memory.content,
      tags: [],
      sensitivity: memory.sensitivity === "HOUSEHOLD" ? "normal" : "sensitive",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    assets: [],
    events: [],
    consent: {
      localStorageApproved: false,
      cameraApproved: Boolean(context.consent.decisions.CAMERA_CAPTURE),
      microphoneApproved: Boolean(context.consent.decisions.MICROPHONE_CAPTURE),
      sensitiveMemoryApproved: Boolean(
        context.consent.decisions.MEMORY_STORAGE,
      ),
      cloudProcessingApproved: Boolean(
        context.consent.decisions.MODEL_PROCESSING,
      ),
      acceptedAt: context.consent.capturedAt,
    },
    provider: {
      ...base.provider,
      provider,
      localRealtimeWs: context.model.realtimeUrl,
      cloudRealtimeWs: context.model.realtimeUrl,
      model: context.model.model,
    },
  };
};

export const CompanionPage = () => {
  const { user } = useAuth();
  const { state: demoState } = useAppState();
  const [initializing, setInitializing] = useState(true);
  const [activated, setActivated] = useState(false);
  const [context, setContext] = useState<DeviceContextView | null>(null);
  const [runtimeState, setRuntimeState] = useState<AppState | null>(null);
  const [online, setOnline] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [publicId, setPublicId] = useState("");
  const [dynamicCode, setDynamicCode] = useState("");
  const [qrPayload, setQrPayload] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [challengeStatus, setChallengeStatus] = useState("");
  const [scanning, setScanning] = useState(false);
  const scannerVideo = useRef<HTMLVideoElement | null>(null);
  const scannerStream = useRef<MediaStream | null>(null);
  const activeCompanionId = useRef("");
  const exchangeStarted = useRef(false);
  const [incoming, setIncoming] = useState<RemoteSessionView | null>(null);
  const [callStatus, setCallStatus] = useState<LiveMediaStatus>("idle");
  const [callDetail, setCallDetail] = useState("");
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  const liveMedia = useRef(new LiveMediaConnection());

  const loadContext = useCallback(async () => {
    const next = await deviceSession.context();
    setContext(next);
    setRuntimeState(
      runtimeStateFromContext(demoState, next, next.careSnapshot),
    );
    setActivated(true);
    await deviceSession.heartbeat();
    setOnline(true);
  }, [demoState]);

  useEffect(() => {
    let cancelled = false;
    void deviceSession
      .initialize()
      .then(async () => {
        if (!deviceSession.hasCredential()) return;
        try {
          await loadContext();
        } catch (loadError) {
          if (!cancelled) setError(readableError(loadError));
        }
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, [loadContext]);

  useEffect(() => {
    if (!activated) return;
    const timer = window.setInterval(() => {
      void deviceSession
        .heartbeat()
        .then(() => setOnline(true))
        .catch(() => setOnline(false));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [activated]);

  useEffect(() => {
    if (!activated) return;
    const adapter = new BrowserRemoteSignalAdapter();
    const unsubscribe = adapter.subscribe(({ session }) => {
      if (session.bindingId === deviceSession.bindingId) setIncoming(session);
    });
    return () => {
      unsubscribe();
      adapter.close();
    };
  }, [activated]);

  useEffect(() => {
    if (!activated) return;
    let cancelled = false;
    const discover = async () => {
      try {
        const current = await deviceSession.currentRemote();
        if (cancelled) return;
        setOnline(true);
        setIncoming(current);
        if (!current && callStatus === "connected") {
          await liveMedia.current.disconnect();
          if (!cancelled) {
            setCallStatus("disconnected");
            setCallDetail("通话已由服务端结束");
          }
        }
      } catch (discoverError) {
        if (cancelled) return;
        setOnline(false);
        setCallDetail(`来电状态同步失败：${readableError(discoverError)}`);
      }
    };
    void discover();
    const timer = window.setInterval(() => void discover(), 2_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activated, callStatus]);

  const stopCompanionServerSession = useCallback(async (reason: string) => {
    const sessionId = activeCompanionId.current;
    activeCompanionId.current = "";
    if (sessionId) await deviceSession.endCompanion(sessionId, reason);
  }, []);

  useEffect(() => {
    if (incoming) {
      void stopCompanionServerSession("REMOTE_RINGING").catch((stopError) => {
        setError(readableError(stopError));
      });
    }
  }, [incoming?.id, stopCompanionServerSession]);

  useEffect(
    () => () => {
      scannerStream.current?.getTracks().forEach((track) => track.stop());
      void liveMedia.current.disconnect();
      void stopCompanionServerSession("PAGE_UNMOUNTED").catch(() => undefined);
    },
    [stopCompanionServerSession],
  );

  const coordinator = useMemo(
    () => ({
      start: async (mode: "AUDIO" | "AUDIO_VIDEO") => {
        const started = await deviceSession.startCompanion(mode);
        activeCompanionId.current = started.session.id;
        if (context)
          setRuntimeState(
            runtimeStateFromContext(demoState, context, started.careSnapshot),
          );
        try {
          const model = await deviceSession.startModel(started.session.id);
          let sequenceNo = 0;
          let firstResponseRecorded = false;
          const statusEvents = new Set<string>();
          const recordEvent = (
            eventType:
              | "CONNECTING"
              | "CONNECTED"
              | "QUEUED"
              | "FIRST_RESPONSE"
              | "PROVIDER_ERROR"
              | "DISCONNECTED",
            errorCode?: string,
          ) => {
            const dedupeKey = errorCode
              ? `${eventType}:${errorCode}`
              : eventType;
            if (statusEvents.has(dedupeKey)) return;
            statusEvents.add(dedupeKey);
            void deviceSession
              .appendModelEvent(model.session.id, eventType, errorCode)
              .catch((eventError) => setError(readableError(eventError)));
          };
          return {
            prompt: model.prompt.content,
            realtimeWs: model.connection.realtimeUrl,
            model: model.connection.model,
            onRuntimeStatus: (status: string) => {
              if (status === "connecting" || status === "initializing")
                recordEvent("CONNECTING");
              if (status === "queued") recordEvent("QUEUED");
              if (status === "live") recordEvent("CONNECTED");
              if (status === "closing" || status === "idle")
                recordEvent("DISCONNECTED");
            },
            onAssistantFinal: (text: string) => {
              if (!firstResponseRecorded) {
                firstResponseRecorded = true;
                recordEvent("FIRST_RESPONSE");
              }
              sequenceNo += 1;
              void deviceSession
                .appendAssistantUtterance(model.session.id, sequenceNo, text)
                .catch((utteranceError) =>
                  setError(readableError(utteranceError)),
                );
            },
            onUserTranscriptFinal: context?.consent.decisions
              .MODEL_INPUT_TRANSCRIPTION
              ? (text: string) => {
                  sequenceNo += 1;
                  void deviceSession
                    .appendUserTranscript(model.session.id, sequenceNo, text)
                    .catch((utteranceError) =>
                      setError(readableError(utteranceError)),
                    );
                }
              : undefined,
            onRuntimeError: (message: string) => {
              recordEvent("PROVIDER_ERROR", "WEB_RUNTIME_ERROR");
              recordEvent("DISCONNECTED");
              setError(message);
            },
          };
        } catch (modelError) {
          try {
            await stopCompanionServerSession("MODEL_START_FAILED");
          } catch {
            // Preserve the model-start error; session expiry remains the server fallback.
          }
          throw modelError;
        }
      },
      stop: stopCompanionServerSession,
      confirmOccurrence: async (
        occurrenceId: string,
        source: "RECIPIENT_BUTTON" | "RECIPIENT_VOICE",
      ) => {
        const current = await deviceSession.currentOccurrences();
        const occurrence = current.find((item) => item.id === occurrenceId);
        if (!occurrence) {
          throw new Error("本次日程已更新，请刷新后重试。");
        }
        await deviceSession.confirmOccurrence(
          occurrence.id,
          occurrence.version,
          source,
        );
      },
    }),
    [context, demoState, stopCompanionServerSession],
  );

  const claim = async (input: ActivationClaim) => {
    setBusy(true);
    setError("");
    setNotice("");
    exchangeStarted.current = false;
    try {
      const nextChallengeId = await deviceSession.claim(input);
      setChallengeId(nextChallengeId);
      setChallengeStatus("CLAIMED");
      setNotice("设备已完成 Claim。请回到家属端核对并批准此设备。 ");
      stopScanner();
    } catch (claimError) {
      setError(readableError(claimError));
    } finally {
      setBusy(false);
    }
  };

  const submitDynamicCode = (event: FormEvent) => {
    event.preventDefault();
    void claim({
      publicId: publicId.trim().toUpperCase(),
      proofType: "DYNAMIC_CODE",
      proof: dynamicCode,
    });
  };

  const submitQr = (event: FormEvent) => {
    event.preventDefault();
    try {
      void claim(parseQrActivation(qrPayload));
    } catch (parseError) {
      setError(readableError(parseError));
    }
  };

  useEffect(() => {
    if (!challengeId || activated) return;
    const check = async () => {
      try {
        const status = await deviceSession.status(challengeId);
        setChallengeStatus(status.status);
        if (
          status.status === "APPROVED" &&
          status.approvedAt &&
          !exchangeStarted.current
        ) {
          exchangeStarted.current = true;
          setNotice("家属已批准，正在兑换短时访问令牌与轮换设备凭据…");
          await deviceSession.exchange(challengeId, status.approvedAt);
          await loadContext();
          setNotice("设备激活完成，已开始发送在线心跳。 ");
        }
      } catch (statusError) {
        setError(readableError(statusError));
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2_000);
    return () => window.clearInterval(timer);
  }, [activated, challengeId, loadContext]);

  const stopScanner = () => {
    scannerStream.current?.getTracks().forEach((track) => track.stop());
    scannerStream.current = null;
    setScanning(false);
  };

  const startScanner = async () => {
    const Detector = (
      window as typeof window & { BarcodeDetector?: BarcodeDetectorConstructor }
    ).BarcodeDetector;
    if (!Detector) {
      setError(
        "当前浏览器不支持二维码识别，请粘贴二维码内容，或使用动态码激活",
      );
      return;
    }
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: false,
      });
      scannerStream.current = stream;
      setScanning(true);
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
      if (!scannerVideo.current) return;
      scannerVideo.current.srcObject = stream;
      await scannerVideo.current.play();
      const detector = new Detector({ formats: ["qr_code"] });
      const scan = async () => {
        if (!scannerStream.current || !scannerVideo.current) return;
        const results = await detector.detect(scannerVideo.current);
        const value = results[0]?.rawValue;
        if (value) {
          setQrPayload(value);
          stopScanner();
          await claim(parseQrActivation(value));
          return;
        }
        window.setTimeout(() => void scan(), 350);
      };
      void scan();
    } catch (scanError) {
      stopScanner();
      setError(readableError(scanError));
    }
  };

  const acceptCall = async () => {
    if (!incoming) return;
    setBusy(true);
    setError("");
    try {
      await stopCompanionServerSession("REMOTE_TAKEOVER");
      if (incoming.status === "RINGING") {
        const accepted = await deviceSession.acceptRemote(incoming.id);
        setIncoming(accepted);
      }
      const ticket = await deviceSession.remoteTicket(incoming.id);
      await liveMedia.current.connect(
        ticket,
        "DEVICE",
        { localVideo: localVideo.current, remoteAudio: remoteAudio.current },
        (status, detail) => {
          setCallStatus(status);
          setCallDetail(detail ?? "");
        },
      );
    } catch (acceptError) {
      setError(readableError(acceptError));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!incoming || callStatus !== "connected") return;
    const timer = window.setInterval(
      () =>
        void deviceSession
          .renewRemoteLease(incoming.id)
          .catch(() => setCallDetail("媒体租约续期失败，请结束通话后重试")),
      20_000,
    );
    return () => window.clearInterval(timer);
  }, [callStatus, incoming?.id]);

  const declineCall = async () => {
    if (!incoming) return;
    setBusy(true);
    try {
      await deviceSession.declineRemote(incoming.id);
      setIncoming(null);
      setCallStatus("idle");
    } catch (declineError) {
      setError(readableError(declineError));
    } finally {
      setBusy(false);
    }
  };

  const endCall = async () => {
    if (!incoming) return;
    setBusy(true);
    try {
      await liveMedia.current.disconnect();
      await deviceSession.endRemote(incoming.id);
      setIncoming(null);
      setCallStatus("idle");
    } catch (endError) {
      setError(readableError(endError));
    } finally {
      setBusy(false);
    }
  };

  if (initializing) {
    return (
      <main id="main-content" className="companion-loading" tabIndex={-1}>
        <BrandMark />
        <div className="resource-skeleton">
          <span />
          <span />
        </div>
        <p>正在读取陪伴设备安全存储…</p>
      </main>
    );
  }

  return (
    <main id="main-content" className="companion-page" tabIndex={-1}>
      <header className="companion-header">
        <button
          className="brand-button"
          type="button"
          onClick={() => navigate("home")}
          aria-label="返回首页"
        >
          <BrandMark />
        </button>
        <div className="workspace-switcher horizontal" aria-label="切换工作区">
          <button type="button" onClick={() => navigate("workspace-overview")}>
            <ArrowLeft aria-hidden="true" size={18} /> 家属工作区
          </button>
          <button className="is-active" type="button" aria-current="page">
            <MonitorSmartphone aria-hidden="true" size={18} /> 陪伴设备模式
          </button>
        </div>
        <div className="companion-account">
          <span>
            {online ? (
              <Wifi aria-hidden="true" size={18} />
            ) : (
              <WifiOff aria-hidden="true" size={18} />
            )}
            {online ? "在线" : "离线"}
          </span>
          <strong>{user?.displayName}</strong>
        </div>
      </header>

      {!activated ? (
        <section className="companion-activation-shell">
          <div className="companion-activation-copy">
            <span>
              <ShieldCheck aria-hidden="true" size={32} />
            </span>
            <p className="eyebrow">首次使用</p>
            <h1>把此浏览器激活为陪伴设备</h1>
            <p>
              此步骤会在浏览器安全存储中生成独立 Ed25519
              安装密钥。一台设备只绑定一位长者，换人需要重新激活。
            </p>
            <ol>
              <li>家属端为目标长者生成挑战</li>
              <li>本设备扫码或输入动态码完成 Claim</li>
              <li>家属核对设备后现场批准</li>
              <li>本设备证明私钥持有并兑换凭据</li>
            </ol>
          </div>
          <div className="activation-methods">
            <section className="panel-card">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">推荐</p>
                  <h2>扫描激活二维码</h2>
                </div>
                <QrCode aria-hidden="true" size={24} />
              </div>
              {scanning && (
                <div className="scanner-frame">
                  <video
                    ref={scannerVideo}
                    muted
                    playsInline
                    aria-label="二维码扫描摄像头预览"
                  />
                  <span>
                    <ScanLine aria-hidden="true" size={30} />
                  </span>
                </div>
              )}
              <button
                className="secondary-button full-width"
                type="button"
                disabled={busy}
                onClick={() => (scanning ? stopScanner() : void startScanner())}
              >
                <Camera aria-hidden="true" size={19} />{" "}
                {scanning ? "停止扫描" : "打开摄像头扫描"}
              </button>
              <form className="stack-form compact" onSubmit={submitQr}>
                <label htmlFor="qr-payload">或粘贴二维码内容</label>
                <textarea
                  id="qr-payload"
                  rows={2}
                  value={qrPayload}
                  onChange={(event) => setQrPayload(event.target.value)}
                  placeholder="memory-lighthouse://activate?..."
                />
                <button
                  className="text-button"
                  type="submit"
                  disabled={busy || !qrPayload}
                >
                  <Keyboard aria-hidden="true" size={17} /> 使用粘贴内容
                </button>
              </form>
            </section>
            <section className="panel-card">
              <div className="panel-heading">
                <div>
                  <p className="eyebrow">备用方式</p>
                  <h2>输入动态激活码</h2>
                </div>
                <Keyboard aria-hidden="true" size={24} />
              </div>
              <form className="stack-form" onSubmit={submitDynamicCode}>
                <label htmlFor="activation-public-id">公开编号</label>
                <input
                  id="activation-public-id"
                  required
                  value={publicId}
                  onChange={(event) => setPublicId(event.target.value)}
                  placeholder="ML-XXXXXX"
                  autoCapitalize="characters"
                />
                <label htmlFor="activation-code">8 位动态码</label>
                <input
                  id="activation-code"
                  required
                  minLength={8}
                  maxLength={8}
                  value={dynamicCode}
                  onChange={(event) => setDynamicCode(event.target.value)}
                  autoCapitalize="characters"
                />
                <button
                  className="primary-button full-width"
                  type="submit"
                  disabled={busy}
                >
                  {busy ? "正在证明设备身份…" : "提交并等待家属批准"}
                </button>
              </form>
            </section>
          </div>
          {challengeStatus && (
            <div className="inline-alert info" role="status">
              <CheckCircle2 aria-hidden="true" size={20} />
              <span>
                激活状态：{challengeStatus}。{notice}
              </span>
            </div>
          )}
          {error && (
            <div className="inline-alert danger" role="alert">
              <span>{error}</span>
            </div>
          )}
        </section>
      ) : incoming ? (
        <section className="incoming-call-screen">
          <div className="incoming-pulse">
            <PhoneCall aria-hidden="true" size={42} />
          </div>
          <p className="eyebrow">家庭成员来电</p>
          <h1>{context?.recipient.preferredName}，家人想和你说话</h1>
          <p>
            只有点击接听后，摄像头和麦克风才会用于这次实时通话。通话不会录音，也不会转写。
          </p>
          <div
            className={`device-call-media ${callStatus === "connected" ? "is-connected" : "is-pending"}`}
          >
            <video
              ref={localVideo}
              muted
              autoPlay
              playsInline
              aria-label="本机摄像头预览"
            />
            <audio ref={remoteAudio} autoPlay aria-label="家属实时音频" />
            {callStatus === "connected" ? (
              <>
                <span>
                  <Camera aria-hidden="true" size={18} /> 本机画面正在发送
                </span>
                <span>
                  <Mic aria-hidden="true" size={18} /> 双向音频已开启
                </span>
              </>
            ) : (
              <span className="span-full">
                <ShieldCheck aria-hidden="true" size={18} />{" "}
                尚未接听，摄像头和麦克风保持关闭
              </span>
            )}
          </div>
          {callDetail && (
            <div className="form-message success" role="status">
              {callDetail}
            </div>
          )}
          {error && (
            <div className="form-message error" role="alert">
              {error}
            </div>
          )}
          <div className="incoming-actions">
            {callStatus !== "connected" ? (
              <>
                <button
                  className="decline-call-button"
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void (incoming.status === "RINGING"
                      ? declineCall()
                      : endCall())
                  }
                >
                  {incoming.status === "RINGING" ? (
                    <PhoneOff aria-hidden="true" size={25} />
                  ) : (
                    <CircleStop aria-hidden="true" size={25} />
                  )}{" "}
                  {incoming.status === "RINGING" ? "拒绝" : "结束通话"}
                </button>
                <button
                  className="accept-call-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void acceptCall()}
                >
                  <PhoneCall aria-hidden="true" size={25} />{" "}
                  {busy
                    ? "正在连接…"
                    : incoming.status === "RINGING"
                      ? "接听"
                      : "加入通话"}
                </button>
              </>
            ) : (
              <button
                className="decline-call-button"
                type="button"
                disabled={busy}
                onClick={() => void endCall()}
              >
                <CircleStop aria-hidden="true" size={25} /> 结束通话
              </button>
            )}
          </div>
        </section>
      ) : (
        <section className="companion-runtime-shell">
          <div className="companion-runtime-status">
            <div>
              <span className="status-pill success">
                <Wifi aria-hidden="true" size={16} /> 设备已激活
              </span>
              <strong>{context?.recipient.preferredName}的陪伴设备</strong>
              <p>绑定编号末 6 位：{context?.bindingId.slice(-6)}</p>
            </div>
            <div className="inline-boundary">
              <PhoneCall aria-hidden="true" size={18} />{" "}
              来电状态由服务端设备会话接口持续同步，现场接听前不会打开摄像头或麦克风。
            </div>
          </div>
          {error && (
            <div className="inline-alert danger" role="alert">
              <span>{error}</span>
            </div>
          )}
          {runtimeState && (
            <CareExperience
              runtimeState={runtimeState}
              sessionCoordinator={coordinator}
              serverBackedMode
            />
          )}
        </section>
      )}
    </main>
  );
};
