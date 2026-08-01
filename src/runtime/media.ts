import {
  base64Float32,
  base64ToBytes,
} from "./codecs";

type AudioChunkHandler = (chunk: Float32Array) => void;

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
const OFFICIAL_PLAYBACK_BUFFER_MS = 400;

const workletUrl = (name: string) =>
  new URL(`${import.meta.env.BASE_URL}worklets/${name}`, window.location.href)
    .toString();

const mergeInt16 = (chunks: Int16Array[]) => {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Int16Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
};

// Keep this identical to the official realtime page: each output sample is the
// average of the source interval that maps to it. This provides a small
// anti-aliasing filter when browser capture runs above 16 kHz.
const resampleInt16 = (
  input: Int16Array,
  sourceRate: number,
  targetRate: number,
) => {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const output = new Int16Array(Math.floor(input.length / ratio));
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio);
    const end = Math.max(
      start + 1,
      Math.min(input.length, Math.floor((index + 1) * ratio)),
    );
    let sum = 0;
    for (let source = start; source < end; source += 1) {
      sum += input[source];
    }
    output[index] = sum / (end - start);
  }
  return output;
};

const int16ToFloat32 = (input: Int16Array) => {
  const output = new Float32Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    output[index] =
      input[index] < 0 ? input[index] / 0x8000 : input[index] / 0x7fff;
  }
  return output;
};

const float32ToInt16 = (input: Float32Array) => {
  const output = new Int16Array(input.length);
  for (let index = 0; index < input.length; index += 1) {
    const value = Math.max(-1, Math.min(1, input[index]));
    output[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return output;
};

const base64ToInt16 = (base64: string) => {
  const bytes = base64ToBytes(base64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const output = new Int16Array(Math.floor(bytes.byteLength / 2));
  for (let index = 0; index < output.length; index += 1) {
    output[index] = view.getInt16(index * 2, true);
  }
  return output;
};

export class MicrophoneCapture {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private captureNode: AudioWorkletNode | null = null;
  private sink: GainNode | null = null;
  private flushTimer: number | null = null;
  private pending: Int16Array[] = [];
  private captureRate = INPUT_SAMPLE_RATE;
  private onChunk: AudioChunkHandler = () => {};
  private paused = false;
  private startPromise: Promise<void> | null = null;
  private generation = 0;

  async start(chunkDurationMs: number, onChunk: AudioChunkHandler) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器不支持麦克风采集");
    }
    this.onChunk = onChunk;
    if (
      this.stream?.getAudioTracks().some(
        (track) => track.readyState === "live",
      ) &&
      this.context &&
      this.captureNode
    ) {
      return;
    }
    if (this.startPromise) return this.startPromise;
    if (
      this.stream ||
      this.context ||
      this.captureNode ||
      this.flushTimer !== null
    ) {
      this.stop();
    }
    const generation = ++this.generation;
    const startPromise = this.open(
      generation,
      Math.max(20, chunkDurationMs),
    );
    this.startPromise = startPromise;
    try {
      await startPromise;
    } finally {
      if (this.startPromise === startPromise) this.startPromise = null;
    }
  }

  private async open(generation: number, chunkDurationMs: number) {
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let captureNode: AudioWorkletNode | null = null;
    let sink: GainNode | null = null;
    let flushTimer: number | null = null;
    const cancelled = () => generation !== this.generation;
    const cleanup = () => {
      if (captureNode) {
        captureNode.port.onmessage = null;
        captureNode.disconnect();
      }
      source?.disconnect();
      sink?.disconnect();
      if (flushTimer !== null) window.clearInterval(flushTimer);
      stream?.getTracks().forEach((track) => track.stop());
      void context?.close();
    };
    const assertCurrent = () => {
      if (!cancelled()) return;
      throw new DOMException("Microphone start cancelled", "AbortError");
    };
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          sampleRate: { ideal: INPUT_SAMPLE_RATE },
        },
      });
      assertCurrent();
      try {
        context = new AudioContext({ sampleRate: INPUT_SAMPLE_RATE });
      } catch {
        context = new AudioContext();
      }
      await context.audioWorklet.addModule(workletUrl("pcm-capture.js"));
      assertCurrent();
      source = context.createMediaStreamSource(stream);
      captureNode = new AudioWorkletNode(
        context,
        "minicpmo-pcm-capture",
      );
      captureNode.port.onmessage = (event) => {
        if (cancelled() || this.paused) return;
        const buffer =
          event.data instanceof ArrayBuffer
            ? event.data
            : event.data?.pcm instanceof ArrayBuffer
              ? event.data.pcm
              : null;
        if (buffer) this.pending.push(new Int16Array(buffer));
      };
      sink = context.createGain();
      sink.gain.value = 0;
      source.connect(captureNode);
      captureNode.connect(sink).connect(context.destination);
      await context.resume();
      assertCurrent();
      captureNode.port.postMessage({
        type: "set-paused",
        paused: this.paused,
      });
      flushTimer = window.setInterval(
        () => this.flush(),
        chunkDurationMs,
      );

      // Commit all resources together after the last await. stop() can only
      // observe either the previous generation or this complete graph.
      this.stream = stream;
      this.context = context;
      this.source = source;
      this.captureNode = captureNode;
      this.sink = sink;
      this.captureRate = context.sampleRate;
      this.flushTimer = flushTimer;
      stream = null;
      context = null;
      source = null;
      captureNode = null;
      sink = null;
      flushTimer = null;
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  private flush() {
    if (this.paused || this.pending.length === 0) {
      if (this.paused) this.pending = [];
      return;
    }
    const merged = mergeInt16(this.pending);
    this.pending = [];
    const mono16k = resampleInt16(
      merged,
      this.captureRate,
      INPUT_SAMPLE_RATE,
    );
    if (mono16k.length > 0) this.onChunk(int16ToFloat32(mono16k));
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    if (paused) this.pending = [];
    this.captureNode?.port.postMessage({ type: "set-paused", paused });
  }

  stop() {
    this.generation += 1;
    this.startPromise = null;
    if (this.flushTimer !== null) {
      window.clearInterval(this.flushTimer);
    }
    this.flushTimer = null;
    if (this.captureNode) {
      this.captureNode.port.onmessage = null;
      this.captureNode.disconnect();
    }
    this.source?.disconnect();
    this.sink?.disconnect();
    this.stream?.getTracks().forEach((track) => track.stop());
    void this.context?.close();
    this.stream = null;
    this.context = null;
    this.source = null;
    this.captureNode = null;
    this.sink = null;
    this.pending = [];
    this.captureRate = INPUT_SAMPLE_RATE;
  }
}

