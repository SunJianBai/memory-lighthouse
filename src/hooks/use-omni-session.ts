import { useCallback, useEffect, useRef, useState } from "react";
import { buildAgentPrompt } from "../agent/prompt-builder";
import type { AppState, Routine } from "../domain/types";
import { SessionRuntime } from "../runtime/session-runtime";
import {
  emptyMetrics,
  type CameraRuntimeState,
  type RuntimeEvent,
  type RuntimeMetrics,
  type RuntimeStatus,
} from "../runtime/types";

type SessionSignals = {
  listening: boolean;
  userSpeaking: boolean;
  modelSpeaking: boolean;
};

export type OmniSessionState = {
  status: RuntimeStatus;
  cameraState: CameraRuntimeState;
  cameraMessage: string;
  videoStream: MediaStream | null;
  assistantText: string;
  userTranscript: string;
  userTranscriptFinal: boolean;
  error: string;
  metrics: RuntimeMetrics;
  events: RuntimeEvent[];
  signals: SessionSignals;
  providerLabel: string;
};

const initialSignals: SessionSignals = {
  listening: false,
  userSpeaking: false,
  modelSpeaking: false,
};

let bundledReferenceAudio: Promise<string | null> | null = null;

const loadBundledReferenceAudio = () => {
  if (!bundledReferenceAudio) {
    bundledReferenceAudio = fetch("/ref_minicpm_signature.wav")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.blob();
      })
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
          }),
      )
      .catch(() => null);
  }
  return bundledReferenceAudio;
};

