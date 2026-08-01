import { ApiClient, ApiError } from "../api/api-client";
import type {
  CompanionSessionStartView,
  DeviceContextView,
  ModelConnectionView,
  RemoteJoinTicketView,
  RemoteSessionView,
} from "../api/types";

type DeviceCredential = {
  credential: string;
  credentialId: string;
  credentialFamilyId: string;
  bindingId: string;
  householdId: string;
  recipientId: string;
  expiresAt: string;
  accessToken: string;
  accessTokenExpiresAt: string;
  accessTokenExpiresInSeconds: number;
};

type InstallationRecord = {
  id: "current";
  publicKey: CryptoKey;
  privateKey: CryptoKey;
  installationId: string;
  keyFingerprint: string;
  serverNonce: string;
  credential?: DeviceCredential;
};

type ActivationStatus = {
  status: string;
  expiresAt: string;
  claimedAt: string | null;
  approvedAt: string | null;
};

export type ActivationClaim = {
  publicId: string;
  proofType: "QR_SECRET" | "DYNAMIC_CODE";
  proof: string;
};

const publicClient = new ApiClient();
const deviceClient = new ApiClient();
const encoder = new TextEncoder();

const base64Url = (input: ArrayBuffer | Uint8Array): string => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

const sha256 = async (value: string): Promise<string> =>
  base64Url(await crypto.subtle.digest("SHA-256", encoder.encode(value)));

const canonicalProof = (action: string, fields: Array<[string, string]>): Uint8Array => {
  const lines = ["memory-lighthouse.device-proof.v1", `action=${action}`];
  for (const [name, value] of fields) {
    if (value.includes("\n") || value.includes("\r")) throw new Error("激活参数格式无效");
    lines.push(`${name}=${value}`);
  }
  return encoder.encode(`${lines.join("\n")}\n`);
};

const sign = async (key: CryptoKey, message: Uint8Array): Promise<string> =>
  base64Url(
    await crypto.subtle.sign(
      "Ed25519",
      key,
      message.buffer.slice(
        message.byteOffset,
        message.byteOffset + message.byteLength,
      ) as ArrayBuffer,
    ),
  );

class DeviceVault {
  private database: Promise<IDBDatabase> | null = null;

  get(): Promise<InstallationRecord | null> {
    return this.transaction<InstallationRecord | undefined>("readonly", (store) => store.get("current"))
      .then((record) => record ?? null);
  }

  async put(record: InstallationRecord): Promise<void> {
    await this.transaction("readwrite", (store) => store.put(record));
  }

  async clearCredential(): Promise<void> {
    const record = await this.get();
    if (record) await this.put({ ...record, credential: undefined });
  }

  private open(): Promise<IDBDatabase> {
    if (!this.database) {
      this.database = new Promise((resolve, reject) => {
        const request = indexedDB.open("memory-lighthouse-device-vault", 1);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains("installation")) {
            request.result.createObjectStore("installation", { keyPath: "id" });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error("无法打开设备安全存储"));
      });
    }
    return this.database;
  }

  private async transaction<T>(
    mode: IDBTransactionMode,
    operation: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const database = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = database.transaction("installation", mode);
      const request = operation(transaction.objectStore("installation"));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("设备安全存储操作失败"));
    });
  }
}

const vault = new DeviceVault();

export const parseQrActivation = (value: string): ActivationClaim => {
  const url = new URL(value.trim());
  if (url.protocol !== "memory-lighthouse:" || url.hostname !== "activate") {
    throw new Error("这不是守忆灯塔设备激活二维码");
  }
  const publicId = url.searchParams.get("publicId")?.trim();
  const secret = url.searchParams.get("secret")?.trim();
  if (!publicId || !secret) throw new Error("二维码缺少激活信息");
  return { publicId, proofType: "QR_SECRET", proof: secret };
};

export class DeviceSessionManager {
  private record: InstallationRecord | null = null;
  private refreshInFlight: Promise<boolean> | null = null;

  async initialize(): Promise<InstallationRecord | null> {
    this.record = await vault.get();
    deviceClient.setAccessToken(this.record?.credential?.accessToken ?? null);
    deviceClient.setRefreshHandler(() => this.refreshAccessToken());
    return this.record;
  }

