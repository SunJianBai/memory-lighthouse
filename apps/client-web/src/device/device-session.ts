import { ApiClient, ApiError } from "../api/api-client";
import {
  clearPersistentIdempotencyNamespace,
  IdempotentCommandRegistry,
} from "../api/idempotent-command";
import type {
  CompanionSessionStartView,
  DeviceContextView,
  DeviceHeartbeatView,
  FamilyContactRequestView,
  ModelConnectionView,
  OccurrenceView,
  RemoteJoinTicketView,
  RemoteSessionView,
} from "../api/types";
import { DeviceCredentialPersistenceError } from "./device-storage-error";

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
  protocolVersion: "NON_EXPORTABLE_V1_ED25519";
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
  recoveryToken: string | null;
  recoveryTokenExpiresAt: string | null;
};

export type ActivationClaim = {
  publicId: string;
  proofType: "QR_SECRET" | "DYNAMIC_CODE";
  proof: string;
};

const publicClient = new ApiClient();
const deviceClient = new ApiClient();
const encoder = new TextEncoder();
const CURRENT_INSTALLATION_PROTOCOL = "NON_EXPORTABLE_V1_ED25519" as const;
const browserUserAgent = (maxLength: number): string => {
  if (typeof navigator === "undefined") return "Browser";
  return navigator.userAgent.slice(0, maxLength) || "Browser";
};

