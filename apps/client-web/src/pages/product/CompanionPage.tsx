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
import { flushSync } from "react-dom";
import { readableError } from "../../api/api-client";
import type {
  CompanionSessionStartView,
  DeviceContextView,
  RemoteSessionView,
} from "../../api/types";
import { navigate } from "../../app/navigation";
import { useAuth } from "../../auth/auth-context";
import { BrandMark } from "../../components/BrandMark";
import {
  CareExperience,
  type CareExperienceHandle,
} from "../../components/CareExperience";
import {
  deviceSession,
  parseQrActivation,
  type ActivationClaim,
} from "../../device/device-session";
import { ActivationExchangeGate } from "../../device/activation-exchange-gate";
import {
  ACTIVATION_TERMINAL_STATUSES,
  ActivationPollingRetryBudget,
  activationPollingRetryDelayMillis,
  activationTerminalMessage,
  isActivationRecoveryConflict,
  shouldPreserveActivationChallenge,
} from "../../device/activation-polling-policy";
import type { AppState, MemoryKind } from "../../domain/types";
import {
  BrowserRemoteSignalAdapter,
  LiveMediaConnection,
  type LiveMediaStatus,
} from "../../realtime/live-media";
import {
  CompanionStartCancelledError,
  CompanionStartLifecycle,
  isCompanionStartCancelledError,
  startCompanionResources,
} from "../../realtime/companion-start-lifecycle";
import {
  CompanionPollingGate,
  CompanionRemoteCommandGate,
  CompanionRemoteMediaCoordinator,
  CompanionRemoteSessionOwner,
} from "../../realtime/companion-polling-gate";
import {
  acceptRemoteWithAuthoritativeHandoff,
  guardActiveCompanionHeartbeat,
  guardCompanionWrite,
  shouldKeepCompanionActive,
  shouldStopForMediaDirective,
} from "../../realtime/remote-answer-handoff";
import { presentDeviceCall } from "../../realtime/device-call-presentation";
import { useAppState } from "../../state/app-state";
import {
  formatCompanionContextSummary,
  resolveCompanionSessionConfiguration,
} from "./companion-session-config";

type BarcodeResult = { rawValue?: string };
type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<BarcodeResult[]>;
};
type BarcodeDetectorConstructor = new (options: {
  formats: string[];
}) => BarcodeDetectorLike;

const PENDING_ACTIVATION_CHALLENGE_KEY =
  "memory-lighthouse.pending-activation-challenge.v1";
const ACTIVATION_RECOVERY_REQUIRED_KEY =
  "memory-lighthouse.activation-recovery-required.v1";