  hasCredential(): boolean {
    return Boolean(this.record?.credential);
  }

  get bindingId(): string {
    return this.record?.credential?.bindingId ?? "";
  }

  async claim(input: ActivationClaim): Promise<string> {
    const installation = await this.ensureInstallation();
    const proof = input.proofType === "DYNAMIC_CODE"
      ? input.proof.trim().toUpperCase()
      : input.proof.trim();
    const proofDigest = await sha256(`${input.proofType}\0${proof}`);
    const signature = await sign(
      installation.privateKey,
      canonicalProof("claim", [
        ["public-id", input.publicId],
        ["installation-id", installation.installationId],
        ["server-nonce", installation.serverNonce],
        ["proof-type", input.proofType],
        ["proof-sha256", proofDigest],
      ]),
    );
    const result = await publicClient.request<{ claimed: true; challengeId: string }>(
      `/activation-challenges/${encodeURIComponent(input.publicId)}/claim`,
      {
        method: "POST",
        body: {
          installationId: installation.installationId,
          serverNonce: installation.serverNonce,
          proofType: input.proofType,
          proof,
          signature,
        },
        authenticated: false,
        retryAuthentication: false,
      },
    );
    return result.challengeId;
  }

  status(challengeId: string): Promise<ActivationStatus> {
    return publicClient.request<ActivationStatus>(
      `/activation-challenges/${challengeId}`,
      { authenticated: false, retryAuthentication: false },
    );
  }

  async exchange(challengeId: string, approvedAt: string): Promise<void> {
    const installation = await this.ensureInstallation();
    const signature = await sign(
      installation.privateKey,
      canonicalProof("exchange", [
        ["challenge-id", challengeId],
        ["installation-id", installation.installationId],
        ["approved-at", approvedAt],
      ]),
    );
    const credential = await publicClient.request<DeviceCredential>(
      "/device-credentials/exchange",
      {
        method: "POST",
        body: { challengeId, installationId: installation.installationId, signature },
        authenticated: false,
        retryAuthentication: false,
      },
    );
    this.record = { ...installation, credential };
    await vault.put(this.record);
    deviceClient.setAccessToken(credential.accessToken);
  }

  context(): Promise<DeviceContextView> {
    return this.request<DeviceContextView>("/device/context");
  }

  heartbeat(): Promise<{ online: true; serverTime: string }> {
    return this.request("/device/heartbeats", {
      method: "POST",
      body: { appVersion: "client-web/0.2.0", osVersion: navigator.userAgent.slice(0, 64) },
    });
  }

