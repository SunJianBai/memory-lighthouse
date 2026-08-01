class MiniCpmPcmPlayback extends AudioWorkletProcessor {
  constructor() {
    super();
    // Commands are queued in MessagePort order. A drain marker is therefore a
    // hard response boundary: audio posted after it can never be counted as, or
    // cleared with, the preceding response.
    this.queue = [];
    this.offset = 0;
    this.playedFrames = 0;
    this.underrunFrames = 0;
    this.underruns = 0;
    this.activeResponseId = null;
    this.started = false;
    this.initialBufferFrames = Math.round(sampleRate * 0.4);
    this.bufferWaitFrames = this.initialBufferFrames;
    this.rebuffering = false;
    this.fadeFrames = Math.max(1, Math.round(sampleRate * 0.005));
    this.fadeInFrames = 0;
    this.framesSinceMetrics = 0;
    this.port.onmessage = (event) => this.handleMessage(event.data || {});
  }

  handleMessage(message) {
    if (message.type === "audio" && message.pcm) {
      const pcm =
        message.pcm instanceof Int16Array
          ? message.pcm
          : new Int16Array(message.pcm);
      const hadAudio = this.bufferedFrames() > 0;
      const responseId =
        typeof message.responseId === "string" ? message.responseId : null;
      if (!this.activeResponseId && responseId) {
        this.activeResponseId = responseId;
      }
      if (!this.started && Number.isFinite(message.initialBufferMs)) {
        this.initialBufferFrames = Math.max(
          0,
          Math.round((sampleRate * message.initialBufferMs) / 1000),
        );
      }
      this.queue.push({ type: "audio", pcm, responseId });
      if (!this.started && !hadAudio && !this.rebuffering) {
        this.bufferWaitFrames = this.initialBufferFrames;
      }
      this.publishMetrics(true);
      return;
    }

    if (message.type === "drain") {
      this.queue.push({
        type: "drain",
        requestId: Number.isFinite(message.requestId)
          ? message.requestId
          : null,
        responseId:
          typeof message.responseId === "string"
            ? message.responseId
            : this.activeResponseId,
      });
      if (!this.started && this.framesBeforeNextDrain() > 0) {
        this.bufferWaitFrames = 0;
        this.startPlayback();
      }
      this.consumeLeadingDrains();
      this.publishMetrics(true);
      return;
    }

    if (message.type === "clear") {
      const result = {
        type: "playback-cleared",
        responseId: this.activeResponseId,
        playedMs: Math.round((this.playedFrames * 1000) / sampleRate),
        underrunMs: Math.round((this.underrunFrames * 1000) / sampleRate),
        underruns: this.underruns,
      };
      this.resetAll();
      this.port.postMessage(result);
      this.publishMetrics(true);
    }
  }

  bufferedFrames() {
    let total = 0;
    let firstAudio = true;
    for (const entry of this.queue) {
      if (entry.type !== "audio") continue;
      total += entry.pcm.length - (firstAudio ? this.offset : 0);
      firstAudio = false;
    }
    return total;
  }

  framesBeforeNextDrain() {
    let total = 0;
    let firstAudio = true;
    for (const entry of this.queue) {
      if (entry.type === "drain") break;
      total += entry.pcm.length - (firstAudio ? this.offset : 0);
      firstAudio = false;
    }
    return total;
  }

  hasDrainBoundary() {
    return this.queue.some((entry) => entry.type === "drain");
  }

  remainingFrames() {
    const buffered = this.bufferedFrames();
    if (buffered === 0) return 0;
    return buffered + (this.started ? 0 : this.bufferWaitFrames);
  }

  startPlayback() {
    if (this.started) return;
    const firstAudio = this.queue.find((entry) => entry.type === "audio");
    if (
      !this.activeResponseId &&
      firstAudio &&
      typeof firstAudio.responseId === "string"
    ) {
      this.activeResponseId = firstAudio.responseId;
    }
    this.started = true;
    this.fadeInFrames = this.fadeFrames;
  }

  consumeLeadingDrains() {
    let consumed = false;
    while (this.queue[0] && this.queue[0].type === "drain") {
      const marker = this.queue.shift();
      this.port.postMessage({
        type: "playback-drained",
        requestId: marker.requestId,
        responseId: marker.responseId,
        playedMs: Math.round((this.playedFrames * 1000) / sampleRate),
        underrunMs: Math.round((this.underrunFrames * 1000) / sampleRate),
        underruns: this.underruns,
      });
      this.resetResponse();
      consumed = true;
    }
    return consumed;
  }

  resetResponse() {
    this.playedFrames = 0;
    this.underrunFrames = 0;
    this.activeResponseId = null;
    this.started = false;
    this.bufferWaitFrames = this.initialBufferFrames;
    this.rebuffering = false;
    this.fadeInFrames = 0;
  }

  resetAll() {
    this.queue = [];
    this.offset = 0;
    this.resetResponse();
  }

  publishMetrics(force = false) {
    if (!force && this.framesSinceMetrics < sampleRate / 10) return;
    this.framesSinceMetrics = 0;
    this.port.postMessage({
      type: "playback-metrics",
      bufferMs: Math.round((this.remainingFrames() * 1000) / sampleRate),
      underruns: this.underruns,
    });
  }

  process(_inputs, outputs) {
    const output = outputs[0][0];
    output.fill(0);
    this.framesSinceMetrics += output.length;

    const drainedAtStart = this.consumeLeadingDrains();
    if (drainedAtStart) {
      this.publishMetrics(true);
      return true;
    }
    if (!this.started) {
      if (this.rebuffering && !this.hasDrainBoundary()) {
        this.underrunFrames += output.length;
      }
      const readyFrames = this.framesBeforeNextDrain();
      if (readyFrames > 0 && this.bufferWaitFrames > 0) {
        if (this.hasDrainBoundary()) {
          this.bufferWaitFrames = 0;
        } else {
          this.bufferWaitFrames = Math.max(
            0,
            this.bufferWaitFrames - output.length,
          );
          this.publishMetrics();
          return true;
        }
      }
      if (readyFrames > 0) {
        this.startPlayback();
        this.rebuffering = false;
      }
    }

    if (!this.started) {
      this.publishMetrics();
      return true;
    }

    let target = 0;
    let drained = false;
    while (target < output.length && this.queue.length > 0) {
      if (this.consumeLeadingDrains()) {
        drained = true;
        break;
      }
      const entry = this.queue[0];
      if (!entry || entry.type !== "audio") break;
      const count = Math.min(
        output.length - target,
        entry.pcm.length - this.offset,
      );
      const remainingBeforeBoundary = this.framesBeforeNextDrain();
      const fadeAtBoundary = this.hasDrainBoundary();
      for (let index = 0; index < count; index += 1) {
        let sample = entry.pcm[this.offset + index] / 32768;
        if (this.fadeInFrames > 0) {
          const elapsed = this.fadeFrames - this.fadeInFrames;
          sample *= elapsed / this.fadeFrames;
          this.fadeInFrames -= 1;
        }
        const remainingFrames = remainingBeforeBoundary - index;
        if (fadeAtBoundary && remainingFrames <= this.fadeFrames) {
          sample *=
            this.fadeFrames === 1
              ? 0
              : Math.max(0, (remainingFrames - 1) / (this.fadeFrames - 1));
        }
        output[target + index] = sample;
      }
      target += count;
      this.offset += count;
      this.playedFrames += count;
      if (this.offset >= entry.pcm.length) {
        this.queue.shift();
        this.offset = 0;
      }
      if (this.consumeLeadingDrains()) {
        drained = true;
        break;
      }
    }

    if (target < output.length && !drained) {
      const fadeCount = Math.min(target, this.fadeFrames);
      for (let index = 0; index < fadeCount; index += 1) {
        output[target - fadeCount + index] *=
          (fadeCount - index - 1) / fadeCount;
      }
      this.underrunFrames += output.length - target;
      this.underruns += 1;
      this.started = false;
      this.rebuffering = true;
      this.bufferWaitFrames = this.initialBufferFrames;
      this.fadeInFrames = 0;
    }

    this.publishMetrics();
    return true;
  }
}

registerProcessor("minicpmo-pcm-playback", MiniCpmPcmPlayback);