export class CameraCapture {
  private stream: MediaStream | null = null;
  private video: HTMLVideoElement | null = null;
  private canvas = document.createElement("canvas");
  private context = this.canvas.getContext("2d");
  private timer: number | null = null;
  private latestFrame: string | null = null;
  private frameCount = 0;
  private startedAt = 0;
  private paused = false;
  private startPromise: Promise<void> | null = null;
  private generation = 0;

  async start(
    onStream: (stream: MediaStream) => void,
    onEnded?: () => void,
  ) {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前浏览器不支持摄像头采集");
    }
    if (this.isActive() && this.stream) {
      onStream(this.stream);
      return;
    }
    if (this.stream) this.stop();
    if (this.startPromise) {
      await this.startPromise;
      if (this.stream) onStream(this.stream);
      return;
    }
    const generation = ++this.generation;
    const startPromise = this.open(generation, onStream, onEnded);
    this.startPromise = startPromise;
    try {
      await startPromise;
    } catch (error) {
      if (generation !== this.generation) return;
      throw error;
    } finally {
      if (this.startPromise === startPromise) this.startPromise = null;
    }
  }

  private async open(
    generation: number,
    onStream: (stream: MediaStream) => void,
    onEnded?: () => void,
  ) {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 15, max: 30 },
      },
    });
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    try {
      await video.play();
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      throw error;
    }
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      video.srcObject = null;
      return;
    }
    this.stream = stream;
    this.video = video;
    stream.getVideoTracks().forEach((track) => {
      track.addEventListener(
        "ended",
        () => {
          if (generation === this.generation) onEnded?.();
        },
        { once: true },
      );
    });
    onStream(stream);
    this.startedAt = performance.now();
    const capture = () => {
      if (
        this.paused ||
        !this.video ||
        !this.context ||
        this.video.readyState < 2
      ) {
        return;
      }
      const width = this.video.videoWidth || 1280;
      const height = this.video.videoHeight || 720;
      this.canvas.width = width;
      this.canvas.height = height;
      this.context.drawImage(this.video, 0, 0, width, height);
      this.latestFrame = this.canvas
        .toDataURL("image/jpeg", 0.7)
        .split(",")[1];
      this.frameCount += 1;
    };
    capture();
    this.timer = window.setInterval(capture, 1000);
  }

  isActive() {
    return Boolean(
      this.stream?.getVideoTracks().some((track) => track.readyState === "live"),
    );
  }

  takeLatestFrame() {
    if (this.paused) return null;
    const frame = this.latestFrame;
    this.latestFrame = null;
    return frame;
  }

  setPaused(paused: boolean) {
    this.paused = paused;
    this.stream?.getVideoTracks().forEach((track) => {
      track.enabled = !paused;
    });
    if (paused) this.latestFrame = null;
  }

  getMeasuredFps() {
    const elapsed = (performance.now() - this.startedAt) / 1000;
    return elapsed > 0 ? this.frameCount / elapsed : 0;
  }

  stop() {
    this.generation += 1;
    this.startPromise = null;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.stream?.getTracks().forEach((track) => track.stop());
    if (this.video) this.video.srcObject = null;
    this.stream = null;
    this.video = null;
    this.timer = null;
    this.latestFrame = null;
    this.frameCount = 0;
    this.paused = false;
  }
}