  startCompanion(mode: "AUDIO" | "AUDIO_VIDEO"): Promise<CompanionSessionStartView> {
    return this.request("/device/companion-sessions", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { mode },
    });
  }

  startModel(companionSessionId: string): Promise<ModelConnectionView> {
    return this.request(`/device/companion-sessions/${companionSessionId}/model-sessions`, {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: {},
    });
  }

  appendAssistantUtterance(
    modelSessionId: string,
    sequenceNo: number,
    rawText: string,
  ): Promise<unknown> {
    return this.request(`/device/model-sessions/${modelSessionId}/utterances`, {
      method: "POST",
      body: {
        sequenceNo,
        speaker: "ASSISTANT",
        source: "MODEL",
        providerEventId: `web-${crypto.randomUUID()}`,
        rawText: rawText.slice(0, 20_000),
        isFinal: true,
        language: "zh-CN",
      },
    });
  }

  appendModelEvent(
    modelSessionId: string,
    eventType:
      | "CONNECTING"
      | "CONNECTED"
      | "QUEUED"
      | "FIRST_RESPONSE"
      | "INTERRUPTED"
      | "PROVIDER_ERROR"
      | "DISCONNECTED",
    errorCode?: string,
  ): Promise<unknown> {
    return this.request(`/device/model-sessions/${modelSessionId}/events`, {
      method: "POST",
      body: {
        eventType,
        errorCode,
        occurredAt: new Date().toISOString(),
      },
    });
  }

  endCompanion(companionSessionId: string, reason: string): Promise<unknown> {
    return this.request(`/device/companion-sessions/${companionSessionId}/end`, {
      method: "POST",
      body: { reason },
    });
  }

  acceptRemote(sessionId: string): Promise<RemoteSessionView> {
    return this.request(`/device/remote-sessions/${sessionId}/accept`, { method: "POST", body: {} });
  }

  declineRemote(sessionId: string): Promise<RemoteSessionView> {
    return this.request(`/device/remote-sessions/${sessionId}/decline`, { method: "POST", body: {} });
  }

  endRemote(sessionId: string): Promise<RemoteSessionView> {
    return this.request(`/device/remote-sessions/${sessionId}/end`, { method: "POST", body: {} });
  }

  remoteTicket(sessionId: string): Promise<RemoteJoinTicketView> {
    return this.request(`/device/remote-sessions/${sessionId}/join-ticket`, {
      method: "POST",
      body: { clientType: "WEB" },
    });
  }

  renewRemoteLease(sessionId: string): Promise<unknown> {
    return this.request(`/device/remote-sessions/${sessionId}/heartbeat`, { method: "POST", body: {} });
  }

  currentRemote(): Promise<RemoteSessionView | null> {
    return this.request("/device/remote-sessions/current");
  }

  async clearCredential(): Promise<void> {
    await vault.clearCredential();
    if (this.record) this.record = { ...this.record, credential: undefined };
    deviceClient.setAccessToken(null);
  }

  private async request<T>(path: string, options: Parameters<ApiClient["request"]>[1] = {}): Promise<T> {
    if (!this.record?.credential) throw new Error("此浏览器尚未激活为陪伴设备");
    if (new Date(this.record.credential.accessTokenExpiresAt).getTime() - Date.now() < 30_000) {
      const refreshed = await this.refreshAccessToken();
      if (!refreshed) throw new Error("设备凭据已失效，请重新激活");
    }
    return deviceClient.request<T>(path, options);
  }

  private async refreshAccessToken(): Promise<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.rotateCredential().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  private async rotateCredential(): Promise<boolean> {
    const installation = this.record;
    const credential = installation?.credential;
    if (!installation || !credential) return false;
    try {
      const credentialDigest = await sha256(credential.credential);
      const signature = await sign(
        installation.privateKey,
        canonicalProof("refresh", [
          ["credential-id", credential.credentialId],
          ["binding-id", credential.bindingId],
          ["credential-sha256", credentialDigest],
        ]),
      );
      const rotated = await publicClient.request<DeviceCredential>("/device-auth/refresh", {
        method: "POST",
        body: { credential: credential.credential, signature },
        authenticated: false,
        retryAuthentication: false,
      });
      this.record = { ...installation, credential: rotated };
      await vault.put(this.record);
      deviceClient.setAccessToken(rotated.accessToken);
      return true;
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 401 ||
          error.status === 403 ||
          ["DEVICE_REVOKED", "DEVICE_CREDENTIAL_REPLAYED", "INVALID_DEVICE_CREDENTIAL"].includes(error.code))
      ) {
        await this.clearCredential();
        return false;
      }
      throw error;
    }
  }

  private async ensureInstallation(): Promise<InstallationRecord> {
    if (this.record) return this.record;
    const existing = await vault.get();
    if (existing) {
      this.record = existing;
      return existing;
    }
    if (!crypto.subtle) throw new Error("当前浏览器不支持设备密钥，请使用最新版 Chrome 或 Android App");
    const pair = (await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"])) as CryptoKeyPair;
    const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
    const registered = await publicClient.request<{
      installationId: string;
      keyFingerprint: string;
      serverNonce: string;
    }>("/device-installations", {
      method: "POST",
      body: {
        installationPublicKeySpki: base64Url(spki),
        platform: "WEB",
        manufacturer: navigator.vendor || "Browser",
        model: navigator.userAgent.slice(0, 100),
        appVersion: "0.2.0",
      },
      authenticated: false,
      retryAuthentication: false,
    });
    this.record = {
      id: "current",
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      ...registered,
    };
    await vault.put(this.record);
    return this.record;
  }
}

export const deviceSession = new DeviceSessionManager();
