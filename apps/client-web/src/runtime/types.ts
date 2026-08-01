export type ProviderId = "local" | "cloud";

export type ExperienceMode =
  | "voice"
  | "video"
  | "chat"
  | "voice-lab";

export type RuntimeStatus =
  | "idle"
  | "preflight"
  | "connecting"
  | "queued"
  | "initializing"
  | "live"
  | "closing"
  | "error";

export type RuntimeDirection = "in" | "out" | "local";

export type CameraRuntimeState =
  | "off"
  | "armed"
  | "requesting"
  | "live"
  | "error";

export type RuntimeEvent = {
  direction: RuntimeDirection;
  type: string;
  detail: string;
  tone?: "blue" | "amber" | "green" | "coral";
  rawType?: string;
};

export type RuntimeMetrics = {
  connectionMs: number | null;
  queueMs: number | null;
  initMs: number | null;
  firstTextMs: number | null;
  firstAudioMs: number | null;
  turnTotalMs: number | null;
  generateMs: number | null;
  modelLatencyMs: number | null;
  driftMs: number | null;
  playbackDelayMs: number;
  playbackBufferMs: number;
  underruns: number;
  inputChunks: number;
  outputChunks: number;
  inputTokens: number | null;
  outputTokens: number | null;
  kvCacheLength: number | null;
  visionFps: number | null;
  visionFramesSent: number;
  visionSlices: number | null;
  jitterP95Ms: number | null;
};

export const emptyMetrics = (
  playbackDelayMs = 400,
): RuntimeMetrics => ({
  connectionMs: null,
  queueMs: null,
  initMs: null,
  firstTextMs: null,
  firstAudioMs: null,
  turnTotalMs: null,
  generateMs: null,
  modelLatencyMs: null,
  driftMs: null,
  playbackDelayMs,
  playbackBufferMs: 0,
  underruns: 0,
  inputChunks: 0,
  outputChunks: 0,
  inputTokens: null,
  outputTokens: null,
  kvCacheLength: null,
  visionFps: null,
  visionFramesSent: 0,
  visionSlices: null,
  jitterP95Ms: null,
});

export type AssistantOutput = {
  delta?: string;
  text?: string;
  done?: boolean;
};

export type RuntimeCallbacks = {
  onStatus: (status: RuntimeStatus) => void;
  onQueue: (position: number | null, etaSeconds?: number | null) => void;
  onEvent: (event: RuntimeEvent) => void;
  onAssistant: (output: AssistantOutput) => void;
  onUserTranscript: (text: string, done: boolean) => void;
  onMetrics: (metrics: Partial<RuntimeMetrics>) => void;
  onSignals: (signals: {
    listening?: boolean;
    userSpeaking?: boolean;
    modelSpeaking?: boolean;
  }) => void;
  onVideoStream: (stream: MediaStream | null) => void;
  onCameraState: (state: CameraRuntimeState, message?: string) => void;
  onError: (message: string) => void;
  onEnded: (reason?: string) => void;
};

export type SessionOptions = {
  provider: ProviderId;
  mode: ExperienceMode;
  cameraEnabled: boolean;
  prompt: string;
  muted: boolean;
  playbackMuted: boolean;
  referenceAudio?: string | null;
  realtimeWs?: string;
  chatHttp?: string;
  cloudBaseUrl?: string;
  model?: string;
};

export type TurnMessageContent =
  | string
  | Array<
      | { type: "text"; text: string }
      | { type: "image"; data: string }
    >;

export type TurnMessage = {
  role: "user" | "assistant";
  content: TurnMessageContent;
};

export type TurnRequest = {
  messages: TurnMessage[];
  streaming: boolean;
  ttsEnabled: boolean;
  enableThinking: boolean;
  maxNewTokens: number;
  lengthPenalty: number;
  referenceAudio?: string | null;
};
