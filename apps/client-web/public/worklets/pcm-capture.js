class MiniCpmPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.paused = false;
    this.port.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === "set-paused") {
        this.paused = Boolean(message.paused);
      }
    };
  }

  process(inputs) {
    if (this.paused) return true;
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) return true;
    const pcm = new Int16Array(channel.length);
    for (let index = 0; index < channel.length; index += 1) {
      const sample = Math.max(-1, Math.min(1, channel[index]));
      pcm[index] = sample < 0 ? sample * 32768 : sample * 32767;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    return true;
  }
}

registerProcessor("minicpmo-pcm-capture", MiniCpmPcmCapture);
