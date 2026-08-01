import {
  float32ToBase64,
  float32Base64ToWavDataUrl,
  pcm16ToBase64,
} from "./codecs";
import {
  CameraCapture,
  MicrophoneCapture,
  PcmPlayer,
} from "./media";
import type {
  RuntimeCallbacks,
  RuntimeMetrics,
  SessionOptions,
  TurnRequest,
} from "./types";

type JsonMessage = Record<string, any>;

const DEFAULT_MODEL_NAME = "openbmb/MiniCPM-o-4_5";
const DEFAULT_MODEL_BEST_BASE = "https://minicpmo45.modelbest.cn";
const DEFAULT_MODEL_BEST_WS = "wss://minicpmo45.modelbest.cn/v1/realtime";
const ECHO_GUARD_MS = 300;
const VLLM_STARTUP_FORCE_LISTEN_UNITS = 3;

const defaultReferenceAudio = new Map<string, Promise<string | null>>();

const getDefaultReferenceAudio = (baseUrl = DEFAULT_MODEL_BEST_BASE) => {
  if (!defaultReferenceAudio.has(baseUrl)) {
    defaultReferenceAudio.set(baseUrl, fetch(`${baseUrl}/api/default_ref_audio`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) =>
        typeof payload.base64 === "string" ? payload.base64 : null,
      )
      .catch(() => null));
  }
  return defaultReferenceAudio.get(baseUrl) ?? Promise.resolve(null);
};

const getErrorMessage = (message: JsonMessage) => {
  if (typeof message.error === "string") return message.error;
  if (typeof message.error?.message === "string") {
    return message.error.message;
  }
  if (typeof message.diagnostic?.message === "string") {
    return message.diagnostic.message;
  }
  return "模型端返回未知错误";
};

const percentile95 = (values: number[]) => {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
};

const visibleVllmText = (text: string, thinkingEnabled: boolean) => {
  if (thinkingEnabled) return text;
  const thinkStart = text.indexOf("<think>");
  if (thinkStart < 0) return text;
  const thinkEnd = text.lastIndexOf("</think>");
  if (thinkEnd < thinkStart) return text.slice(0, thinkStart);
  return `${text.slice(0, thinkStart)}${text.slice(thinkEnd + 8)}`.trimStart();
};

export class SessionRuntime {
  private callbacks: RuntimeCallbacks;
  private options: SessionOptions | null = null;
  private socket: WebSocket | null = null;
  private mic = new MicrophoneCapture();
  private camera = new CameraCapture();
  private player: PcmPlayer;
  private cameraEnabled = false;
  private cameraStart: Promise<void> | null = null;
  private started = false;
  private muted = false;
  private ready = false;
  private stopped = false;
  private requestStartedAt = 0;
  private socketOpenedAt = 0;
  private queueStartedAt = 0;
  private initSentAt = 0;
  private inputSentAt = 0;
  private firstOutputAt = 0;
  private outputArrivalTimes: number[] = [];
  private inputChunks = 0;
  private outputChunks = 0;
  private videoFramesSent = 0;
  private textBuffer = "";
  private activeTurnSocket: WebSocket | null = null;
  private activeTurnAbort: AbortController | null = null;
  private playbackByResponse = new Map<
    string,
    { itemId: string; drainRequested: boolean }
  >();
  private activePlaybackResponseId: string | null = null;

  constructor(callbacks: RuntimeCallbacks, playbackDelayMs = 400) {
    this.callbacks = callbacks;
    this.player = new PcmPlayer(playbackDelayMs, (metrics) => {
      this.callbacks.onMetrics({
        playbackBufferMs: metrics.bufferMs,
        underruns: metrics.underruns,
      });
    });
  }

  async start(options: SessionOptions) {
    if (this.started || this.stopped) {
      throw new Error("会话运行时不可重复启动，请创建新会话");
    }
    this.started = true;
    this.options = options;
    this.muted = options.muted;
    this.cameraEnabled = options.cameraEnabled;
    this.player.setMuted(options.playbackMuted);
    this.resetSessionState();
    await this.player.activate();
    if (this.stopped) return;

    if (options.mode === "chat" || options.mode === "voice-lab") {
      this.callbacks.onStatus("live");
      this.callbacks.onSignals({
        listening: false,
        userSpeaking: false,
        modelSpeaking: false,
      });
      this.emit(
        "workspace.ready",
        options.mode === "chat"
          ? "轮次工作区已就绪；每次发送会建立独立真实连接"
          : "音色工作区已就绪",
        "local",
        "green",
      );
      return;
    }

    this.callbacks.onStatus("connecting");
    this.emit(
      "media.permission.requested",
      options.mode === "video" && options.cameraEnabled
        ? "microphone + camera"
        : "microphone",
      "local",
      "blue",
    );
    try {
      await this.startMedia(options);
    } catch (error) {
      if (
        this.stopped &&
        error instanceof DOMException &&
        error.name === "AbortError"
      ) {
        return;
      }
      throw error;
    }
    if (this.stopped) return;

    if (options.provider === "cloud") {
      this.startModelBestDuplex(options);
    } else {
      this.startVllmDuplex(options);
    }
  }

