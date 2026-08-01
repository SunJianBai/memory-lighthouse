import { createDemoState } from "../domain/demo-data";
import type { AppState, AssetKind, StoredAsset } from "../domain/types";

export const STORAGE_KEY = "memory-lighthouse.state.v1";
const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const hasString = (value: Record<string, unknown>, key: string) =>
  typeof value[key] === "string";

export const isAppState = (value: unknown): value is AppState => {
  if (!isRecord(value)) return false;
  const candidate = value as Partial<AppState> & Record<string, unknown>;
  const recipient = candidate.recipient;
  const consent = candidate.consent;
  const provider = candidate.provider;
  return (
    candidate.schemaVersion === 1 &&
    typeof candidate.initialized === "boolean" &&
    isRecord(recipient) &&
    hasString(recipient, "id") &&
    hasString(recipient, "name") &&
    hasString(recipient, "preferredName") &&
    hasString(recipient, "communicationNotes") &&
    Array.isArray(candidate.trustedPeople) &&
    Array.isArray(candidate.medications) &&
    Array.isArray(candidate.routines) &&
    Array.isArray(candidate.memories) &&
    Array.isArray(candidate.assets) &&
    Array.isArray(candidate.events) &&
    isRecord(consent) &&
    [
      "localStorageApproved",
      "cameraApproved",
      "microphoneApproved",
      "sensitiveMemoryApproved",
      "cloudProcessingApproved",
    ].every(
      (key) =>
        typeof (consent as unknown as Record<string, unknown>)[key] ===
        "boolean",
    ) &&
    isRecord(provider) &&
    ["local", "cloud", "replay"].includes(String(provider.provider)) &&
    [
      "localRealtimeWs",
      "localChatHttp",
      "cloudRealtimeWs",
      "cloudBaseUrl",
      "model",
    ].every((key) => hasString(provider, key))
  );
};

export const loadAppState = (): AppState => {
  if (typeof window === "undefined") return createDemoState();
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) return createDemoState();
  try {
    const parsed: unknown = JSON.parse(raw);
    return isAppState(parsed) ? parsed : createDemoState();
  } catch {
    return createDemoState();
  }
};

export const saveAppState = (state: AppState) => {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  window.dispatchEvent(new CustomEvent("memory-lighthouse:state"));
};

export const clearSavedAppState = () => {
  window.localStorage.removeItem(STORAGE_KEY);
};

export const resetAppState = () => {
  const state = createDemoState();
  saveAppState(state);
  return state;
};

export const exportAppState = (state: AppState) => {
  const safeState: AppState = {
    ...state,
    provider: {
      ...state.provider,
      referenceAudio: undefined,
    },
  };
  const blob = new Blob([JSON.stringify(safeState, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `memory-lighthouse-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
};

export const importAppState = async (file: File): Promise<AppState> => {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("导入文件不能超过 8MB");
  }
  const parsed: unknown = JSON.parse(await file.text());
  if (!isAppState(parsed)) {
    throw new Error("文件不是有效的守忆灯塔数据包");
  }
  return parsed;
};

const fileToDataUrl = (file: File) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("文件读取失败"));
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });

const optimizeImage = async (file: File) => {
  const source = await fileToDataUrl(file);
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("图片无法打开"));
    image.src = source;
  });
  const maxEdge = 960;
  const scale = Math.min(1, maxEdge / Math.max(image.width, image.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("浏览器无法处理图片");
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
};

export const prepareAsset = async (
  file: File,
  kind: AssetKind,
): Promise<StoredAsset> => {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error("单个文件不能超过 8MB");
  }
  const expectsImage = kind !== "voice" && kind !== "document";
  if (expectsImage && !file.type.startsWith("image/")) {
    throw new Error("此处需要上传图片文件");
  }
  if (kind === "voice" && !file.type.startsWith("audio/")) {
    throw new Error("参考声音需要上传音频文件");
  }
  const dataUrl = file.type.startsWith("image/")
    ? await optimizeImage(file)
    : await fileToDataUrl(file);
  return {
    id: crypto.randomUUID(),
    kind,
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    dataUrl,
    createdAt: new Date().toISOString(),
  };
};
