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
import { useCallback, useEffect, useState } from "react";
import { apiClient, readableError } from "../../api/api-client";
import type {
  ActivationApprovalDetails,
  ActivationPresentation,
} from "../../api/types";
import { useWorkspace } from "../../workspace/workspace-context";

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
  const [status, setStatus] = useState<ChallengeStatus | null>(null);
  const [approvalDetails, setApprovalDetails] =
    useState<ActivationApprovalDetails | null>(null);
  const [busy, setBusy] = useState(false);
  const [bindingBusyId, setBindingBusyId] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [error, setError] = useState("");
  const [bindingError, setBindingError] = useState("");
  const [message, setMessage] = useState("");

  const poll = useCallback(async () => {
    if (!challenge) return;
    try {
      const next = await apiClient.request<ChallengeStatus>(`/activation-challenges/${challenge.challengeId}`, { authenticated: false, retryAuthentication: false });
      setStatus(next);
      if (next.status === "CLAIMED") {
        const details = await apiClient.request<ActivationApprovalDetails>(
          `/activation-challenges/${challenge.challengeId}/approval-details`,
        );
        setApprovalDetails(details);
      } else {
        setApprovalDetails(null);
      }
    } catch (pollError) {
      setError(readableError(pollError));
    }
  }, [challenge]);

  useEffect(() => {
    if (!challenge || ["CONSUMED", "CANCELLED", "EXPIRED", "ATTEMPTS_EXCEEDED"].includes(status?.status ?? "")) return;
    const timer = window.setInterval(() => void poll(), 2_000);
    return () => window.clearInterval(timer);
  }, [challenge, poll, status?.status]);

  useEffect(() => {
    if (status?.status === "CONSUMED") void workspace.refreshBindings();
  }, [status?.status, workspace.refreshBindings]);

  const createChallenge = async () => {
    if (!workspace.householdId || !workspace.recipientId) return;
    setBusy(true);
    setError("");
    try {
      const created = await apiClient.request<ActivationPresentation>(`/households/${workspace.householdId}/care-recipients/${workspace.recipientId}/activation-challenges`, { method: "POST", body: {} });
      setChallenge(created);
      setApprovalDetails(null);
      setStatus({ status: "PENDING", expiresAt: created.expiresAt, claimedAt: null, approvedAt: null });
    } catch (createError) {
      setError(readableError(createError));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!challenge || !approvalDetails) return;
    setBusy(true);
    setError("");
    try {
      await apiClient.request(`/activation-challenges/${challenge.challengeId}/approve`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: { claimSnapshotToken: approvalDetails.claimSnapshotToken },
      });
      await poll();
      await workspace.refreshBindings();
    } catch (approveError) {
      setError(readableError(approveError));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    if (!challenge) return;
    setBusy(true);
    try {
      await apiClient.request(`/activation-challenges/${challenge.challengeId}/cancel`, { method: "POST", body: { reasonCode: "FAMILY_CANCELLED" } });
      setChallenge(null);
      setStatus(null);
      setApprovalDetails(null);
    } catch (cancelError) {
      setError(readableError(cancelError));
    } finally {
      setBusy(false);
    }
  };

  const revokeBinding = async (bindingId: string, displayName: string) => {
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
        `/households/${workspace.householdId}/companion-bindings/${bindingId}`,
        {
          method: "DELETE",
          body: {
            reasonCode: "FAMILY_REVOKED",
            currentPassword,
          },
        },
      );
      await workspace.refreshBindings();
      setMessage(`已撤销设备“${displayName}”。`);
    } catch (revokeError) {
      setBindingError(readableError(revokeError));
    } finally {
      setCurrentPassword("");
      setBindingBusyId("");
    }
  };

  return (
    <div className="device-page-grid">
      <section className="panel-card activation-panel">
        <div className="panel-heading"><div><p className="eyebrow">设备激活</p><h2>添加陪伴设备</h2></div><QrCode aria-hidden="true" size={25} /></div>
        {!challenge ? (
          <div className="activation-intro">
            <p>让陪伴设备扫码或输入动态码，然后在这里确认。</p>
            <button className="primary-button" type="button" disabled={busy || !workspace.recipientId} onClick={() => void createChallenge()}>{busy ? "正在生成…" : "生成激活二维码与动态码"}</button>
          </div>
        ) : (
          <div className="activation-challenge">
            <div className="qr-surface" aria-label="陪伴设备激活二维码"><QRCodeSVG value={challenge.qrPayload} size={190} level="M" marginSize={2} /></div>
            <div className="activation-code-block">
              <small>动态激活码</small>
              <strong>{challenge.dynamicCode}</strong>
              <span>公开编号：{challenge.publicId}</span>
              <time dateTime={challenge.expiresAt}>有效至 {new Date(challenge.expiresAt).toLocaleTimeString("zh-CN")}</time>
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