type PlaybackMetrics = {
  bufferMs: number;
  underruns: number;
};

export type PlaybackDrainResult = {
  responseId: string | null;
  playedMs: number;
  underrunMs: number;
  cleared: boolean;
};

export class PcmPlayer {
  private context: AudioContext | null = null;
  private playbackNode: AudioWorkletNode | null = null;
  private activation: Promise<void> | null = null;
  private muted = false;
  private underruns = 0;
  private bufferMs = 0;
  private estimatedEndAt = 0;
  private initialBufferMs: number;
  private onMetrics: (metrics: PlaybackMetrics) => void;
  private drainSequence = 0;
  private pendingDrains = new Map<
    number,
    {
      responseId: string | null;
      promise: Promise<PlaybackDrainResult>;
      resolve: (result: PlaybackDrainResult) => void;
    }
  >();
  private generation = 0;

  constructor(
    delayMs: number,
    onMetrics: (metrics: PlaybackMetrics) => void,
  ) {
    this.initialBufferMs = Math.max(
      OFFICIAL_PLAYBACK_BUFFER_MS,
      Number.isFinite(delayMs) ? delayMs : OFFICIAL_PLAYBACK_BUFFER_MS,
    );
    this.onMetrics = onMetrics;
  }

  async activate() {
    if (this.context && this.playbackNode && this.context.state !== "closed") {
      if (this.context.state === "suspended") await this.context.resume();
      return;
    }
    if (this.activation) return this.activation;
    const generation = this.generation;
    const activation = this.open(generation);
    this.activation = activation;
    try {
      await activation;
    } finally {
      if (this.activation === activation) this.activation = null;
    }
  }

  private async open(generation: number) {
    let context: AudioContext;
    try {
      context = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    } catch {
      context = new AudioContext();
    }
    try {
      await context.audioWorklet.addModule(workletUrl("pcm-playback.js"));
      if (generation !== this.generation) {
        await context.close();
        return;
      }
      const playbackNode = new AudioWorkletNode(
        context,
        "minicpmo-pcm-playback",
        {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        },
      );
      playbackNode.port.onmessage = (event) =>
        this.handlePlaybackMessage(event.data);
      playbackNode.connect(context.destination);
      this.context = context;
      this.playbackNode = playbackNode;
      await context.resume();
    } catch (error) {
      await context.close().catch(() => undefined);
      throw error;
    }
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (muted) this.stopAll();
  }

  async playFloat32(
    base64: string,
    sampleRate = 24000,
    responseId?: string,
  ) {
    return this.enqueue(
      float32ToInt16(base64Float32(base64)),
      sampleRate,
      responseId,
    );
  }

  async playPcm16(
    base64: string,
    sampleRate = 24000,
    responseId?: string,
  ) {
    return this.enqueue(base64ToInt16(base64), sampleRate, responseId);
  }

