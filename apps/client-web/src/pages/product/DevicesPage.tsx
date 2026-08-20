import {
  CheckCircle2,
  Clock3,
  MonitorSmartphone,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiClient, readableError } from "../../api/api-client";
import type {
  ActivationApprovalDetails,
  ActivationPresentation,
} from "../../api/types";
import { useWorkspace } from "../../workspace/workspace-context";
import {
  createWorkspaceOperationOwner,
  isWorkspaceOperationOwnerCurrent,
  LatestScopedRequest,
  type WorkspaceOperationOwner,
} from "../../workspace/workspace-scope";

type ChallengeStatus = {
  status: string;
  expiresAt: string;
  claimedAt: string | null;
  approvedAt: string | null;
};

const networkSourceLabels: Record<
  ActivationApprovalDetails["claimNetworkSource"],
  string
> = {
  LOCAL_NETWORK: "本地或家庭网络（地址已隐藏）",
  LOOPBACK: "本机测试网络",
  PUBLIC_IPV4: "公网 IPv4（地址已隐藏）",
  PUBLIC_IPV6: "公网 IPv6（地址已隐藏）",
  UNKNOWN: "网络来源未知",
};

export const DevicesPage = () => {
  const workspace = useWorkspace();
  const [challenge, setChallenge] = useState<ActivationPresentation | null>(null);
  const [challengeOwner, setChallengeOwner] =
    useState<WorkspaceOperationOwner | null>(null);
  const [status, setStatus] = useState<ChallengeStatus | null>(null);
  const [approvalDetails, setApprovalDetails] =
    useState<ActivationApprovalDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [bindingBusyId, setBindingBusyId] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState("");
  const [bindingError, setBindingError] = useState("");
  const [message, setMessage] = useState("");
  const currentScopeKey = useRef(workspace.workspaceScopeKey);
  currentScopeKey.current = workspace.workspaceScopeKey;
  const challengePollRequests = useRef(new LatestScopedRequest());

  useEffect(() => {
    challengePollRequests.current.invalidate();
    setChallenge(null);
    setChallengeOwner(null);
    setStatus(null);
    setApprovalDetails(null);
    setBusy(false);
    setBindingBusyId("");
    setCurrentPassword("");
    setError("");
    setBindingError("");
    setMessage("");
  }, [workspace.workspaceScopeKey]);

  const poll = useCallback(async () => {
    if (
      !challenge ||
      !isWorkspaceOperationOwnerCurrent(
        challengeOwner,
        currentScopeKey.current,
      )
    )
      return;
    const polledChallenge = challenge;
    const owner = challengeOwner;
    const request = challengePollRequests.current.begin(
      `${owner.scopeKey}:${polledChallenge.challengeId}`,
    );
    try {
      const next = await apiClient.request<ChallengeStatus>(`/activation-challenges/${polledChallenge.challengeId}`, { authenticated: false, retryAuthentication: false });
      if (
        !challengePollRequests.current.isCurrent(request) ||
        currentScopeKey.current !== owner.scopeKey
      )
        return;
      setStatus(next);
      if (next.status === "CLAIMED") {
        const details = await apiClient.request<ActivationApprovalDetails>(
          `/activation-challenges/${polledChallenge.challengeId}/approval-details`,
        );
        if (
          !challengePollRequests.current.isCurrent(request) ||
          currentScopeKey.current !== owner.scopeKey
        )
          return;
        setApprovalDetails(details);
      } else {
        setApprovalDetails(null);
      }
    } catch (pollError) {
      if (
        challengePollRequests.current.isCurrent(request) &&
        currentScopeKey.current === owner.scopeKey
      ) {
        setError(readableError(pollError));
      }
    }
  }, [challenge, challengeOwner]);

  useEffect(() => {
    if (!challenge || ["CONSUMED", "CANCELLED", "EXPIRED", "ATTEMPTS_EXCEEDED"].includes(status?.status ?? "")) return;
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => window.clearInterval(timer);
  }, [challenge, poll, status?.status]);

  useEffect(() => {
    if (
      status?.status === "CONSUMED" &&
      isWorkspaceOperationOwnerCurrent(
        challengeOwner,
        workspace.workspaceScopeKey,
      )
    ) {
      void workspace.refreshBindings();
    }
  }, [
    challengeOwner,
    status?.status,
    workspace.refreshBindings,
    workspace.workspaceScopeKey,
  ]);

  const createChallenge = async () => {
    if (!workspace.householdId || !workspace.recipientId) return;
    const owner = createWorkspaceOperationOwner(
      workspace.workspaceScopeKey,
      workspace.householdId,
      workspace.recipientId,
    );
    challengePollRequests.current.invalidate();
    setBusy(true);
    setError("");
    try {
      const created = await apiClient.request<ActivationPresentation>(`/households/${owner.householdId}/care-recipients/${owner.recipientId}/activation-challenges`, { method: "POST", body: {} });
      if (currentScopeKey.current !== owner.scopeKey) return;
      setChallenge(created);
      setChallengeOwner(owner);
      setApprovalDetails(null);
      setStatus({ status: "PENDING", expiresAt: created.expiresAt, claimedAt: null, approvedAt: null });
    } catch (createError) {
      if (currentScopeKey.current === owner.scopeKey) {
        setError(readableError(createError));
      }
    } finally {
      if (currentScopeKey.current === owner.scopeKey) setBusy(false);
    }
  };

  const approve = async () => {
    if (
      !challenge ||
      !approvalDetails ||
      !isWorkspaceOperationOwnerCurrent(
        challengeOwner,
        currentScopeKey.current,
      )
    )
      return;
    const owner = challengeOwner;
    const approvedChallenge = challenge;
    const approvedDetails = approvalDetails;
    setBusy(true);
    setError("");
    try {
      await apiClient.request(`/activation-challenges/${approvedChallenge.challengeId}/approve`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: { claimSnapshotToken: approvedDetails.claimSnapshotToken },
      });
      if (currentScopeKey.current !== owner.scopeKey) return;
      await poll();
      if (currentScopeKey.current === owner.scopeKey) {
        await workspace.refreshBindings();
      }
    } catch (approveError) {
      if (currentScopeKey.current === owner.scopeKey) {
        setError(readableError(approveError));
      }
    } finally {
      if (currentScopeKey.current === owner.scopeKey) setBusy(false);
    }
  };

  const cancel = async () => {
    if (
      !challenge ||
      !isWorkspaceOperationOwnerCurrent(
        challengeOwner,
        currentScopeKey.current,
      )
    )
      return;
    const owner = challengeOwner;
    const cancelledChallenge = challenge;
    setBusy(true);
    try {
      await apiClient.request(`/activation-challenges/${cancelledChallenge.challengeId}/cancel`, { method: "POST", body: { reasonCode: "FAMILY_CANCELLED" } });
      if (currentScopeKey.current !== owner.scopeKey) return;
      challengePollRequests.current.invalidate();
      setChallenge(null);
      setChallengeOwner(null);
      setStatus(null);
      setApprovalDetails(null);
    } catch (cancelError) {
      if (currentScopeKey.current === owner.scopeKey) {
        setError(readableError(cancelError));
      }
    } finally {
      if (currentScopeKey.current === owner.scopeKey) setBusy(false);
    }
  };

  const revokeBinding = async (bindingId: string, displayName: string) => {
    if (!workspace.householdId) return;
    const owner = createWorkspaceOperationOwner(
      workspace.workspaceScopeKey,
      workspace.householdId,
      workspace.recipientId,
    );
    if (currentPassword.length === 0) {
      setBindingError("撤销设备前必须重新输入当前密码。");
      return;
    }
    if (!window.confirm(`确认永久撤销陪伴设备“${displayName}”？设备凭据会立即失效。`)) {
      setCurrentPassword("");
      return;
    }
    setBindingBusyId(bindingId);
    setBindingError("");
    setMessage("");
    try {
      await apiClient.request(
        `/households/${owner.householdId}/companion-bindings/${bindingId}`,
        {
          method: "DELETE",
          body: {
            reasonCode: "FAMILY_REVOKED",
            currentPassword,
          },
        },
      );
      if (currentScopeKey.current === owner.scopeKey) {
        await workspace.refreshBindings();
        if (currentScopeKey.current === owner.scopeKey) {
          setMessage(`已撤销设备“${displayName}”。`);
        }
      }
    } catch (revokeError) {
      if (currentScopeKey.current === owner.scopeKey) {
        setBindingError(readableError(revokeError));
      }
    } finally {
      if (currentScopeKey.current === owner.scopeKey) {
        setCurrentPassword("");
        setBindingBusyId("");
      }
    }
  };

  const displayedChallenge = isWorkspaceOperationOwnerCurrent(
    challengeOwner,
    workspace.workspaceScopeKey,
  )
    ? challenge
    : null;

  return (
    <div className="device-page-grid">
      <section className="panel-card activation-panel">
        <div className="panel-heading"><div><p className="eyebrow">设备激活</p><h2>添加陪伴设备</h2></div><QrCode aria-hidden="true" size={25} /></div>
        {!displayedChallenge ? (
          <div className="activation-intro">
            <p>让陪伴设备扫码或输入动态码，然后在这里确认。</p>
            <button className="primary-button" type="button" disabled={busy || !workspace.recipientId} onClick={() => void createChallenge()}>{busy ? "正在生成…" : "生成激活二维码与动态码"}</button>
          </div>
        ) : (
          <div className="activation-challenge">
            <div className="qr-surface" aria-label="陪伴设备激活二维码"><QRCodeSVG value={displayedChallenge.qrPayload} size={190} level="M" marginSize={2} /></div>
            <div className="activation-code-block">
              <small>动态激活码</small>
              <strong>{displayedChallenge.dynamicCode}</strong>
              <span>公开编号：{displayedChallenge.publicId}</span>
              <time dateTime={displayedChallenge.expiresAt}>有效至 {new Date(displayedChallenge.expiresAt).toLocaleTimeString("zh-CN")}</time>
            </div>
            <div className={`activation-status status-${status?.status.toLowerCase()}`} role="status">
              {status?.status === "CLAIMED" ? <Clock3 aria-hidden="true" size={21} /> : status?.status === "APPROVED" || status?.status === "CONSUMED" ? <CheckCircle2 aria-hidden="true" size={21} /> : ["EXPIRED", "CANCELLED", "ATTEMPTS_EXCEEDED"].includes(status?.status ?? "") ? <XCircle aria-hidden="true" size={21} /> : <RefreshCw aria-hidden="true" size={21} />}
              <div><strong>{status?.status === "PENDING" ? "等待设备连接" : status?.status === "CLAIMED" ? "等待你的确认" : status?.status === "APPROVED" ? "正在完成激活" : status?.status === "CONSUMED" ? "激活完成" : `状态：${status?.status}`}</strong><p>确认前请核对要绑定的设备。</p></div>
            </div>
            {status?.status === "CLAIMED" && (
              <div className="activation-approval-details" aria-label="待批准设备信息">
                <div><small>设备</small><strong>{approvalDetails ? [approvalDetails.device.manufacturer, approvalDetails.device.model].filter(Boolean).join(" ") || "未报告型号" : "正在安全读取…"}</strong></div>
                <div><small>平台 / 系统</small><strong>{approvalDetails ? `${approvalDetails.device.platform} / ${approvalDetails.device.osVersion || "未知"}` : "—"}</strong></div>
                <div><small>App 版本</small><strong>{approvalDetails?.device.appVersion || "未知"}</strong></div>
                <div><small>安装密钥算法</small><strong>{approvalDetails?.device.installationKeyAlgorithm || "未知"}</strong></div>
                <div><small>认领时间</small><strong>{approvalDetails ? new Date(approvalDetails.claimedAt).toLocaleString("zh-CN") : "—"}</strong></div>
                <div><small>大致网络来源</small><strong>{approvalDetails ? networkSourceLabels[approvalDetails.claimNetworkSource] : "—"}</strong></div>
                <div><small>安装密钥尾号</small><strong>{approvalDetails ? `…${approvalDetails.device.keyFingerprintSuffix}` : "—"}</strong></div>
              </div>
            )}
            <div className="form-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => void cancel()}>取消本次激活</button>{status?.status === "CLAIMED" && <button className="primary-button" type="button" disabled={busy || !approvalDetails} onClick={() => void approve()}><ShieldCheck aria-hidden="true" size={18} /> {busy ? "正在批准…" : approvalDetails ? "确认上述信息并批准" : "正在读取设备信息…"}</button>}</div>
          </div>
        )}
        {error && <div className="form-message error" role="alert">{error}</div>}
      </section>

      <section className="panel-card binding-panel">
        <div className="panel-heading"><div><p className="eyebrow">已绑定</p><h2>当前家庭设备</h2></div><button className="icon-button" type="button" onClick={() => void workspace.refreshBindings()} aria-label="刷新设备列表"><RefreshCw aria-hidden="true" size={19} /></button></div>
        <label className="reauth-field" htmlFor="binding-current-password">
          当前密码（撤销设备时验证，提交后立即清空）
          <input id="binding-current-password" type="password" autoComplete="current-password" maxLength={128} value={currentPassword} onChange={(event) => { setCurrentPassword(event.target.value); setBindingError(""); }} />
        </label>
        {message && <div className="form-message success" role="status">{message}</div>}
        {bindingError && <div className="form-message error" role="alert">{bindingError}</div>}
        {workspace.bindings.length === 0 ? (
          <div className="compact-empty"><MonitorSmartphone aria-hidden="true" size={30} /><strong>暂无已绑定设备</strong><p>点击上方添加设备。</p></div>
        ) : (
          <div className="binding-list">{workspace.bindings.map((binding) => <article key={binding.id}><span className="device-icon"><MonitorSmartphone aria-hidden="true" size={23} /></span><div><strong>{binding.displayName}</strong><p>陪伴对象：{workspace.recipients.find((item) => item.id === binding.recipientId)?.preferredName ?? binding.recipientId}</p><small>激活于 {new Date(binding.activatedAt).toLocaleString("zh-CN")}</small></div><span className={`status-pill ${binding.status === "ACTIVE" ? "success" : "neutral"}`}>{binding.status}</span>{binding.status !== "REVOKED" && <button className="danger-button compact" type="button" disabled={bindingBusyId === binding.id} onClick={() => void revokeBinding(binding.id, binding.displayName)}><Trash2 aria-hidden="true" size={16} /> {bindingBusyId === binding.id ? "正在撤销…" : "撤销"}</button>}</article>)}</div>
        )}
      </section>
    </div>
  );
};