const base64Url = (input: ArrayBuffer | Uint8Array): string => {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const sha256 = async (value: string): Promise<string> =>
  base64Url(await crypto.subtle.digest("SHA-256", encoder.encode(value)));

export const isNonExportableDeviceSigningKey = (key: CryptoKey): boolean =>
  key.type === "private" &&
  key.algorithm.name === "Ed25519" &&
  !key.extractable &&
  key.usages.includes("sign");

export const generateDeviceKeyPair = async (): Promise<CryptoKeyPair> => {
  const pair = (await crypto.subtle.generateKey("Ed25519", false, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  if (
    !isNonExportableDeviceSigningKey(pair.privateKey) ||
    !pair.publicKey.extractable
  ) {
    throw new Error("浏览器未能创建不可导出的设备签名私钥");
  }
  return pair;
};

export const buildDeviceInstallationRegistration = (input: {
  installationPublicKeySpki: string;
  manufacturer: string;
  model: string;
  appVersion: string;
}) => ({
  installationPublicKeySpki: input.installationPublicKeySpki,
  installationKeyAlgorithm: "ED25519" as const,
  keyProtection: "NON_EXPORTABLE_V1" as const,
  platform: "WEB" as const,
  manufacturer: input.manufacturer,
  model: input.model,
  appVersion: input.appVersion,
});

const canonicalProof = (
  action: string,
  fields: Array<[string, string]>,
): Uint8Array => {
  const lines = ["memory-lighthouse.device-proof.v1", `action=${action}`];
  for (const [name, value] of fields) {
    if (value.includes("\n") || value.includes("\r"))
      throw new Error("激活参数格式无效");
    lines.push(`${name}=${value}`);
  }
  return encoder.encode(`${lines.join("\n")}\n`);
};

export const buildDeviceExchangeProof = (input: {
  challengeId: string;
  installationId: string;
  approvedAt: string;
  recoveryToken?: string;
}): Uint8Array =>
  input.recoveryToken
    ? canonicalProof("exchange-recovery", [
        ["challenge-id", input.challengeId],
        ["installation-id", input.installationId],
        ["recovery-token", input.recoveryToken],
      ])
    : canonicalProof("exchange", [
        ["challenge-id", input.challengeId],
        ["installation-id", input.installationId],
        ["approved-at", input.approvedAt],
      ]);

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

export class DeviceVault {
  private database: Promise<IDBDatabase> | null = null;

  get(): Promise<InstallationRecord | null> {
    return this.transaction<InstallationRecord | undefined>(
      "readonly",
      (store) => store.get("current"),
    ).then((record) => record ?? null);
  }

  async put(record: InstallationRecord): Promise<void> {
    await this.transaction("readwrite", (store) => store.put(record));
  }

  async clearCredential(): Promise<void> {
    const record = await this.get();
    if (record) await this.put({ ...record, credential: undefined });
  }

  async clear(): Promise<void> {
    await this.transaction("readwrite", (store) => store.delete("current"));
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
        request.onerror = () =>
          reject(request.error ?? new Error("无法打开设备安全存储"));
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
      let request: IDBRequest<T>;
      try {
        request = operation(transaction.objectStore("installation"));
      } catch (error) {
        transaction.abort();
        reject(error);
        return;
      }
      let requestSucceeded = false;
      let requestResult!: T;
      let operationError: DOMException | null = null;
      request.onsuccess = () => {
        requestSucceeded = true;
        requestResult = request.result;
      };
      request.onerror = () => {
        operationError = request.error;
      };
      transaction.onerror = () => {
        operationError ??= transaction.error;
      };
      transaction.onabort = () =>
        reject(
          transaction.error ??
            operationError ??
            new Error("设备安全存储事务已中止"),
        );
      transaction.oncomplete = () => {
        if (!requestSucceeded) {
          reject(operationError ?? new Error("设备安全存储操作未完成"));
          return;
        }
        resolve(requestResult);
      };
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
  private careCommands:
    | { namespace: string; registry: IdempotentCommandRegistry }
    | undefined;

  async initialize(): Promise<InstallationRecord | null> {
    this.record = await this.loadSecureInstallation();
    this.careCommands = undefined;
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
    const proof =
      input.proofType === "DYNAMIC_CODE"
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
    const result = await publicClient.request<{
      claimed: true;
      challengeId: string;
    }>(`/activation-challenges/${encodeURIComponent(input.publicId)}/claim`, {
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
    });
    return result.challengeId;
  }

  status(challengeId: string): Promise<ActivationStatus> {
    return publicClient.request<ActivationStatus>(
      `/activation-challenges/${challengeId}`,
      { authenticated: false, retryAuthentication: false },
    );
  }

  async exchange(
    challengeId: string,
    approvedAt: string,
    recoveryToken?: string,
  ): Promise<void> {
    const installation = await this.ensureInstallation();
    const signature = await sign(
      installation.privateKey,
      buildDeviceExchangeProof({
        challengeId,
        installationId: installation.installationId,
        approvedAt,
        recoveryToken,
      }),
    );
    const credential = await publicClient.request<DeviceCredential>(
      "/device-credentials/exchange",
      {
        method: "POST",
        body: {
          challengeId,
          installationId: installation.installationId,
          signature,
          ...(recoveryToken ? { recoveryToken } : {}),
        },
        authenticated: false,
        retryAuthentication: false,
      },
    );
    const persisted = { ...installation, credential };
    try {
      await vault.put(persisted);
    } catch (storageError) {
      throw new DeviceCredentialPersistenceError(storageError);
    }
    this.record = persisted;
    deviceClient.setAccessToken(credential.accessToken);
  }

  context(): Promise<DeviceContextView> {
    return this.request<DeviceContextView>("/device/context");
  }

  heartbeat(
    activeCompanionSessionId?: string,
  ): Promise<DeviceHeartbeatView> {
    return this.request("/device/heartbeats", {
      method: "POST",
      body: {
        appVersion: "client-web/0.2.0",
        osVersion: browserUserAgent(64),
        ...(activeCompanionSessionId ? { activeCompanionSessionId } : {}),
      },
    });
  }

  startCompanion(
    mode: "AUDIO" | "AUDIO_VIDEO",
  ): Promise<CompanionSessionStartView> {
    return this.request("/device/companion-sessions", {
      method: "POST",
      headers: { "Idempotency-Key": crypto.randomUUID() },
      body: { mode },
    });
  }

  startModel(companionSessionId: string): Promise<ModelConnectionView> {
    return this.request(
      `/device/companion-sessions/${companionSessionId}/model-sessions`,
      {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: {},
      },
    );
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

  appendUserTranscript(
    modelSessionId: string,
    sequenceNo: number,
    rawText: string,
  ): Promise<unknown> {
    return this.request(`/device/model-sessions/${modelSessionId}/utterances`, {
      method: "POST",
      body: {
        sequenceNo,
        speaker: "USER",
        source: "ASR",
        providerEventId: `web-asr-${crypto.randomUUID()}`,
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

  currentOccurrences(): Promise<OccurrenceView[]> {
    return this.request("/device/occurrences/current");
  }

  confirmOccurrence(
    occurrenceId: string,
    version: number,
    source: "RECIPIENT_BUTTON" | "RECIPIENT_VOICE",
  ): Promise<unknown> {
    return this.deviceCareCommands().execute(
      JSON.stringify([
        "confirm-occurrence",
        this.bindingId,
        occurrenceId,
        version,
        source,
      ]),
      (idempotencyKey) =>
        this.request(`/device/occurrences/${occurrenceId}/confirm`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: {
            version,
            idempotencyKey,
            source,
          },
        }),
    );
  }

  requestFamilyContact(
    source: "RECIPIENT_BUTTON" | "RECIPIENT_VOICE" | "COMPANION_TIMEOUT",
    occurrenceId?: string,
  ): Promise<FamilyContactRequestView> {
    return this.deviceCareCommands().execute(
      JSON.stringify([
        "family-contact",
        this.bindingId,
        source,
        occurrenceId ?? null,
      ]),
      (idempotencyKey) =>
        this.request("/device/family-contact-requests", {
          method: "POST",
          headers: { "Idempotency-Key": idempotencyKey },
          body: { idempotencyKey, source, occurrenceId },
        }),
    );
  }

  endCompanion(companionSessionId: string, reason: string): Promise<unknown> {
    return this.request(
      `/device/companion-sessions/${companionSessionId}/end`,
      {
        method: "POST",
        body: { reason },
      },
    );
  }

  acceptRemote(sessionId: string): Promise<RemoteSessionView> {
    return this.request(`/device/remote-sessions/${sessionId}/accept`, {
      method: "POST",
      body: {},
    });
  }

  declineRemote(sessionId: string): Promise<RemoteSessionView> {
    return this.request(`/device/remote-sessions/${sessionId}/decline`, {
      method: "POST",
      body: {},
    });
  }

  endRemote(sessionId: string): Promise<RemoteSessionView> {
    return this.request(`/device/remote-sessions/${sessionId}/end`, {
      method: "POST",
      body: {},
    });
  }

  remoteTicket(sessionId: string): Promise<RemoteJoinTicketView> {
    return this.request(`/device/remote-sessions/${sessionId}/join-ticket`, {
      method: "POST",
      body: { clientType: "WEB" },
    });
  }

  renewRemoteLease(sessionId: string): Promise<unknown> {
    return this.request(`/device/remote-sessions/${sessionId}/heartbeat`, {
      method: "POST",
      body: {},
    });
  }

  currentRemote(): Promise<RemoteSessionView | null> {
    return this.request("/device/remote-sessions/current");
  }

  async clearCredential(): Promise<void> {
    await vault.clearCredential();
    if (this.record) this.record = { ...this.record, credential: undefined };
    deviceClient.setAccessToken(null);
  }

  private async request<T>(
    path: string,
    options: Parameters<ApiClient["request"]>[1] = {},
  ): Promise<T> {
    if (!this.record?.credential) throw new Error("此浏览器尚未激活为陪伴设备");
    if (
      new Date(this.record.credential.accessTokenExpiresAt).getTime() -
        Date.now() <
      30_000
    ) {
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
      const rotated = await publicClient.request<DeviceCredential>(
        "/device-auth/refresh",
        {
          method: "POST",
          body: { credential: credential.credential, signature },
          authenticated: false,
          retryAuthentication: false,
        },
      );
      const persisted = { ...installation, credential: rotated };
      await vault.put(persisted);
      this.record = persisted;
      deviceClient.setAccessToken(rotated.accessToken);
      return true;
    } catch (error) {
      if (
        error instanceof ApiError &&
        (error.status === 401 ||
          error.status === 403 ||
          [
            "DEVICE_REVOKED",
            "DEVICE_CREDENTIAL_REPLAYED",
            "INVALID_DEVICE_CREDENTIAL",
          ].includes(error.code))
      ) {
        await this.clearCredential();
        return false;
      }
      throw error;
    }
  }

  private async ensureInstallation(): Promise<InstallationRecord> {
    if (
      this.record &&
      this.record.protocolVersion === CURRENT_INSTALLATION_PROTOCOL &&
      isNonExportableDeviceSigningKey(this.record.privateKey)
    ) {
      return this.record;
    }
    if (this.record) {
      clearPersistentIdempotencyNamespace(
        this.deviceCommandNamespace(this.record.installationId),
      );
      await vault.clear();
      this.record = null;
      this.careCommands = undefined;
      deviceClient.setAccessToken(null);
    }
    const existing = await this.loadSecureInstallation();
    if (existing) {
      this.record = existing;
      return existing;
    }
    if (!crypto.subtle)
      throw new Error(
        "当前浏览器不支持设备密钥，请使用最新版 Chrome 或 Android App",
      );
    const pair = await generateDeviceKeyPair();
    const spki = await crypto.subtle.exportKey("spki", pair.publicKey);
    const registered = await publicClient.request<{
      installationId: string;
      keyFingerprint: string;
      serverNonce: string;
    }>("/device-installations", {
      method: "POST",
      body: buildDeviceInstallationRegistration({
        installationPublicKeySpki: base64Url(spki),
        manufacturer:
          typeof navigator === "undefined" ? "Browser" : navigator.vendor || "Browser",
        model: browserUserAgent(100),
        appVersion: "0.2.0",
      }),
      authenticated: false,
      retryAuthentication: false,
    });
    const persisted: InstallationRecord = {
      id: "current",
      protocolVersion: CURRENT_INSTALLATION_PROTOCOL,
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
      ...registered,
    };
    await vault.put(persisted);
    this.record = persisted;
    return persisted;
  }

  private async loadSecureInstallation(): Promise<InstallationRecord | null> {
    const existing = await vault.get();
    if (!existing) return null;
    if (
      existing.protocolVersion === CURRENT_INSTALLATION_PROTOCOL &&
      isNonExportableDeviceSigningKey(existing.privateKey)
    ) {
      return existing;
    }

    // Versions before 0.2.0 created exportable private keys. They cannot be
    // made non-exportable in place, so discard the local installation and
    // require a fresh family-approved activation with a protected key.
    if (typeof existing.installationId === "string") {
      clearPersistentIdempotencyNamespace(
        this.deviceCommandNamespace(existing.installationId),
      );
    }
    await vault.clear();
    return null;
  }

  private deviceCareCommands(): IdempotentCommandRegistry {
    const installationId = this.record?.installationId;
    if (!installationId || !this.record?.credential) {
      throw new Error("此浏览器尚未激活为陪伴设备");
    }
    const namespace = this.deviceCommandNamespace(installationId);
    if (this.careCommands?.namespace === namespace) {
      return this.careCommands.registry;
    }
    const registry = new IdempotentCommandRegistry(undefined, {
      namespace,
      persist: true,
      scope: "device-care",
    });
    this.careCommands = { namespace, registry };
    return registry;
  }

  private deviceCommandNamespace(installationId: string): string {
    return `device:${installationId}`;
  }
}

export const deviceSession = new DeviceSessionManager();