const readPendingActivationChallenge = (): string => {
  try {
    return globalThis.sessionStorage?.getItem(PENDING_ACTIVATION_CHALLENGE_KEY) ?? "";
  } catch {
    return "";
  }
};
const readActivationRecoveryRequired = (): boolean => {
  try {
    return globalThis.sessionStorage?.getItem(ACTIVATION_RECOVERY_REQUIRED_KEY) === "true";
  } catch {
    return false;
  }
};
const persistActivationRecoveryRequired = (required: boolean): void => {
  try {
    if (required) {
      globalThis.sessionStorage?.setItem(ACTIVATION_RECOVERY_REQUIRED_KEY, "true");
    } else {
      globalThis.sessionStorage?.removeItem(ACTIVATION_RECOVERY_REQUIRED_KEY);
    }
  } catch {
    // The challenge itself remains in session storage. This marker only blocks
    // accidental replacement after an ambiguous IndexedDB commit failure.
  }
};
const persistPendingActivationChallenge = (challengeId: string): void => {
  try {
    if (challengeId) {
      globalThis.sessionStorage?.setItem(PENDING_ACTIVATION_CHALLENGE_KEY, challengeId);
    } else {
      globalThis.sessionStorage?.removeItem(PENDING_ACTIVATION_CHALLENGE_KEY);
    }
  } catch {
    // Session storage is an availability aid only. The signed challenge and
    // non-exportable installation key remain the activation authorities.
  }
};

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
      communicationNotes: "请按照家属安排进行陪伴。",
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
  const { user, lockToDeviceMode } = useAuth();
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
  const [challengeId, setChallengeId] = useState(readPendingActivationChallenge);
  const [challengeStatus, setChallengeStatus] = useState("");
  const [scanning, setScanning] = useState(false);
  const scannerVideo = useRef<HTMLVideoElement | null>(null);
  const scannerStream = useRef<MediaStream | null>(null);
  const careExperience = useRef<CareExperienceHandle | null>(null);
  const activeCompanionId = useRef("");
  const companionStartLifecycle = useRef(new CompanionStartLifecycle());
  const endingCompanionSessions = useRef(new Map<string, Promise<void>>());
  const heartbeatPolling = useRef(new CompanionPollingGate());
  const remoteDiscoveryPolling = useRef(new CompanionPollingGate());
  const remoteSessionOwner = useRef(new CompanionRemoteSessionOwner());
  const remoteMedia = useRef(new CompanionRemoteMediaCoordinator());
  const remoteCommands = useRef(new CompanionRemoteCommandGate());
  const activationExchange = useRef(new ActivationExchangeGate());
  const activationRetryBudget = useRef(new ActivationPollingRetryBudget());
  const activationPollingEpoch = useRef(0);
  const activationRecoveryRequired = useRef(readActivationRecoveryRequired());
  const [incoming, setIncoming] = useState<RemoteSessionView | null>(null);
  const [callStatus, setCallStatus] = useState<LiveMediaStatus>("idle");
  const [callDetail, setCallDetail] = useState("");
  const [serverMediaStopped, setServerMediaStopped] = useState(false);
  const [effectiveConfiguration, setEffectiveConfiguration] = useState("");
  const localVideo = useRef<HTMLVideoElement | null>(null);
  const remoteAudio = useRef<HTMLAudioElement | null>(null);
  const liveMedia = useRef(new LiveMediaConnection());

  const stopLocalCompanionRuntime = useCallback(
    (commitStopped: () => void, reason: string) => {
      companionStartLifecycle.current.invalidate();
      heartbeatPolling.current.invalidate();
      try {
        careExperience.current?.stopLocalRuntime(reason);
      } finally {
        activeCompanionId.current = "";
        setEffectiveConfiguration("");
        flushSync(commitStopped);
      }
    },
    [],
  );

  const applyHeartbeat = useCallback(
    (heartbeat: Awaited<ReturnType<typeof deviceSession.heartbeat>>) => {
      setOnline(true);
      if (!shouldStopForMediaDirective(heartbeat.mediaDirective)) {
        setServerMediaStopped(false);
        return;
      }
      stopLocalCompanionRuntime(
        () => {
          setServerMediaStopped(true);
          setNotice(
            heartbeat.reason
              ? `陪伴媒体已由服务端停止：${heartbeat.reason}`
              : "陪伴媒体授权或会话已失效，摄像头、麦克风和模型连接已停止。",
          );
        },
        "server_media_stop",
      );
    },
    [stopLocalCompanionRuntime],
  );

  const sendHeartbeat = useCallback(async () => {
    const reportedSessionId = activeCompanionId.current || undefined;
    await heartbeatPolling.current.run(async (isPollingOwner) => {
      const isHeartbeatOwner = () =>
        isPollingOwner() &&
        (activeCompanionId.current || undefined) === reportedSessionId;
      const heartbeat = await guardActiveCompanionHeartbeat(
        deviceSession.heartbeat(reportedSessionId),
        reportedSessionId,
        (heartbeatError) => {
          stopLocalCompanionRuntime(
            () => {
              setOnline(false);
              setServerMediaStopped(true);
              setError(readableError(heartbeatError));
            },
            "device_heartbeat_failed",
          );
        },
        isHeartbeatOwner,
      );
      if (isHeartbeatOwner()) applyHeartbeat(heartbeat);
    });
  }, [applyHeartbeat, stopLocalCompanionRuntime]);

  const commitRemoteSession = useCallback(
    (session: RemoteSessionView | null, invalidateDiscovery = false) => {
      if (invalidateDiscovery) remoteDiscoveryPolling.current.invalidate();
      const previousVisibleSessionId =
        remoteSessionOwner.current.currentVisibleSessionId();
      const decision = remoteSessionOwner.current.observe(session);
      if (decision === "stale") return false;
      const visible = decision === "show" ? session : null;
      const nextSessionId = visible?.id ?? null;
      const previousMediaOwner = remoteMedia.current.currentSessionId();
      const release = remoteMedia.current.releaseExcept(nextSessionId, () =>
        liveMedia.current.disconnect(),
      );

      if (previousVisibleSessionId !== nextSessionId) {
        if (nextSessionId) {
          setCallStatus("idle");
          setCallDetail("");
        } else {
          setCallStatus(previousMediaOwner ? "disconnected" : "idle");
          setCallDetail(previousMediaOwner ? "通话已由服务端结束" : "");
        }
      }

      if (release.released) {
        void release.completion.catch((releaseError) => {
          if (
            remoteSessionOwner.current.currentVisibleSessionId() ===
              nextSessionId &&
            remoteMedia.current.currentSessionId() === null
          ) {
            setCallStatus("error");
            setCallDetail(`旧通话媒体释放失败：${readableError(releaseError)}`);
          }
        });
      }
      setIncoming(visible);
      return true;
    },
    [],
  );

  const failClosedCompanionWrite = useCallback(
    (writeError: unknown) => {
      const message = readableError(writeError);
      stopLocalCompanionRuntime(
        () => {
          setServerMediaStopped(true);
          setError(message);
        },
        "companion_write_rejected",
      );
    },
    [stopLocalCompanionRuntime],
  );

  const loadContext = useCallback(async () => {
    const next = await deviceSession.context();
    setContext(next);
    setRuntimeState(
      runtimeStateFromContext(demoState, next, next.careSnapshot),
    );
    setActivated(true);
    await sendHeartbeat();
  }, [demoState, sendHeartbeat]);

  useEffect(() => {
    let cancelled = false;
    void deviceSession
      .initialize()
      .then(async () => {
        if (!deviceSession.hasCredential()) return;
        try {
          await lockToDeviceMode();
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
  }, [loadContext, lockToDeviceMode]);

  useEffect(() => {
    if (!activated) return;
    const timer = window.setInterval(() => {
      void sendHeartbeat()
        .catch(() => setOnline(false));
    }, 5_000);
    return () => {
      heartbeatPolling.current.invalidate();
      window.clearInterval(timer);
    };
  }, [activated, sendHeartbeat]);

  useEffect(() => {
    if (!activated) return;
    const adapter = new BrowserRemoteSignalAdapter();
    const unsubscribe = adapter.subscribe(({ session }) => {
      if (session.bindingId === deviceSession.bindingId) {
        commitRemoteSession(session, true);
      }
    });
    return () => {
      unsubscribe();
      adapter.close();
    };
  }, [activated, commitRemoteSession]);

  useEffect(() => {
    if (!activated) return;
    let cancelled = false;
    const discover = async () => {
      try {
        await remoteDiscoveryPolling.current.run(async (isPollingOwner) => {
          const current = await deviceSession.currentRemote();
          if (cancelled || !isPollingOwner()) return;
          setOnline(true);
          commitRemoteSession(current);
        });
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
      remoteDiscoveryPolling.current.invalidate();
      window.clearInterval(timer);
    };
  }, [activated, commitRemoteSession]);

  const endCompanionServerSessionById = useCallback(
    (sessionId: string, reason: string): Promise<void> => {
      if (activeCompanionId.current === sessionId) {
        heartbeatPolling.current.invalidate();
        activeCompanionId.current = "";
      }
      const existing = endingCompanionSessions.current.get(sessionId);
      if (existing) return existing;

      const request = deviceSession
        .endCompanion(sessionId, reason)
        .then(() => undefined);
      endingCompanionSessions.current.set(sessionId, request);
      void request.catch(() => {
        if (endingCompanionSessions.current.get(sessionId) === request) {
          endingCompanionSessions.current.delete(sessionId);
        }
      });
      return request;
    },
    [],
  );

  const stopCompanionServerSession = useCallback(
    async (reason: string) => {
      companionStartLifecycle.current.invalidate();
      const sessionId = activeCompanionId.current;
      if (sessionId) await endCompanionServerSessionById(sessionId, reason);
    },
    [endCompanionServerSessionById],
  );

  useEffect(() => {
    companionStartLifecycle.current.mount();
    remoteCommands.current.mount();
    return () => {
      companionStartLifecycle.current.unmount();
      heartbeatPolling.current.invalidate();
      remoteDiscoveryPolling.current.invalidate();
      remoteCommands.current.close();
      remoteSessionOwner.current.invalidate();
      scannerStream.current?.getTracks().forEach((track) => track.stop());
      const release = remoteMedia.current.releaseAll(() =>
        liveMedia.current.disconnect(),
      );
      void release.completion.catch(() => undefined);
      void stopCompanionServerSession("PAGE_UNMOUNTED").catch(() => undefined);
    };
  }, [stopCompanionServerSession]);

  const coordinator = useMemo(
    () => ({
      start: async (mode: "AUDIO" | "AUDIO_VIDEO") => {
        try {
          const { started, model, generation } = await startCompanionResources({
            lifecycle: companionStartLifecycle.current,
            startCompanion: () =>
              heartbeatPolling.current.pauseWhile(() =>
                deviceSession.startCompanion(mode),
              ),
            startModel: (sessionId) => deviceSession.startModel(sessionId),
            endCompanion: endCompanionServerSessionById,
            onSessionAvailable: (sessionId) => {
              heartbeatPolling.current.invalidate();
              activeCompanionId.current = sessionId;
            },
          });
          const staleReason =
            companionStartLifecycle.current.staleReason(generation);
          if (staleReason) {
            try {
              await endCompanionServerSessionById(
                started.session.id,
                staleReason,
              );
            } catch {
              // Server expiry remains the fallback for a cancelled start.
            }
            throw new CompanionStartCancelledError(staleReason);
          }
          if (context)
            setRuntimeState(
              runtimeStateFromContext(demoState, context, started.careSnapshot),
            );
          const configuration = resolveCompanionSessionConfiguration(model);
          setEffectiveConfiguration(configuration.summary);
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
            void guardCompanionWrite(
              deviceSession.appendModelEvent(
                model.session.id,
                eventType,
                errorCode,
              ),
              failClosedCompanionWrite,
            );
          };
          return {
            ...configuration.runtime,
            onRuntimeStatus: (status: string) => {
              if (status === "connecting" || status === "initializing")
                recordEvent("CONNECTING");
              if (status === "queued") recordEvent("QUEUED");
              if (status === "live") recordEvent("CONNECTED");
              if (status === "closing" || status === "idle")
                recordEvent("DISCONNECTED");
              if (status === "closing" || status === "idle")
                setEffectiveConfiguration("");
            },
            onAssistantFinal: (text: string) => {
              if (!firstResponseRecorded) {
                firstResponseRecorded = true;
                recordEvent("FIRST_RESPONSE");
              }
              sequenceNo += 1;
              void guardCompanionWrite(
                deviceSession.appendAssistantUtterance(
                  model.session.id,
                  sequenceNo,
                  text,
                ),
                failClosedCompanionWrite,
              );
            },
            onUserTranscriptFinal: context?.consent.decisions
              .MODEL_INPUT_TRANSCRIPTION
              ? (text: string) => {
                  sequenceNo += 1;
                  void guardCompanionWrite(
                    deviceSession.appendUserTranscript(
                      model.session.id,
                      sequenceNo,
                      text,
                    ),
                    failClosedCompanionWrite,
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
          if (!isCompanionStartCancelledError(modelError)) {
            setEffectiveConfiguration("");
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
      requestFamily: async (
        source: "RECIPIENT_BUTTON" | "RECIPIENT_VOICE" | "COMPANION_TIMEOUT",
        occurrenceId?: string,
      ) => {
        await deviceSession.requestFamilyContact(source, occurrenceId);
      },
    }),
    [
      context,
      demoState,
      endCompanionServerSessionById,
      failClosedCompanionWrite,
      stopCompanionServerSession,
    ],
  );

  const claim = async (input: ActivationClaim) => {
    if (activationRecoveryRequired.current) {
      setError("正在恢复设备，请稍候。");
      return;
    }
    setBusy(true);
    setError("");
    setNotice("");
    if (!activationExchange.current.reset()) {
      setBusy(false);
      setError("正在完成设备激活，请稍候。");
      return;
    }
    activationPollingEpoch.current += 1;
    const claimEpoch = activationPollingEpoch.current;
    activationRetryBudget.current.reset();
    try {
      const nextChallengeId = await deviceSession.claim(input);
      if (activationPollingEpoch.current !== claimEpoch) return;
      setChallengeId(nextChallengeId);
      persistPendingActivationChallenge(nextChallengeId);
      setChallengeStatus("CLAIMED");
      setNotice("设备已连接，请回到家属端核对并确认。 ");
      stopScanner();
    } catch (claimError) {
      if (activationPollingEpoch.current === claimEpoch) {
        setError(readableError(claimError));
      }
    } finally {
      if (activationPollingEpoch.current === claimEpoch) setBusy(false);
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
    const epoch = activationPollingEpoch.current;
    let checking = false;
    let retryAfter = 0;
    let stopped = false;
    const isStale = () => stopped || activationPollingEpoch.current !== epoch;
    const check = async () => {
      if (isStale() || checking || Date.now() < retryAfter) return;
      checking = true;
      try {
        if (deviceSession.hasCredential()) {
          await lockToDeviceMode();
          await loadContext();
          if (activationPollingEpoch.current !== epoch) return;
          stopped = true;
          persistPendingActivationChallenge("");
          activationRecoveryRequired.current = false;
          persistActivationRecoveryRequired(false);
          setChallengeId("");
          return;
        }
        const status = await deviceSession.status(challengeId);
        if (isStale()) return;
        setChallengeStatus(status.status);
        if (ACTIVATION_TERMINAL_STATUSES.has(status.status)) {
          stopped = true;
          persistPendingActivationChallenge("");
          activationRecoveryRequired.current = false;
          persistActivationRecoveryRequired(false);
          activationExchange.current.reset();
          activationRetryBudget.current.reset();
          setChallengeId("");
          setNotice("");
          setError(activationTerminalMessage(status.status));
          return;
        }
        if (
          ["APPROVED", "CONSUMED"].includes(status.status) &&
          status.approvedAt
        ) {
          await activationExchange.current.run(async () => {
            setNotice("家属已确认，正在完成激活…");
            await lockToDeviceMode();
            if (!deviceSession.hasCredential()) {
              if (status.status === "CONSUMED" && !status.recoveryToken) {
                throw new Error("设备恢复失败，请稍后重试");
              }
              await deviceSession.exchange(
                challengeId,
                status.approvedAt!,
                status.recoveryToken ?? undefined,
              );
            }
            await loadContext();
            if (activationPollingEpoch.current !== epoch) return;
            stopped = true;
            persistPendingActivationChallenge("");
            activationRecoveryRequired.current = false;
            persistActivationRecoveryRequired(false);
            activationRetryBudget.current.reset();
            setChallengeId("");
            setNotice("设备激活完成，已开始发送在线心跳。 ");
          });
        }
      } catch (statusError) {
        if (isStale()) return;
        if (shouldPreserveActivationChallenge(statusError)) {
          stopped = true;
          activationRecoveryRequired.current = true;
          persistActivationRecoveryRequired(true);
          setNotice("设备恢复尚未完成，请刷新后继续。 ");
          setError(readableError(statusError));
          return;
        }
        if (!activationRetryBudget.current.shouldRetry(statusError)) {
          stopped = true;
          persistPendingActivationChallenge("");
          activationRecoveryRequired.current = false;
          persistActivationRecoveryRequired(false);
          activationExchange.current.reset();
          setChallengeId("");
          setNotice("");
          setError(
            isActivationRecoveryConflict(statusError)
              ? "设备恢复失败，请重新扫描二维码或输入新的动态激活码"
              : readableError(statusError),
          );
          return;
        }
        retryAfter = Date.now() + activationPollingRetryDelayMillis(statusError);
        setError(readableError(statusError));
      } finally {
        checking = false;
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2_000);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
  }, [activated, challengeId, loadContext, lockToDeviceMode]);

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
    const command = remoteCommands.current.begin();
    if (!command) return;
    const target = incoming;
    const ownsTarget = () =>
      command.isCurrent() &&
      remoteSessionOwner.current.isVisible(target.id);
    setBusy(true);
    setError("");
    let onsiteAccepted = false;
    try {
      remoteDiscoveryPolling.current.invalidate();
      await remoteDiscoveryPolling.current.pauseWhile(async () => {
        if (
          !ownsTarget() ||
          remoteMedia.current.currentSessionId() === target.id
        ) {
          return;
        }
        await acceptRemoteWithAuthoritativeHandoff({
          session: target,
          accept: (sessionId) => deviceSession.acceptRemote(sessionId),
          stopLocalCompanion: async (authoritative) => {
            if (!ownsTarget() || !commitRemoteSession(authoritative)) {
              throw new Error("来电状态已更新，请重新接听");
            }
            onsiteAccepted = true;
            // Commit the authoritative state synchronously so CareExperience is
            // unmounted and releases camera/microphone before LiveKit starts.
            stopLocalCompanionRuntime(
              () => commitRemoteSession(authoritative),
              "remote_assistance_accepted",
            );
          },
          joinMedia: async (authoritative) => {
            if (!ownsTarget()) {
              throw new Error("来电状态已更新，请重新接听");
            }
            const ticket = await deviceSession.remoteTicket(authoritative.id);
            if (!ownsTarget()) {
              throw new Error("来电状态已更新，请重新接听");
            }
            await remoteMedia.current.connect<LiveMediaStatus>(
              authoritative.id,
              ownsTarget,
              (publish) =>
                liveMedia.current.connect(
                  ticket,
                  "DEVICE",
                  {
                    localVideo: localVideo.current,
                    remoteAudio: remoteAudio.current,
                  },
                  publish,
                ),
              (status, detail) => {
                setCallStatus(status);
                setCallDetail(detail ?? "");
              },
              () => liveMedia.current.disconnect(),
            );
          },
        });
      });
    } catch (acceptError) {
      if (!ownsTarget()) return;
      const message = readableError(acceptError);
      if (onsiteAccepted) {
        setCallStatus("error");
        setCallDetail(message);
      }
      setError(message);
    } finally {
      const shouldClearBusy = command.isCurrent();
      command.finish();
      if (shouldClearBusy) setBusy(false);
    }
  };

  useEffect(() => {
    if (
      !incoming ||
      callStatus !== "connected" ||
      remoteMedia.current.currentSessionId() !== incoming.id
    ) {
      return;
    }
    const sessionId = incoming.id;
    const timer = window.setInterval(
      () =>
        void deviceSession
          .renewRemoteLease(sessionId)
          .catch(() => {
            if (
              remoteMedia.current.currentSessionId() === sessionId &&
              remoteSessionOwner.current.isVisible(sessionId)
            ) {
              setCallDetail("媒体租约续期失败，请结束通话后重试");
            }
          }),
      20_000,
    );
    return () => window.clearInterval(timer);
  }, [callStatus, incoming?.id]);

  const declineCall = async () => {
    if (!incoming) return;
    const command = remoteCommands.current.begin();
    if (!command) return;
    const target = incoming;
    const ownsTarget = () =>
      command.isCurrent() &&
      remoteSessionOwner.current.isVisible(target.id);
    setBusy(true);
    try {
      remoteDiscoveryPolling.current.invalidate();
      await remoteDiscoveryPolling.current.pauseWhile(async () => {
        if (!ownsTarget()) return;
        const authoritative = await deviceSession.declineRemote(target.id);
        if (!ownsTarget()) return;
        commitRemoteSession(authoritative);
      });
    } catch (declineError) {
      if (ownsTarget()) {
        setError(readableError(declineError));
      }
    } finally {
      const shouldClearBusy = command.isCurrent();
      command.finish();
      if (shouldClearBusy) setBusy(false);
    }
  };

  const endCall = async () => {
    if (!incoming) return;
    const command = remoteCommands.current.begin();
    if (!command) return;
    const target = incoming;
    const ownsTarget = () =>
      command.isCurrent() &&
      remoteSessionOwner.current.isVisible(target.id);
    setBusy(true);
    try {
      remoteDiscoveryPolling.current.invalidate();
      await remoteDiscoveryPolling.current.pauseWhile(async () => {
        if (!ownsTarget()) return;
        const release = remoteMedia.current.release(target.id, () =>
          liveMedia.current.disconnect(),
        );
        if (release.released) {
          setCallStatus("disconnected");
          setCallDetail("正在结束通话…");
        }
        let releaseError: unknown;
        try {
          await release.completion;
        } catch (disconnectError) {
          releaseError = disconnectError;
        }
        const authoritative = await deviceSession.endRemote(target.id);
        if (!ownsTarget()) return;
        const committed = commitRemoteSession(authoritative);
        if (
          releaseError &&
          committed &&
          !remoteSessionOwner.current.isVisible(target.id)
        ) {
          setCallStatus("error");
          setCallDetail(`本地媒体释放失败：${readableError(releaseError)}`);
        }
      });
    } catch (endError) {
      if (ownsTarget()) {
        setError(readableError(endError));
      }
    } finally {
      const shouldClearBusy = command.isCurrent();
      command.finish();
      if (shouldClearBusy) setBusy(false);
    }
  };

  const companionRuntimePanel = (
    <section className="companion-runtime-shell">
      <div className="companion-runtime-status">
        <div>
          <span className="status-pill success">
            <Wifi aria-hidden="true" size={16} /> 设备已激活
          </span>
          <strong>{context?.recipient.preferredName}的陪伴设备</strong>
          <p>绑定编号末 6 位：{context?.bindingId.slice(-6)}</p>
          <p>
            {effectiveConfiguration ||
              formatCompanionContextSummary(
                runtimeState?.memories.length ?? 0,
                runtimeState?.routines.length ?? 0,
              )}
          </p>
        </div>
        <div className="inline-boundary">
          <PhoneCall aria-hidden="true" size={18} /> 等待家人来电
        </div>
      </div>
      {error && (
        <div className="inline-alert danger" role="alert">
          <span>{error}</span>
        </div>
      )}
      {runtimeState && (
        <CareExperience
          ref={careExperience}
          runtimeState={runtimeState}
          sessionCoordinator={coordinator}
          serverBackedMode
        />
      )}
    </section>
  );

  const callPresentation = incoming
    ? presentDeviceCall(incoming.status, callStatus)
    : null;

  if (initializing) {
    return (
      <main id="main-content" className="companion-loading" tabIndex={-1}>
        <BrandMark />
        <div className="resource-skeleton">
          <span />
          <span />
        </div>
        <p>正在加载陪伴设备…</p>
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
            <ArrowLeft aria-hidden="true" size={18} /> {activated ? "退出设备模式并重新登录" : "家属工作区"}
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
          <strong>{activated ? "设备身份" : user?.displayName || "等待激活"}</strong>
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
            <p>扫描家属端二维码以激活此设备。</p>
            <ol>
              <li>扫码或输入动态码</li>
              <li>家属核对并确认</li>
              <li>激活完成</li>
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
      ) : (
        <>
          {!serverMediaStopped &&
            shouldKeepCompanionActive(incoming?.status ?? null) &&
            companionRuntimePanel}
          {serverMediaStopped && !incoming && (
            <section className="companion-runtime-shell">
              <div className="inline-alert danger" role="alert">
                <ShieldCheck aria-hidden="true" size={20} />
                <span>{notice || "陪伴媒体已停止，请检查授权后刷新设备上下文。"}</span>
              </div>
            </section>
          )}
          {incoming && (
        <section
          className={`incoming-call-screen${
            incoming.status === "RINGING" ? " is-overlay" : ""
          }`}
        >
          <div className="incoming-pulse">
            <PhoneCall aria-hidden="true" size={42} />
          </div>
          <p className="eyebrow">家庭成员来电</p>
          <h1>{context?.recipient.preferredName}，家人想和你说话</h1>
          <p>
            接听后将开启摄像头和麦克风。本次通话不会录制。
          </p>
          <div
            className={`device-call-media ${
              callPresentation?.state === "connected"
                ? "is-connected"
                : callPresentation?.state === "media-failed"
                  ? "is-error"
                  : "is-pending"
            }`}
          >
            <video
              ref={localVideo}
              muted
              autoPlay
              playsInline
              aria-label="本机摄像头预览"
            />
            <audio ref={remoteAudio} autoPlay aria-label="家属实时音频" />
            {callPresentation?.state === "connected" ? (
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
                {callPresentation?.message}
              </span>
            )}
          </div>
          {callDetail && (
            <div
              className={`form-message ${callPresentation?.callDetailTone ?? "success"}`}
              role={callPresentation?.callDetailTone === "error" ? "alert" : "status"}
            >
              {callDetail}
            </div>
          )}
          {error && (
            <div className="form-message error" role="alert">
              {error}
            </div>
          )}
          <div className="incoming-actions">
            {callPresentation?.state !== "connected" ? (
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
                {callPresentation?.canJoin && (
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
                )}
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
          )}
        </>
      )}
    </main>
  );
};