  async sendTurn(request: TurnRequest) {
    if (this.stopped) {
      throw new Error("会话已经结束，请创建新会话后重试");
    }
    if (!this.options) {
      throw new Error("轮次工作区尚未初始化");
    }
    if (this.options.provider === "local") {
      await this.sendVllmTurn(request);
      return;
    }
    this.closeTurnSocket("new_turn");
    this.requestStartedAt = performance.now();
    this.socketOpenedAt = 0;
    this.queueStartedAt = 0;
    this.initSentAt = 0;
    this.inputSentAt = 0;
    this.firstOutputAt = 0;
    this.textBuffer = "";
    this.outputArrivalTimes = [];
    this.outputChunks = 0;
    this.callbacks.onStatus("connecting");
    this.callbacks.onQueue(null);
    this.callbacks.onMetrics({
      connectionMs: null,
      queueMs: null,
      initMs: null,
      firstTextMs: null,
      firstAudioMs: null,
      turnTotalMs: null,
      generateMs: null,
      inputTokens: null,
      outputTokens: null,
      outputChunks: 0,
      jitterP95Ms: null,
    });

    const referenceAudio =
      request.referenceAudio ??
      (request.ttsEnabled
        ? await getDefaultReferenceAudio(this.options.cloudBaseUrl)
        : null);
    if (this.stopped) {
      throw new Error("会话已经结束，请创建新会话后重试");
    }
    const input = {
      messages: request.messages,
      streaming: request.streaming,
      generation: {
        max_new_tokens: request.maxNewTokens,
        do_sample: true,
        length_penalty: request.lengthPenalty,
      },
      image: { max_slice_nums: 2 },
      omni_mode: false,
      enable_thinking: request.enableThinking,
      ...(request.ttsEnabled
        ? {
            tts: {
              enabled: true,
              mode: "audio_assistant",
              ...(referenceAudio
                ? { ref_audio_data: referenceAudio }
                : {}),
            },
            use_tts_template: true,
          }
        : {}),
    };

    const cloudWs = this.options.realtimeWs ?? DEFAULT_MODEL_BEST_WS;
    const socket = new WebSocket(`${cloudWs}?mode=chat`);
    this.activeTurnSocket = socket;
    let initSent = false;
    let inputSent = false;
    let closeSent = false;
    let turnErrored = false;
    let settled = false;
    let resolveTurn!: () => void;
    let rejectTurn!: (error: Error) => void;
    const completion = new Promise<void>((resolve, reject) => {
      resolveTurn = resolve;
      rejectTurn = reject;
    });
    const completionTimer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      turnErrored = true;
      rejectTurn(new Error("ModelBest 动作请求等待响应超时"));
      sendClose("timeout");
    }, 90_000);
    const settleSuccess = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(completionTimer);
      resolveTurn();
    };
    const settleFailure = (error: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(completionTimer);
      rejectTurn(error);
    };

    const sendInit = () => {
      if (initSent || socket.readyState !== WebSocket.OPEN) return;
      initSent = true;
      this.initSentAt = performance.now();
      const message = { type: "session.init", payload: {} };
      socket.send(JSON.stringify(message));
      this.emit("session.init", "mode=chat", "out", "blue");
    };

    const sendInput = () => {
      if (inputSent || socket.readyState !== WebSocket.OPEN) return;
      inputSent = true;
      this.inputSentAt = performance.now();
      socket.send(JSON.stringify({ type: "input.append", input }));
      this.emit(
        "input.append",
        `messages=${request.messages.length} · streaming=${request.streaming} · tts=${request.ttsEnabled}`,
        "out",
        "blue",
      );
    };

    const sendClose = (reason = "turn_done") => {
      if (closeSent || socket.readyState !== WebSocket.OPEN) return;
      closeSent = true;
      socket.send(JSON.stringify({ type: "session.close", reason }));
      this.emit("session.close", `reason=${reason}`, "out", "coral");
    };

    socket.onopen = () => {
      this.socketOpenedAt = performance.now();
      this.queueStartedAt = this.socketOpenedAt;
      this.callbacks.onMetrics({
        connectionMs: this.socketOpenedAt - this.requestStartedAt,
      });
      this.emit(
        "transport.open",
        "ModelBest WSS connected · waiting for queue_done",
        "in",
        "green",
      );
    };

    socket.onmessage = (event) => {
      if (this.stopped || socket !== this.activeTurnSocket) return;
      const message = this.parseMessage(event.data);
      if (!message) return;
      const now = performance.now();
      switch (message.type) {
        case "session.queued":
        case "session.queue_update":
          this.callbacks.onStatus("queued");
          this.callbacks.onQueue(
            Number(message.position) || null,
            Number(message.estimated_wait_s) || null,
          );
          this.emit(
            "queue.changed",
            `position=${message.position ?? "?"} · eta=${message.estimated_wait_s ?? "?"}s`,
            "in",
            "amber",
            message.type,
          );
          break;
        case "session.queue_done":
          this.callbacks.onStatus("initializing");
          this.callbacks.onQueue(null);
          this.callbacks.onMetrics({
            queueMs: now - (this.queueStartedAt || this.socketOpenedAt),
          });
          this.emit(
            "session.queue_done",
            "worker allocated",
            "in",
            "green",
          );
          sendInit();
          break;
        case "session.created":
          this.callbacks.onStatus("live");
          this.callbacks.onMetrics({
            initMs: now - this.initSentAt,
          });
          this.emit(
            "session.created",
            `session_id=${String(message.session_id ?? "").slice(0, 12) || "assigned"}`,
            "in",
            "green",
          );
          sendInput();
          break;
        case "response.output.delta": {
          this.recordOutputArrival(now);
          this.outputChunks += 1;
          this.callbacks.onMetrics({ outputChunks: this.outputChunks });
          if (message.kind === "text" && message.text) {
            if (!this.firstOutputAt) this.firstOutputAt = now;
            if (this.inputSentAt && this.textBuffer.length === 0) {
              this.callbacks.onMetrics({
                firstTextMs: now - this.inputSentAt,
              });
            }
            this.textBuffer += String(message.text);
            this.callbacks.onAssistant({ delta: String(message.text) });
            this.callbacks.onSignals({ modelSpeaking: true });
            this.emit(
              "response.text.delta",
              `chars=${String(message.text).length}`,
              "in",
              "blue",
              "response.output.delta",
            );
          } else if (message.kind === "audio" && message.audio) {
            if (!this.firstOutputAt) this.firstOutputAt = now;
            if (this.inputSentAt && this.outputChunks <= 2) {
              this.callbacks.onMetrics({
                firstAudioMs: now - this.inputSentAt,
              });
            }
            void this.player.playFloat32(String(message.audio));
            this.callbacks.onSignals({ modelSpeaking: true });
            this.emit(
              "response.audio.delta",
              `bytes≈${Math.round(String(message.audio).length * 0.75)}`,
              "in",
              "amber",
              "response.output.delta",
            );
          }
          this.applyServerMetrics(message);
          break;
        }
        case "response.done": {
          const finalText = String(message.text ?? this.textBuffer);
          let finalPlayback: Promise<number> | null = null;
          if (message.audio_data || message.audio) {
            if (!this.firstOutputAt) this.firstOutputAt = now;
            this.callbacks.onMetrics({
              firstAudioMs: this.inputSentAt
                ? now - this.inputSentAt
                : null,
            });
            finalPlayback = this.player.playEncoded(
              String(message.audio_data ?? message.audio),
            );
          }
          this.drainPlaybackWithoutAck(finalPlayback);
          this.callbacks.onAssistant({ text: finalText, done: true });
          this.callbacks.onSignals({ modelSpeaking: false });
          const inputTokens = Number(
            message.input_tokens ?? message.n_input_tokens,
          );
          const outputTokens = Number(
            message.generated_tokens ??
              message.output_tokens ??
              message.n_tokens,
          );
          this.callbacks.onMetrics({
            turnTotalMs: this.inputSentAt ? now - this.inputSentAt : null,
            generateMs: this.firstOutputAt ? now - this.firstOutputAt : null,
            ...(inputTokens > 0 ? { inputTokens } : {}),
            ...(outputTokens > 0 ? { outputTokens } : {}),
          });
          this.applyServerMetrics(message);
          this.emit(
            "response.done",
            `input_tokens=${message.input_tokens ?? "—"} · output_tokens=${message.generated_tokens ?? "—"}`,
            "in",
            "green",
          );
          settleSuccess();
          sendClose();
          break;
        }
        case "session.closed": {
          const reason = String(message.reason ?? "");
          const diagnostic = getErrorMessage(message);
          if (
            diagnostic !== "模型端返回未知错误" ||
            (reason && !["turn_done", "client_closed"].includes(reason))
          ) {
            turnErrored = true;
            const errorMessage =
              diagnostic !== "模型端返回未知错误" ? diagnostic : reason;
            this.callbacks.onError(errorMessage);
            settleFailure(new Error(errorMessage));
          }
          if (!turnErrored && !settled) {
            settleFailure(
              new Error("ModelBest 动作请求在完成响应前关闭"),
            );
          }
          if (!turnErrored) this.callbacks.onStatus("live");
          this.activeTurnSocket = null;
          socket.close();
          break;
        }
        case "error":
          turnErrored = true;
          {
            const errorMessage = getErrorMessage(message);
            this.fail(errorMessage, false);
            settleFailure(new Error(errorMessage));
          }
          sendClose("error");
          break;
      }
    };

    socket.onerror = () => {
      if (!this.stopped && this.activeTurnSocket === socket) {
        turnErrored = true;
        this.fail("ModelBest Chat WebSocket 连接异常", false);
        settleFailure(new Error("ModelBest Chat WebSocket 连接异常"));
      }
    };
    socket.onclose = () => {
      if (this.activeTurnSocket === socket) {
        this.activeTurnSocket = null;
        if (!turnErrored) this.callbacks.onStatus("live");
      }
      if (!settled) {
        settleFailure(new Error("ModelBest 动作请求连接提前关闭"));
      }
    };
    await completion;
  }

  isPreviewOnly() {
    return !this.started && !this.stopped;
  }

  private async sendVllmTurn(request: TurnRequest) {
    if (!this.options) return;
    this.activeTurnAbort?.abort();
    this.closeTurnSocket("provider_changed");
    const controller = new AbortController();
    this.activeTurnAbort = controller;
    this.requestStartedAt = performance.now();
    this.inputSentAt = this.requestStartedAt;
    this.firstOutputAt = 0;
    this.textBuffer = "";
    this.outputArrivalTimes = [];
    this.outputChunks = 0;
    this.callbacks.onStatus("connecting");
    this.callbacks.onQueue(null);
    this.callbacks.onMetrics({
      connectionMs: null,
      queueMs: null,
      initMs: null,
      firstTextMs: null,
      firstAudioMs: null,
      turnTotalMs: null,
      generateMs: null,
      inputTokens: null,
      outputTokens: null,
      outputChunks: 0,
      jitterP95Ms: null,
    });

    const messages = [
      ...(this.options.prompt
        ? [{ role: "system", content: this.options.prompt }]
        : []),
      ...request.messages.map((message) => ({
        role: message.role,
        content: Array.isArray(message.content)
          ? message.content.map((part) =>
              part.type === "text"
                ? { type: "text", text: part.text }
                : {
                    type: "image_url",
                    image_url: { url: part.data },
                  },
            )
          : message.content,
      })),
    ];
    const localHost =
      window.location.hostname === "localhost" ? "localhost" : "127.0.0.1";
    const endpoint =
      this.options.chatHttp ??
      `http://${localHost}:18099/v1/chat/completions`;
    const body = {
      model: this.options.model ?? DEFAULT_MODEL_NAME,
      messages,
      modalities: ["text"],
      stream: request.streaming,
      ...(request.streaming
        ? { stream_options: { include_usage: true } }
        : {}),
      max_tokens: request.maxNewTokens,
      length_penalty: request.lengthPenalty,
      chat_template_kwargs: {
        enable_thinking: request.enableThinking,
      },
    };
    this.emit(
      "chat.request",
      `POST /v1/chat/completions · messages=${request.messages.length} · streaming=${request.streaming}`,
      "out",
      "blue",
      "http.request",
    );

    let rawText = "";
    let visibleText = "";
    let inputTokens: number | null = null;
    let outputTokens: number | null = null;
    const applyUsage = (usage: JsonMessage | undefined) => {
      if (!usage) return;
      const promptTokens = Number(usage.prompt_tokens);
      const completionTokens = Number(usage.completion_tokens);
      if (promptTokens > 0) inputTokens = promptTokens;
      if (completionTokens > 0) outputTokens = completionTokens;
    };
    const appendRawDelta = (delta: string) => {
      if (!delta) return;
      rawText += delta;
      const nextVisible = visibleVllmText(
        rawText,
        request.enableThinking,
      );
      const visibleDelta = nextVisible.slice(visibleText.length);
      visibleText = nextVisible;
      if (!visibleDelta) return;
      const now = performance.now();
      this.recordOutputArrival(now);
      this.outputChunks += 1;
      if (!this.firstOutputAt) {
        this.firstOutputAt = now;
        this.callbacks.onMetrics({
          firstTextMs: now - this.inputSentAt,
        });
      }
      this.callbacks.onMetrics({ outputChunks: this.outputChunks });
      this.callbacks.onAssistant({ delta: visibleDelta });
      this.emit(
        "response.text.delta",
        `chars=${visibleDelta.length}`,
        "in",
        "blue",
        "chat.completion.chunk",
      );
    };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const headersAt = performance.now();
      this.callbacks.onMetrics({
        connectionMs: headersAt - this.requestStartedAt,
      });
      this.emit(
        "chat.response.headers",
        `HTTP ${response.status} · content-type=${response.headers.get("content-type") ?? "unknown"}`,
        "in",
        response.ok ? "green" : "coral",
        "http.response",
      );
      if (!response.ok) {
        const detail = await response.text();
        throw new Error(
          `本机 Chat HTTP ${response.status}: ${detail.slice(0, 240)}`,
        );
      }

      if (request.streaming) {
        if (!response.body) {
          throw new Error("本机 Chat 流式响应没有可读取的 body");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let streamDone = false;
        while (!streamDone) {
          const result = await reader.read();
          buffer += decoder.decode(result.value, { stream: !result.done });
          const frames = buffer.split(/\r?\n\r?\n/);
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const data = frame
              .split(/\r?\n/)
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trim())
              .join("\n");
            if (!data) continue;
            if (data === "[DONE]") {
              streamDone = true;
              break;
            }
            const payload = JSON.parse(data) as JsonMessage;
            applyUsage(payload.usage);
            const delta = payload.choices
              ?.map((choice: JsonMessage) => choice.delta?.content)
              .find((content: unknown) => typeof content === "string");
            if (typeof delta === "string") appendRawDelta(delta);
            this.applyServerMetrics(payload);
          }
          if (result.done) streamDone = true;
        }
      } else {
        const payload = (await response.json()) as JsonMessage;
        applyUsage(payload.usage);
        const content = payload.choices
          ?.map((choice: JsonMessage) => choice.message?.content)
          .find(
            (candidate: unknown) =>
              typeof candidate === "string" && candidate.length > 0,
          );
        if (typeof content === "string") appendRawDelta(content);
        this.applyServerMetrics(payload);
      }

      const now = performance.now();
      const finalText =
        visibleVllmText(rawText, request.enableThinking) ||
        "(无文字输出)";
      this.callbacks.onAssistant({ text: finalText, done: true });
      this.callbacks.onMetrics({
        turnTotalMs: now - this.inputSentAt,
        generateMs: this.firstOutputAt
          ? now - this.firstOutputAt
          : null,
        inputTokens,
        outputTokens,
        jitterP95Ms: percentile95(
          this.outputArrivalTimes
            .slice(1)
            .map(
              (arrival, index) =>
                arrival - this.outputArrivalTimes[index],
            ),
        ),
      });
      this.callbacks.onStatus("live");
      this.emit(
        "response.done",
        `prompt_tokens=${inputTokens ?? "—"} · completion_tokens=${outputTokens ?? "—"}`,
        "in",
        "green",
        "chat.completion.done",
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const message =
        error instanceof Error ? error.message : "本机 Chat 请求失败";
      this.emit("runtime.error", message, "in", "coral", "error");
      throw error;
    } finally {
      if (this.activeTurnAbort === controller) {
        this.activeTurnAbort = null;
      }
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    this.mic.setPaused(muted);
    this.emit(
      muted ? "media.microphone.paused" : "media.microphone.resumed",
      muted
        ? this.options?.mode === "video" && this.cameraEnabled
          ? "input delivery paused · camera preview stays local"
          : "input delivery paused"
        : "input delivery resumed",
      "local",
      muted ? "coral" : "green",
    );
  }

  setPlaybackMuted(muted: boolean) {
    this.player.setMuted(muted);
    if (muted) {
      this.playbackByResponse.clear();
      this.activePlaybackResponseId = null;
    }
    this.emit(
      muted ? "playback.muted" : "playback.resumed",
      muted ? "audio queue cleared" : "audio output enabled",
      "local",
      muted ? "coral" : "green",
    );
  }

  setCameraEnabled(enabled: boolean) {
    this.cameraEnabled = enabled;
    if (this.options) this.options.cameraEnabled = enabled;
    if (!enabled) {
      this.camera.stop();
      this.callbacks.onVideoStream(null);
      this.callbacks.onCameraState("off");
    } else if (
      !this.stopped &&
      (this.options?.mode === "video" || this.options === null)
    ) {
      this.callbacks.onCameraState("requesting");
      void this.ensureCameraStarted(this.options === null);
    }
    if (this.muted) this.mic.setPaused(true);
    this.emit(
      enabled ? "media.camera.requested" : "media.camera.paused",
      enabled
        ? this.options
          ? "requesting camera access"
          : "requesting camera access for local preview"
        : "video frame delivery paused",
      "local",
      enabled ? "blue" : "coral",
    );
  }

  forceListen() {
    if (
      this.options?.provider === "cloud" &&
      this.socket?.readyState === WebSocket.OPEN
    ) {
      this.player.stopAll();
      this.socket.send(
        JSON.stringify({
          type: "input.append",
          input: { audio: float32ToBase64(new Float32Array(1600)), force_listen: true },
        }),
      );
      this.emit("input.force_listen", "force_listen=true", "out", "blue");
    }
  }

  stop(reason = "user_stop") {
    if (this.stopped) return;
    this.stopped = true;
    this.callbacks.onStatus("closing");
    this.activeTurnAbort?.abort();
    this.activeTurnAbort = null;
    this.closeTurnSocket(reason);
    if (this.socket?.readyState === WebSocket.OPEN) {
      const closeMessage =
        this.options?.provider === "local"
          ? { type: "session.close", reason }
          : { type: "session.close", reason };
      this.socket.send(JSON.stringify(closeMessage));
      this.emit("session.close", `reason=${reason}`, "out", "coral");
    }
    this.socket?.close();
    this.socket = null;
    this.mic.stop();
    this.camera.stop();
    this.cameraStart = null;
    this.player.stop();
    this.callbacks.onVideoStream(null);
    this.callbacks.onCameraState("off");
    this.callbacks.onSignals({
      listening: false,
      userSpeaking: false,
      modelSpeaking: false,
    });
    this.callbacks.onEnded(reason);
  }

  private async startMedia(options: SessionOptions) {
    const duration = options.provider === "local" ? 200 : 1000;
    await this.mic.start(duration, (chunk) => {
      if (!this.ready) return;
      const withVideo =
        options.mode === "video" && this.cameraEnabled;
      if (this.muted) return;
      if (options.provider === "local") {
        this.sendVllmChunk(chunk, withVideo);
      } else {
        this.sendModelBestChunk(chunk, withVideo);
      }
    });
    if (this.stopped) return;
    this.mic.setPaused(options.muted);
    this.emit(
      "media.microphone.ready",
      `mono · 16 kHz · ${duration} ms chunks`,
      "local",
      "green",
    );
    if (options.mode === "video" && options.cameraEnabled) {
      this.callbacks.onCameraState("requesting");
      await this.ensureCameraStarted();
    }
  }

  private ensureCameraStarted(previewOnly = false) {
    if (this.camera.isActive()) {
      this.callbacks.onCameraState("live");
      return Promise.resolve();
    }
    const cameraModeReady =
      this.options?.mode === "video" ||
      (previewOnly && this.options === null);
    if (
      this.cameraStart ||
      !this.cameraEnabled ||
      !cameraModeReady ||
      this.stopped
    ) {
      return this.cameraStart ?? Promise.resolve();
    }
    const startTask = this.camera
      .start(
        (stream) => {
          if (!this.cameraEnabled || this.stopped) {
            this.camera.stop();
            return;
          }
          this.callbacks.onVideoStream(stream);
        },
        () => {
          if (this.stopped) return;
          this.cameraEnabled = false;
          if (this.options) this.options.cameraEnabled = false;
          this.camera.stop();
          this.callbacks.onVideoStream(null);
          this.callbacks.onCameraState(
            "error",
            "摄像头轨道已结束，请检查设备或系统权限",
          );
          this.emit(
            "media.camera.ended",
            "camera track ended · video delivery stopped",
            "local",
            "coral",
          );
        },
      );
    const cameraTask = startTask
      .then(() => {
        if (!this.cameraEnabled || this.stopped) {
          this.camera.stop();
          this.callbacks.onVideoStream(null);
          return;
        }
        if (!this.camera.isActive()) return;
        this.callbacks.onCameraState("live");
        this.emit(
          "media.camera.ready",
          "JPEG · quality=.7 · 1 fps",
          "local",
          "green",
        );
      })
      .catch((error) => {
        if (this.stopped || !this.cameraEnabled) return;
        this.cameraEnabled = false;
        if (this.options) this.options.cameraEnabled = false;
        this.callbacks.onVideoStream(null);
        const message =
          error instanceof Error ? error.message : "camera unavailable";
        this.callbacks.onCameraState("error", message);
        this.emit(
          "media.camera.error",
          message,
          "local",
          "coral",
        );
      })
      .finally(() => {
        if (this.cameraStart !== cameraTask) return;
        this.cameraStart = null;
        if (
          this.cameraEnabled &&
          !this.stopped &&
          !this.camera.isActive()
        ) {
          void this.ensureCameraStarted(previewOnly);
        }
      });
    this.cameraStart = cameraTask;
    return cameraTask;
  }

  private startModelBestDuplex(options: SessionOptions) {
    this.requestStartedAt = performance.now();
    const mode = options.mode === "video" ? "video" : "audio";
    const cloudWs = options.realtimeWs ?? DEFAULT_MODEL_BEST_WS;
    const socket = new WebSocket(`${cloudWs}?mode=${mode}`);
    this.socket = socket;
    let initSent = false;

    const sendInit = async () => {
      if (
        initSent ||
        socket !== this.socket ||
        socket.readyState !== WebSocket.OPEN
      ) {
        return;
      }
      initSent = true;
      this.initSentAt = performance.now();
      const referenceAudio =
        options.referenceAudio ??
        (await getDefaultReferenceAudio(options.cloudBaseUrl));
      const message = {
        type: "session.init",
        payload: {
          system_prompt: options.prompt,
          config: { length_penalty: 1 },
          ...(referenceAudio
            ? {
                voice: {
                  ref_audio_base64: referenceAudio,
                  tts_ref_audio_base64: referenceAudio,
                },
              }
            : {}),
        },
      };
      if (socket !== this.socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(JSON.stringify(message));
      this.emit(
        "session.init",
        `mode=${mode} · prompt_chars=${options.prompt.length} · tts=true`,
        "out",
        "blue",
      );
    };

    socket.onopen = () => {
      this.socketOpenedAt = performance.now();
      this.queueStartedAt = this.socketOpenedAt;
      this.callbacks.onMetrics({
        connectionMs: this.socketOpenedAt - this.requestStartedAt,
      });
      this.emit(
        "transport.open",
        `${cloudWs}?mode=${mode}`,
        "in",
        "green",
      );
    };

    socket.onmessage = (event) => {
      if (this.stopped || socket !== this.socket) return;
      const message = this.parseMessage(event.data);
      if (!message) return;
      const now = performance.now();
      switch (message.type) {
        case "session.queued":
        case "session.queue_update":
        case "queued":
        case "queue_update":
          this.callbacks.onStatus("queued");
          this.callbacks.onQueue(
            Number(message.position) || null,
            Number(message.estimated_wait_s) || null,
          );
          this.emit(
            "queue.changed",
            `position=${message.position ?? "?"} · eta=${message.estimated_wait_s ?? "?"}s`,
            "in",
            "amber",
            message.type,
          );
          break;
        case "session.queue_done":
        case "queue_done":
          this.callbacks.onStatus("initializing");
          this.callbacks.onQueue(null);
          this.callbacks.onMetrics({
            queueMs: now - (this.queueStartedAt || this.socketOpenedAt),
          });
          this.emit(
            "session.queue_done",
            "worker allocated",
            "in",
            "green",
            message.type,
          );
          void sendInit();
          break;
        case "session.created":
          this.ready = true;
          this.callbacks.onStatus("live");
          this.callbacks.onMetrics({
            initMs: now - this.initSentAt,
          });
          this.callbacks.onSignals({
            listening: true,
            modelSpeaking: false,
          });
          this.emit(
            "session.ready",
            `session_id=${String(message.session_id ?? "").slice(0, 12) || "assigned"}`,
            "in",
            "green",
            "session.created",
          );
          break;
        case "response.output.delta":
          this.handleModelBestOutput(message, now);
          break;
        case "response.listen":
          this.handleModelBestListen(message, now);
          break;
        case "response.output_audio.delta":
          this.handleModelBestCompatOutput(message, now);
          break;
        case "response.metrics":
          this.applyServerMetrics(message);
          this.emit(
            "response.metrics",
            `kv=${message.kv_cache_length ?? "—"} · model=${message.generate_ms ?? message.wall_clock_ms ?? "—"}ms`,
            "in",
            "green",
          );
          break;
        case "session.closed":
          this.emit(
            "session.closed",
            `reason=${message.reason ?? "server"}`,
            "in",
            "coral",
          );
          this.stop(String(message.reason ?? "server_closed"));
          break;
        case "error":
          this.fail(getErrorMessage(message));
          break;
      }
    };
    socket.onerror = () => {
      if (!this.stopped && socket === this.socket) {
        this.fail("ModelBest Realtime WebSocket 连接异常");
      }
    };
    socket.onclose = () => {
      if (!this.stopped && socket === this.socket) {
        this.fail("ModelBest Realtime 连接已关闭");
      }
    };
  }

  private startVllmDuplex(options: SessionOptions) {
    this.requestStartedAt = performance.now();
    const localHost =
      window.location.hostname === "localhost" ? "localhost" : "127.0.0.1";
    const realtimeWs =
      options.realtimeWs ?? `ws://${localHost}:17862/v1/realtime`;
    const separator = realtimeWs.includes("?") ? "&" : "?";
    const url =
      realtimeWs +
      `${separator}duplex=1&model=${encodeURIComponent(options.model ?? DEFAULT_MODEL_NAME)}` +
      "&minicpmo45_native_duplex=1&autostart=0";
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.onopen = async () => {
      this.socketOpenedAt = performance.now();
      this.callbacks.onMetrics({
        connectionMs: this.socketOpenedAt - this.requestStartedAt,
        queueMs: 0,
      });
      this.callbacks.onStatus("initializing");
      const rawReference =
        options.referenceAudio ??
        (await getDefaultReferenceAudio(options.cloudBaseUrl));
      if (
        socket !== this.socket ||
        socket.readyState !== WebSocket.OPEN
      ) {
        return;
      }
      if (!rawReference) {
        this.fail("无法加载 MiniCPM-o 必需的默认参考声音");
        return;
      }
      const referenceAudio = rawReference.startsWith("data:")
        ? rawReference
        : float32Base64ToWavDataUrl(rawReference);
      const message = {
        type: "session.update",
        session: {
          modalities: ["audio", "text"],
          voice: "default",
          instructions: options.prompt,
          ref_audio: referenceAudio,
          extra_body: {
            auto_response: true,
            minicpmo45_native_duplex: true,
            // Preserve the model's proactive full-duplex behavior after a
            // short native warm-up. Without this, the current NPU runtime can
            // sample a corrupt first speak segment from an empty context.
            force_listen_count: VLLM_STARTUP_FORCE_LISTEN_UNITS,
          },
        },
      };
      this.initSentAt = performance.now();
      socket.send(JSON.stringify(message));
      this.emit(
        "session.update",
        `native_duplex=true · modalities=audio,text · video=${options.mode === "video"}`,
        "out",
        "blue",
      );
    };

    socket.onmessage = (event) => {
      if (this.stopped || socket !== this.socket) return;
      const message = this.parseMessage(event.data);
      if (!message) return;
      const now = performance.now();
      switch (message.type) {
        case "session.created":
          this.emit(
            "session.created",
            `session_id=${String(message.session?.id ?? message.session_id ?? "").slice(0, 12) || "assigned"}`,
            "in",
            "green",
          );
          break;
        case "session.updated": {
          this.ready = true;
          this.callbacks.onStatus("live");
          this.callbacks.onMetrics({ initMs: now - this.initSentAt });
          this.callbacks.onSignals({
            listening: true,
            modelSpeaking: false,
          });
          const playbackPolicy =
            message.session?.playback_commit_policy ??
            message.playback_commit_policy ??
            "server-default";
          this.emit(
            "session.ready",
            `native_duplex=true · auto_response=true · startup_listen_units=${VLLM_STARTUP_FORCE_LISTEN_UNITS} · playback=${playbackPolicy}`,
            "in",
            "green",
            "session.updated",
          );
          break;
        }
        case "response.listen":
          this.callbacks.onSignals({
            listening: true,
            modelSpeaking: false,
          });
          this.emit("response.listen", "model is listening", "in", "green");
          this.applyServerMetrics(message);
          break;
        case "response.created":
        case "response.speak":
          this.activePlaybackResponseId =
            this.getResponseId(message) ??
            this.activePlaybackResponseId;
          this.callbacks.onSignals({
            listening: true,
            modelSpeaking: true,
          });
          this.emit(
            message.type,
            `response_id=${message.response?.id ?? message.response_id ?? "—"}`,
            "in",
            "amber",
          );
          this.applyServerMetrics(message);
          break;
        case "response.audio.delta":
          this.handleVllmAudio(message, now);
          break;
        case "response.audio_transcript.delta":
          if (message.delta) {
            if (!this.firstOutputAt) this.firstOutputAt = now;
            this.textBuffer += String(message.delta);
            this.callbacks.onAssistant({ delta: String(message.delta) });
            this.callbacks.onMetrics({
              firstTextMs:
                this.inputSentAt && this.textBuffer.length === String(message.delta).length
                  ? now - this.inputSentAt
                  : undefined,
            });
            this.emit(
              "response.text.delta",
              `chars=${String(message.delta).length}`,
              "in",
              "blue",
              message.type,
            );
          }
          break;
        case "response.audio_transcript.done":
          this.callbacks.onAssistant({
            text: String(message.transcript ?? this.textBuffer),
            done: true,
          });
          this.textBuffer = "";
          break;
        case "conversation.item.input_audio_transcription.delta":
          if (message.delta) {
            this.callbacks.onUserTranscript(String(message.delta), false);
          }
          break;
        case "conversation.item.input_audio_transcription.completed":
          this.callbacks.onUserTranscript(
            String(message.transcript ?? ""),
            true,
          );
          break;
        case "response.audio.done":
          void this.drainVllmPlayback(message);
          break;
        case "response.done": {
          if (this.textBuffer) {
            this.callbacks.onAssistant({
              text: this.textBuffer,
              done: true,
            });
            this.textBuffer = "";
          }
          this.callbacks.onSignals({
            listening: true,
          });
          void this.drainVllmPlayback(message);
          this.applyServerMetrics(message);
          const responseStatus = String(
            message.response?.status ?? message.status ?? "completed",
          );
          const statusDetail =
            message.response?.status_details?.error?.message ??
            message.response?.status_details?.reason ??
            message.status_details?.error?.message ??
            "";
          this.emit(
            "response.done",
            `response_id=${message.response?.id ?? message.response_id ?? "—"} · status=${responseStatus}${statusDetail ? ` · ${statusDetail}` : ""}`,
            "in",
            responseStatus === "completed" ? "green" : "coral",
          );
          break;
        }
        case "playback.acknowledged": {
          const acknowledgement = message.event ?? message;
          this.emit(
            "playback.acknowledged",
            `item=${acknowledgement.item_id ?? "—"} · committed_ms=${acknowledgement.committed_ms ?? "—"} · history=${acknowledgement.history_committed ?? "—"}`,
            "in",
            "green",
          );
          break;
        }
        case "session.closed":
          this.stop(String(message.reason ?? "server_closed"));
          break;
        case "error":
          this.fail(getErrorMessage(message));
          break;
      }
    };
    socket.onerror = () => {
      if (!this.stopped && socket === this.socket) {
        this.fail("本机 vLLM WebSocket 连接异常");
      }
    };
    socket.onclose = () => {
      if (!this.stopped && socket === this.socket) {
        this.fail("本机 vLLM 连接已关闭");
      }
    };
  }

  private sendModelBestChunk(chunk: Float32Array, withVideo: boolean) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const frame = withVideo ? this.camera.takeLatestFrame() : null;
    const message: JsonMessage = {
      type: "input.append",
      input: {
        audio: float32ToBase64(chunk),
        force_listen: false,
        ...(withVideo ? { max_slice_nums: 1 } : {}),
      },
    };
    if (frame) message.input.video_frames = [frame];
    this.socket.send(JSON.stringify(message));
    this.inputChunks += 1;
    if (frame) this.videoFramesSent += 1;
    this.inputSentAt ||= performance.now();
    this.callbacks.onMetrics({
      inputChunks: this.inputChunks,
      ...(frame
        ? {
            visionFps: this.camera.getMeasuredFps(),
            visionFramesSent: this.videoFramesSent,
          }
        : {}),
    });
    this.emit(
      "input.audio.append",
      `chunk=${this.inputChunks} · f32=${chunk.byteLength}B${frame ? " · frames=1" : ""}`,
      "out",
      "blue",
      "input.append",
    );
    if (frame) {
      this.emit(
        "input.video.frame",
        `frame=${this.videoFramesSent} · jpeg_base64_chars=${frame.length}`,
        "out",
        "green",
        "input.append",
      );
    }
  }

  private sendVllmChunk(chunk: Float32Array, withVideo: boolean) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const frame = withVideo ? this.camera.takeLatestFrame() : null;
    const message: JsonMessage = {
      type: "input_audio_buffer.append",
      audio: pcm16ToBase64(chunk),
      format: "pcm16",
      sample_rate_hz: 16000,
    };
    if (frame) message.video_frames = [frame];
    this.socket.send(JSON.stringify(message));
    this.inputChunks += 1;
    if (frame) this.videoFramesSent += 1;
    this.inputSentAt ||= performance.now();
    const reportChunk =
      this.inputChunks === 1 ||
      this.inputChunks % 5 === 0 ||
      frame !== null;
    if (reportChunk) {
      this.callbacks.onMetrics({
        inputChunks: this.inputChunks,
        ...(frame
          ? {
              visionFps: this.camera.getMeasuredFps(),
              visionFramesSent: this.videoFramesSent,
            }
          : {}),
      });
      this.emit(
        "input.audio.append",
        `chunks=${this.inputChunks} · latest_pcm16=${chunk.length * 2}B${frame ? " · frames=1" : ""}`,
        "out",
        "blue",
        "input_audio_buffer.append",
      );
      if (frame) {
        this.emit(
          "input.video.frame",
          `frame=${this.videoFramesSent} · jpeg_base64_chars=${frame.length}`,
          "out",
          "green",
          "input_audio_buffer.append",
        );
      }
    }
  }

  private handleModelBestOutput(message: JsonMessage, now: number) {
    this.recordOutputArrival(now);
    this.outputChunks += 1;
    this.callbacks.onMetrics({ outputChunks: this.outputChunks });
    if (message.kind === "listen") {
      this.handleModelBestListen(message, now);
      return;
    }
    this.callbacks.onSignals({ listening: true, modelSpeaking: true });
    if (message.kind === "text" && message.text) {
      if (!this.firstOutputAt) {
        this.firstOutputAt = now;
        this.callbacks.onMetrics({
          firstTextMs:
            this.inputSentAt > 0 ? now - this.inputSentAt : null,
        });
      }
      this.textBuffer += String(message.text);
      this.callbacks.onAssistant({ delta: String(message.text) });
      this.emit(
        "response.text.delta",
        `chars=${String(message.text).length}`,
        "in",
        "blue",
        "response.output.delta",
      );
    } else if (message.kind === "audio" && message.audio) {
      if (!this.firstOutputAt) {
        this.firstOutputAt = now;
        this.callbacks.onMetrics({
          firstAudioMs:
            this.inputSentAt > 0 ? now - this.inputSentAt : null,
        });
      }
      void this.player.playFloat32(String(message.audio));
      this.emit(
        "response.audio.delta",
        `chunk=${this.outputChunks} · bytes≈${Math.round(String(message.audio).length * 0.75)}`,
        "in",
        "amber",
        "response.output.delta",
      );
    }
    this.applyServerMetrics(message);
  }

  private handleModelBestListen(message: JsonMessage, now: number) {
    if (this.textBuffer) {
      this.callbacks.onAssistant({ text: this.textBuffer, done: true });
      this.textBuffer = "";
    }
    this.firstOutputAt = 0;
    this.inputSentAt = now;
    this.callbacks.onSignals({
      listening: true,
      modelSpeaking: false,
    });
    this.drainPlaybackWithoutAck();
    this.emit(
      "response.listen",
      "model returned to listening",
      "in",
      "green",
      message.type,
    );
    this.applyServerMetrics(message);
  }

  private handleModelBestCompatOutput(message: JsonMessage, now: number) {
    this.handleModelBestOutput(
      {
        ...message,
        type: "response.output.delta",
        kind: message.audio ? "audio" : "text",
      },
      now,
    );
  }

  private handleVllmAudio(message: JsonMessage, now: number) {
    const base64 = String(message.delta ?? "");
    if (!base64) return;
    this.recordOutputArrival(now);
    this.outputChunks += 1;
    if (!this.firstOutputAt) {
      this.firstOutputAt = now;
      this.callbacks.onMetrics({
        firstAudioMs: this.inputSentAt ? now - this.inputSentAt : null,
      });
    }
    const sampleRate = Number(message.sample_rate_hz) || 24000;
    const responseId =
      this.getResponseId(message) ??
      this.activePlaybackResponseId;
    if (responseId) {
      this.activePlaybackResponseId = responseId;
      const itemId = String(message.item_id ?? `item_${responseId}`);
      if (!this.playbackByResponse.has(responseId)) {
        this.playbackByResponse.set(responseId, {
          itemId,
          drainRequested: false,
        });
      }
    }
    const format = String(
      message.format ?? message.audio_format ?? "pcm16",
    ).toLowerCase();
    const playback =
      format.includes("f32")
        ? this.player.playFloat32(
            base64,
            sampleRate,
            responseId ?? undefined,
          )
        : format.includes("wav")
          ? this.player.playEncoded(
              base64,
              responseId ?? undefined,
            )
          : this.player.playPcm16(
              base64,
              sampleRate,
              responseId ?? undefined,
            );
    void playback
      .catch((error) => {
        this.emit(
          "playback.error",
          error instanceof Error ? error.message : "audio playback failed",
          "local",
          "coral",
        );
      });
    this.callbacks.onSignals({
      listening: true,
      modelSpeaking: true,
    });
    if (this.outputChunks === 1 || this.outputChunks % 5 === 0) {
      this.callbacks.onMetrics({ outputChunks: this.outputChunks });
      this.emit(
        "response.audio.delta",
        `chunks=${this.outputChunks} · latest_pcm16≈${Math.round(base64.length * 0.75)}B`,
        "in",
        "amber",
      );
    }
    this.applyServerMetrics(message);
  }

  private drainPlaybackWithoutAck(
    after: Promise<unknown> | null = null,
  ) {
    void (after ?? Promise.resolve())
      .then(() => this.player.drain())
      .then((result) => {
        if (result.underrunMs > 0) {
          this.emit(
            "playback.underrun",
            `${result.underrunMs}ms`,
            "local",
            "amber",
          );
        }
      })
      .catch((error) => {
        this.emit(
          "playback.drain.error",
          error instanceof Error ? error.message : "playback drain failed",
          "local",
          "coral",
        );
      });
  }

  private async drainVllmPlayback(message: JsonMessage) {
    const requestedId =
      this.getResponseId(message) ??
      this.activePlaybackResponseId;
    const knownState = requestedId
      ? this.playbackByResponse.get(requestedId)
      : undefined;
    if (knownState?.drainRequested) return;
    if (knownState) {
      knownState.drainRequested = true;
    } else if (requestedId) {
      this.playbackByResponse.set(requestedId, {
        itemId: String(message.item_id ?? `item_${requestedId}`),
        drainRequested: true,
      });
    }

    try {
      const result = await this.player.drain(requestedId ?? undefined);
      const responseId = result.responseId ?? requestedId;
      const state = responseId
        ? this.playbackByResponse.get(responseId)
        : undefined;
      const playedMs = Math.max(0, Math.round(result.playedMs));
      if (
        !result.cleared &&
        responseId &&
        playedMs > 0 &&
        this.socket?.readyState === WebSocket.OPEN
      ) {
        this.socket.send(
          JSON.stringify({
            type: "playback.ack",
            response_id: responseId,
            item_id: state?.itemId ?? `item_${responseId}`,
            played_ms: playedMs,
            committed_ms: playedMs,
          }),
        );
        this.emit(
          "playback.ack",
          `response_id=${responseId} · committed_ms=${playedMs}`,
          "out",
          "green",
        );
      }
      if (result.underrunMs > 0) {
        this.emit(
          "playback.underrun",
          `response_id=${responseId ?? "—"} · ${result.underrunMs}ms`,
          "local",
          "amber",
        );
      }
      if (responseId) this.playbackByResponse.delete(responseId);
      if (requestedId && requestedId !== responseId) {
        this.playbackByResponse.delete(requestedId);
      }
      if (
        !responseId ||
        this.activePlaybackResponseId === responseId
      ) {
        this.activePlaybackResponseId = null;
      }
      window.setTimeout(() => {
        if (!this.stopped && !this.activePlaybackResponseId) {
          this.callbacks.onSignals({
            listening: true,
            modelSpeaking: false,
          });
        }
      }, ECHO_GUARD_MS);
    } catch (error) {
      if (requestedId) this.playbackByResponse.delete(requestedId);
      if (
        !requestedId ||
        this.activePlaybackResponseId === requestedId
      ) {
        this.activePlaybackResponseId = null;
      }
      this.callbacks.onSignals({
        listening: true,
        modelSpeaking: false,
      });
      this.emit(
        "playback.drain.error",
        error instanceof Error ? error.message : "playback drain failed",
        "local",
        "coral",
      );
    }
  }

  private getResponseId(message: JsonMessage) {
    const value = message.response_id ?? message.response?.id;
    return value === undefined || value === null || value === ""
      ? null
      : String(value);
  }

  private applyServerMetrics(message: JsonMessage) {
    const source =
      typeof message.metrics === "object" && message.metrics
        ? message.metrics
        : message;
    const metrics: Partial<RuntimeMetrics> = {};
    const modelLatency =
      Number(source.wall_clock_ms) || Number(source.generate_ms) || 0;
    if (modelLatency > 0) metrics.modelLatencyMs = modelLatency;
    if (Number(source.generate_ms) > 0) {
      metrics.generateMs = Number(source.generate_ms);
    }
    if (Number(source.kv_cache_length) > 0) {
      metrics.kvCacheLength = Number(source.kv_cache_length);
    }
    if (Number(source.vision_slices) > 0) {
      metrics.visionSlices = Number(source.vision_slices);
    }
    const outputTokens = Number(
      source.generated_tokens ??
        source.output_tokens ??
        source.n_tokens ??
        source.num_tokens_out,
    );
    if (outputTokens > 0) metrics.outputTokens = outputTokens;
    const inputTokens = Number(
      source.input_tokens ??
        source.n_input_tokens ??
        source.num_tokens_in,
    );
    if (inputTokens > 0) metrics.inputTokens = inputTokens;

    const stageMetricsCandidates = [
      message.vllm_omni?.stage_metrics,
      message.metadata?.vllm_omni?.stage_metrics,
      message.response?.vllm_omni?.stage_metrics,
      message.response?.metadata?.vllm_omni?.stage_metrics,
      source.stage_metrics,
    ];
    const stageMap = stageMetricsCandidates.find(
      (candidate) =>
        candidate &&
        typeof candidate === "object" &&
        !Array.isArray(candidate),
    ) as Record<string, JsonMessage> | undefined;
    if (stageMap) {
      const stages = Object.values(stageMap).filter(
        (stage): stage is JsonMessage =>
          stage != null && typeof stage === "object",
      );
      const firstOutputValues = stages
        .map((stage) =>
          Number(
            stage.serving_time_to_first_output_ms ??
              stage.vllm_ttft_ms,
          ),
        )
        .filter((value) => Number.isFinite(value) && value > 0);
      if (firstOutputValues.length > 0) {
        metrics.modelLatencyMs = Math.max(...firstOutputValues);
      }
      const stageGenerateMs = stages.reduce(
        (total, stage) =>
          total +
          (Number.isFinite(Number(stage.stage_gen_time_ms))
            ? Number(stage.stage_gen_time_ms)
            : 0),
        0,
      );
      if (stageGenerateMs > 0) metrics.generateMs = stageGenerateMs;
    }
    if (Object.keys(metrics).length > 0) this.callbacks.onMetrics(metrics);
  }

  private recordOutputArrival(now: number) {
    this.outputArrivalTimes.push(now);
    if (this.outputArrivalTimes.length > 80) this.outputArrivalTimes.shift();
    const gaps: number[] = [];
    for (let index = 1; index < this.outputArrivalTimes.length; index += 1) {
      gaps.push(
        this.outputArrivalTimes[index] - this.outputArrivalTimes[index - 1],
      );
    }
    this.callbacks.onMetrics({ jitterP95Ms: percentile95(gaps) });
  }

  private parseMessage(data: unknown): JsonMessage | null {
    try {
      return JSON.parse(String(data)) as JsonMessage;
    } catch {
      this.emit(
        "protocol.invalid_json",
        "server message was not valid JSON",
        "in",
        "coral",
      );
      return null;
    }
  }

  private emit(
    type: string,
    detail: string,
    direction: "in" | "out" | "local",
    tone?: "blue" | "amber" | "green" | "coral",
    rawType?: string,
  ) {
    this.callbacks.onEvent({
      type,
      detail,
      direction,
      tone,
      rawType,
    });
  }

  private fail(message: string, stopSession = true) {
    this.emit("runtime.error", message, "in", "coral", "error");
    this.callbacks.onError(message);
    if (stopSession) {
      this.ready = false;
      this.mic.stop();
      this.camera.stop();
      this.callbacks.onVideoStream(null);
      this.callbacks.onCameraState("off");
    }
  }

  private closeTurnSocket(reason: string) {
    const socket = this.activeTurnSocket;
    this.activeTurnSocket = null;
    if (!socket) return;
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "session.close", reason }));
    }
    socket.close();
  }

  private resetSessionState() {
    this.stopped = false;
    this.ready = false;
    this.requestStartedAt = 0;
    this.socketOpenedAt = 0;
    this.queueStartedAt = 0;
    this.initSentAt = 0;
    this.inputSentAt = 0;
    this.firstOutputAt = 0;
    this.inputChunks = 0;
    this.outputChunks = 0;
    this.videoFramesSent = 0;
    this.textBuffer = "";
    this.outputArrivalTimes = [];
    this.playbackByResponse.clear();
    this.activePlaybackResponseId = null;
  }
}

export const loadModelBestDefaults = async (
  baseUrl = DEFAULT_MODEL_BEST_BASE,
) => {
  try {
    const response = await fetch(`${baseUrl}/api/frontend_defaults`);
    if (!response.ok) return { playbackDelayMs: 200 };
    const payload = await response.json();
    return {
      playbackDelayMs: Number(payload.playback_delay_ms) || 200,
    };
  } catch {
    return { playbackDelayMs: 200 };
  }
};

export const loadModelBestEta = async (
  baseUrl = DEFAULT_MODEL_BEST_BASE,
) => {
  try {
    const response = await fetch(`${baseUrl}/api/config/eta`);
    if (!response.ok) return null;
    const payload = await response.json();
    return {
      chat: Number(payload.ema_chat_s ?? payload.config?.eta_chat_s) || null,
      audio:
        Number(payload.ema_audio_duplex_s ?? payload.config?.eta_audio_duplex_s) ||
        null,
      video:
        Number(payload.ema_omni_duplex_s ?? payload.config?.eta_omni_duplex_s) ||
        null,
    };
  } catch {
    return null;
  }
};
