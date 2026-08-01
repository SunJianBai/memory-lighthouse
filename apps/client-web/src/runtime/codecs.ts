const bytesToBase64 = (bytes: Uint8Array) => {
  let binary = "";
  const block = 0x8000;
  for (let index = 0; index < bytes.length; index += block) {
    binary += String.fromCharCode(
      ...bytes.subarray(index, Math.min(index + block, bytes.length)),
    );
  }
  return btoa(binary);
};

export const arrayBufferToBase64 = (buffer: ArrayBufferLike) =>
  bytesToBase64(new Uint8Array(buffer));

export const base64ToBytes = (base64: string) => {
  const clean = base64.includes(",") ? base64.split(",").pop() ?? "" : base64;
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const float32ToBase64 = (samples: Float32Array) =>
  arrayBufferToBase64(
    samples.buffer.slice(
      samples.byteOffset,
      samples.byteOffset + samples.byteLength,
    ),
  );

export const pcm16ToBase64 = (samples: Float32Array) => {
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  return arrayBufferToBase64(pcm.buffer);
};

export const base64Float32 = (base64: string) => {
  const bytes = base64ToBytes(base64);
  const aligned = bytes.byteOffset % 4 === 0
    ? bytes
    : new Uint8Array(bytes);
  return new Float32Array(
    aligned.buffer,
    aligned.byteOffset,
    Math.floor(aligned.byteLength / 4),
  ).slice();
};

export const base64Pcm16 = (base64: string) => {
  const bytes = base64ToBytes(base64);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const output = new Float32Array(Math.floor(bytes.byteLength / 2));
  for (let index = 0; index < output.length; index += 1) {
    output[index] = view.getInt16(index * 2, true) / 0x8000;
  }
  return output;
};

export const resampleLinear = (
  input: Float32Array,
  fromRate: number,
  toRate: number,
) => {
  if (fromRate === toRate) return input.slice();
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const source = index * ratio;
    const left = Math.floor(source);
    const right = Math.min(left + 1, input.length - 1);
    const mix = source - left;
    output[index] = input[left] * (1 - mix) + input[right] * mix;
  }
  return output;
};

export const float32Base64ToWavDataUrl = (
  base64: string,
  sampleRate = 16000,
) => {
  const samples = base64Float32(base64);
  const pcm = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    pcm[index] = value < 0 ? value * 0x8000 : value * 0x7fff;
  }
  const buffer = new ArrayBuffer(44 + pcm.byteLength);
  const view = new DataView(buffer);
  const write = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  write(0, "RIFF");
  view.setUint32(4, 36 + pcm.byteLength, true);
  write(8, "WAVE");
  write(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  write(36, "data");
  view.setUint32(40, pcm.byteLength, true);
  new Int16Array(buffer, 44).set(pcm);
  return `data:audio/wav;base64,${arrayBufferToBase64(buffer)}`;
};

export const fileToBase64 = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("读取文件失败"));
    reader.onload = () => {
      const value = String(reader.result ?? "");
      resolve(value.includes(",") ? value.split(",").pop() ?? "" : value);
    };
    reader.readAsDataURL(file);
  });