  async playEncoded(base64: string, responseId?: string) {
    const generation = this.generation;
    await this.activate();
    if (
      generation !== this.generation ||
      !this.context ||
      this.muted
    ) {
      return 0;
    }
    const bytes = base64ToBytes(base64);
    try {
      const decoded = await this.context.decodeAudioData(
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength,
        ),
      );
      if (generation !== this.generation) return 0;
      return this.enqueue(
        float32ToInt16(decoded.getChannelData(0)),
        decoded.sampleRate,
        responseId,
      );
    } catch {
      if (generation !== this.generation) return 0;
      return this.playFloat32(base64, 24000, responseId);
    }
  }

  private async enqueue(
    samples: Int16Array,
    sampleRate: number,
    responseId?: string,
  ) {
    await this.activate();
    if (
      !this.context ||
      !this.playbackNode ||
      this.muted ||
      samples.length === 0
    ) {
      return 0;
    }
    const pcm =
      sampleRate === this.context.sampleRate
        ? samples
        : resampleInt16(samples, sampleRate, this.context.sampleRate);
    const durationMs = (pcm.length * 1000) / this.context.sampleRate;
    const now = performance.now();
    if (this.estimatedEndAt <= now) {
      this.estimatedEndAt = now + this.initialBufferMs;
    }
    this.estimatedEndAt += durationMs;
    this.bufferMs = Math.max(0, this.estimatedEndAt - now);
    this.playbackNode.port.postMessage(
      {
        type: "audio",
        pcm,
        initialBufferMs: this.initialBufferMs,
        responseId: responseId ?? null,
      },
      [pcm.buffer],
    );
    this.emitMetrics();
    return durationMs;
  }

  private handlePlaybackMessage(message: Record<string, unknown>) {
    if (message.type === "playback-metrics") {
      this.bufferMs = Math.max(0, Number(message.bufferMs) || 0);
      this.underruns = Math.max(0, Number(message.underruns) || 0);
      this.estimatedEndAt = performance.now() + this.bufferMs;
      this.emitMetrics();
      return;
    }
    if (
      message.type === "playback-drained" ||
      message.type === "playback-cleared"
    ) {
      const result: PlaybackDrainResult = {
        responseId:
          typeof message.responseId === "string" ? message.responseId : null,
        playedMs: Math.max(0, Number(message.playedMs) || 0),
        underrunMs: Math.max(0, Number(message.underrunMs) || 0),
        cleared: message.type === "playback-cleared",
      };
      this.bufferMs = 0;
      this.estimatedEndAt = 0;
      this.underruns = Math.max(0, Number(message.underruns) || this.underruns);
      const requestId = Number(message.requestId);
      if (Number.isFinite(requestId)) {
        const pending = this.pendingDrains.get(requestId);
        if (pending) {
          pending.resolve(result);
          this.pendingDrains.delete(requestId);
        }
      }
      this.emitMetrics();
    }
  }

  private emitMetrics() {
    this.onMetrics({
      bufferMs: this.getRemainingMs(),
      underruns: this.underruns,
    });
  }

  getRemainingMs() {
    return Math.max(
      this.bufferMs,
      this.estimatedEndAt > 0
        ? Math.max(0, this.estimatedEndAt - performance.now())
        : 0,
    );
  }

  async drain(responseId?: string): Promise<PlaybackDrainResult> {
    await this.activate();
    if (!this.playbackNode || this.muted) {
      return {
        responseId: responseId ?? null,
        playedMs: 0,
        underrunMs: 0,
        cleared: this.muted,
      };
    }
    const requestId = ++this.drainSequence;
    let resolveDrain!: (result: PlaybackDrainResult) => void;
    const promise = new Promise<PlaybackDrainResult>((resolve) => {
      resolveDrain = resolve;
    });
    this.pendingDrains.set(requestId, {
      responseId: responseId ?? null,
      promise,
      resolve: resolveDrain,
    });
    this.playbackNode.port.postMessage({
      type: "drain",
      requestId,
      responseId: responseId ?? null,
    });
    return promise;
  }

  stopAll() {
    this.playbackNode?.port.postMessage({ type: "clear" });
    this.resolveAllDrains(true);
    this.bufferMs = 0;
    this.estimatedEndAt = 0;
    this.emitMetrics();
  }

  private resolveAllDrains(cleared: boolean) {
    for (const pending of this.pendingDrains.values()) {
      pending.resolve({
        responseId: pending.responseId,
        playedMs: 0,
        underrunMs: 0,
        cleared,
      });
    }
    this.pendingDrains.clear();
  }

  stop() {
    this.generation += 1;
    this.stopAll();
    if (this.playbackNode) {
      this.playbackNode.port.onmessage = null;
      this.playbackNode.disconnect();
    }
    void this.context?.close();
    this.context = null;
    this.playbackNode = null;
    this.activation = null;
  }
}