export const useOmniSession = (
  appState: AppState,
  activeRoutine?: Routine,
) => {
  const runtimeRef = useRef<SessionRuntime | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const assistantDraftRef = useRef("");
  const userDraftRef = useRef("");
  const userTranscriptDoneRef = useRef(false);
  const localActionSpeechRef = useRef(false);
  const browserActionSpeakingRef = useRef(false);
  const previousConsentRef = useRef({
    camera: appState.consent.cameraApproved,
    microphone: appState.consent.microphoneApproved,
    sensitiveMemory: appState.consent.sensitiveMemoryApproved,
    cloudProcessing: appState.consent.cloudProcessingApproved,
  });
  const [session, setSession] = useState<OmniSessionState>({
    status: "idle",
    cameraState: "off",
    cameraMessage: "",
    videoStream: null,
    assistantText: "",
    userTranscript: "",
    userTranscriptFinal: false,
    error: "",
    metrics: emptyMetrics(),
    events: [],
    signals: initialSignals,
    providerLabel: "演示回放",
  });

  const stopPreview = useCallback(() => {
    previewStreamRef.current?.getTracks().forEach((track) => track.stop());
    previewStreamRef.current = null;
  }, []);

  const startReplayPreview = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) return;
    setSession((current) => ({
      ...current,
      cameraState: "requesting",
    }));
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      previewStreamRef.current = stream;
      setSession((current) => ({
        ...current,
        videoStream: stream,
        cameraState: "live",
      }));
    } catch (error) {
      setSession((current) => ({
        ...current,
        cameraState: "error",
        cameraMessage:
          error instanceof Error ? error.message : "摄像头不可用",
      }));
    }
  }, []);

  const stop = useCallback(
    (reason = "user_stop") => {
      runtimeRef.current?.stop(reason);
      runtimeRef.current = null;
      stopPreview();
      window.speechSynthesis?.cancel();
      localActionSpeechRef.current = false;
      browserActionSpeakingRef.current = false;
      setSession((current) => ({
        ...current,
        status: "idle",
        cameraState: "off",
        videoStream: null,
        signals: initialSignals,
      }));
    },
    [stopPreview],
  );

  useEffect(() => () => stop("component_unmount"), [stop]);

  useEffect(() => {
    const previous = previousConsentRef.current;
    const current = {
      camera: appState.consent.cameraApproved,
      microphone: appState.consent.microphoneApproved,
      sensitiveMemory: appState.consent.sensitiveMemoryApproved,
      cloudProcessing: appState.consent.cloudProcessingApproved,
    };
    previousConsentRef.current = current;
    const authorizationWasRevoked =
      (previous.camera && !current.camera) ||
      (previous.microphone && !current.microphone) ||
      (previous.sensitiveMemory && !current.sensitiveMemory) ||
      (previous.cloudProcessing && !current.cloudProcessing);
    if (
      authorizationWasRevoked &&
      (runtimeRef.current || previewStreamRef.current)
    ) {
      stop("consent_revoked");
    }
  }, [
    appState.consent.cameraApproved,
    appState.consent.cloudProcessingApproved,
    appState.consent.microphoneApproved,
    appState.consent.sensitiveMemoryApproved,
    stop,
  ]);

  const start = useCallback(async () => {
    stop("restart");
    assistantDraftRef.current = "";
    userDraftRef.current = "";
    userTranscriptDoneRef.current = false;
    const provider = appState.provider.provider;
    if (provider !== "replay" && !appState.consent.microphoneApproved) {
      setSession((current) => ({
        ...current,
        status: "error",
        error: "尚未授权麦克风，真实模型会话没有启动",
      }));
      return;
    }
    if (provider === "cloud" && !appState.consent.cloudProcessingApproved) {
      setSession((current) => ({
        ...current,
        status: "error",
        error: "尚未授权公网处理，ModelBest 会话没有启动",
      }));
      return;
    }
    if (provider === "replay") {
      setSession((current) => ({
        ...current,
        status: "live",
        error: "",
        assistantText: "",
        userTranscript: "",
        userTranscriptFinal: false,
        events: [
          {
            direction: "local",
            type: "replay.ready",
            detail: "Presenter-controlled deterministic demo mode",
            tone: "green",
          },
        ],
        signals: initialSignals,
        providerLabel: "演示回放",
      }));
      if (appState.consent.cameraApproved) {
        await startReplayPreview();
      }
      return;
    }

    const runtime = new SessionRuntime({
      onStatus: (status) =>
        setSession((current) => ({ ...current, status })),
      onQueue: () => undefined,
      onEvent: (event) =>
        setSession((current) => ({
          ...current,
          events: [event, ...current.events].slice(0, 80),
        })),
      onAssistant: (output) => {
        if (output.delta) assistantDraftRef.current += output.delta;
        if (output.done && output.text) assistantDraftRef.current = output.text;
        setSession((current) => ({
          ...current,
          assistantText: assistantDraftRef.current,
        }));
        if (
          output.done &&
          output.text &&
          localActionSpeechRef.current &&
          "speechSynthesis" in window
        ) {
          localActionSpeechRef.current = false;
          const utterance = new SpeechSynthesisUtterance(output.text);
          utterance.lang = "zh-CN";
          utterance.rate = 0.88;
          setSession((current) => ({
            ...current,
            signals: { ...current.signals, modelSpeaking: true },
          }));
          browserActionSpeakingRef.current = true;
          utterance.onend = () => {
            browserActionSpeakingRef.current = false;
            setSession((current) => ({
              ...current,
              signals: { ...current.signals, modelSpeaking: false },
            }));
          };
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        }
      },
      onUserTranscript: (text, done) => {
        if (text && browserActionSpeakingRef.current) {
          browserActionSpeakingRef.current = false;
          window.speechSynthesis.cancel();
          setSession((current) => ({
            ...current,
            signals: { ...current.signals, modelSpeaking: false },
          }));
        }
        userDraftRef.current = done
          ? text
          : userTranscriptDoneRef.current
            ? text
            : `${userDraftRef.current}${text}`;
        userTranscriptDoneRef.current = done;
        setSession((current) => ({
          ...current,
          userTranscript: userDraftRef.current,
          userTranscriptFinal: done,
        }));
      },
      onMetrics: (metrics) =>
        setSession((current) => ({
          ...current,
          metrics: { ...current.metrics, ...metrics },
        })),
      onSignals: (signals) =>
        setSession((current) => ({
          ...current,
          signals: { ...current.signals, ...signals },
        })),
      onVideoStream: (videoStream) =>
        setSession((current) => ({ ...current, videoStream })),
      onCameraState: (cameraState, cameraMessage = "") =>
        setSession((current) => ({
          ...current,
          cameraState,
          cameraMessage,
        })),
      onError: (error) =>
        setSession((current) => ({
          ...current,
          status: "error",
          error,
        })),
      onEnded: () => undefined,
    });
    runtimeRef.current = runtime;
    const isLocal = provider === "local";
    setSession((current) => ({
      ...current,
      providerLabel: isLocal ? "本地 Ascend" : "ModelBest 公网",
      error: "",
      events: [],
    }));
    try {
      const cameraEnabled = appState.consent.cameraApproved;
      const referenceAudio = isLocal
        ? appState.provider.referenceAudio ??
          (await loadBundledReferenceAudio())
        : null;
      await runtime.start({
        provider: isLocal ? "local" : "cloud",
        mode: cameraEnabled ? "video" : "voice",
        cameraEnabled,
        prompt: buildAgentPrompt(appState, activeRoutine),
        muted: false,
        playbackMuted: false,
        referenceAudio,
        realtimeWs: isLocal
          ? appState.provider.localRealtimeWs
          : appState.provider.cloudRealtimeWs,
        chatHttp: appState.provider.localChatHttp,
        cloudBaseUrl: appState.provider.cloudBaseUrl,
        model: appState.provider.model,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "会话启动失败";
      setSession((current) => ({
        ...current,
        status: "error",
        error: message,
      }));
    }
  }, [activeRoutine, appState, startReplayPreview, stop]);

  const requestModelAction = useCallback(
    async (instruction: string) => {
      const runtime = runtimeRef.current;
      if (
        !runtime ||
        session.status !== "live" ||
        appState.provider.provider === "replay"
      ) {
        return false;
      }
      localActionSpeechRef.current = appState.provider.provider === "local";
      try {
        await runtime.sendTurn({
          messages: [
            {
              role: "user",
              content: `[确定性业务事件] ${instruction}。请严格遵守系统边界，用最多两句中文直接回应长者，不要解释内部规则。`,
            },
          ],
          streaming: appState.provider.provider === "local",
          ttsEnabled: appState.provider.provider === "cloud",
          enableThinking: false,
          maxNewTokens: 96,
          lengthPenalty: 1,
          referenceAudio:
            appState.provider.provider === "local"
              ? appState.provider.referenceAudio
              : undefined,
        });
        return true;
      } catch (error) {
        localActionSpeechRef.current = false;
        setSession((current) => ({
          ...current,
          status: "error",
          error:
            error instanceof Error ? error.message : "模型动作请求失败",
        }));
        return false;
      }
    },
    [appState, session.status],
  );

  const speakReplay = useCallback((text: string) => {
    assistantDraftRef.current = text;
    setSession((current) => ({
      ...current,
      assistantText: text,
      signals: { ...current.signals, modelSpeaking: true },
      events: [
        {
          direction: "local" as const,
          type: "replay.agent_speak",
          detail: text,
          tone: "amber" as const,
        },
        ...current.events,
      ].slice(0, 80),
    }));
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "zh-CN";
    utterance.rate = 0.88;
    utterance.pitch = 1;
    utterance.onend = () =>
      setSession((current) => ({
        ...current,
        signals: { ...current.signals, modelSpeaking: false },
      }));
    window.speechSynthesis.speak(utterance);
  }, []);

  return { session, start, stop, speakReplay, requestModelAction };
};
