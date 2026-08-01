import {
  CheckCircle2,
  Clock3,
  MonitorSmartphone,
  QrCode,
  RefreshCw,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useCallback, useEffect, useState } from "react";
import { apiClient, readableError } from "../../api/api-client";
import type { ActivationPresentation } from "../../api/types";
import { useWorkspace } from "../../workspace/workspace-context";

type ChallengeStatus = {
  status: string;
  expiresAt: string;
  claimedAt: string | null;
  approvedAt: string | null;
};

export const DevicesPage = () => {
  const workspace = useWorkspace();
  const [challenge, setChallenge] = useState<ActivationPresentation | null>(null);
  const [status, setStatus] = useState<ChallengeStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const poll = useCallback(async () => {
    if (!challenge) return;
    try {
      const next = await apiClient.request<ChallengeStatus>(`/activation-challenges/${challenge.challengeId}`, { authenticated: false, retryAuthentication: false });
      setStatus(next);
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
      setStatus({ status: "PENDING", expiresAt: created.expiresAt, claimedAt: null, approvedAt: null });
    } catch (createError) {
      setError(readableError(createError));
    } finally {
      setBusy(false);
    }
  };

  const approve = async () => {
    if (!challenge) return;
    setBusy(true);
    setError("");
    try {
      await apiClient.request(`/activation-challenges/${challenge.challengeId}/approve`, { method: "POST", body: {} });
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
    } catch (cancelError) {
      setError(readableError(cancelError));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="device-page-grid">
      <section className="panel-card activation-panel">
        <div className="panel-heading"><div><p className="eyebrow">两阶段激活</p><h2>添加陪伴设备</h2></div><QrCode aria-hidden="true" size={25} /></div>
        {!challenge ? (
          <div className="activation-intro">
            <p>生成后，可让陪伴设备扫描二维码，或输入公开编号与 8 位动态码。设备 Claim 后仍不能访问家庭数据，必须由你再次批准。</p>
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
              <div><strong>{status?.status === "PENDING" ? "等待设备 Claim" : status?.status === "CLAIMED" ? "设备已证明持有安装私钥，等待你的批准" : status?.status === "APPROVED" ? "已批准，等待设备兑换凭据" : status?.status === "CONSUMED" ? "激活完成" : `状态：${status?.status}`}</strong><p>批准前请确认屏幕前正是要绑定的陪伴设备。</p></div>
            </div>
            <div className="form-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => void cancel()}>取消本次激活</button>{status?.status === "CLAIMED" && <button className="primary-button" type="button" disabled={busy} onClick={() => void approve()}><ShieldCheck aria-hidden="true" size={18} /> {busy ? "正在批准…" : "确认并批准设备"}</button>}</div>
          </div>
        )}
        {error && <div className="form-message error" role="alert">{error}</div>}
      </section>

      <section className="panel-card binding-panel">
        <div className="panel-heading"><div><p className="eyebrow">已绑定</p><h2>当前家庭设备</h2></div><button className="icon-button" type="button" onClick={() => void workspace.refreshBindings()} aria-label="刷新设备列表"><RefreshCw aria-hidden="true" size={19} /></button></div>
        {workspace.bindings.length === 0 ? (
          <div className="compact-empty"><MonitorSmartphone aria-hidden="true" size={30} /><strong>暂无已绑定设备</strong><p>完成 Claim、家属批准和凭据兑换后显示在这里。</p></div>
        ) : (
          <div className="binding-list">{workspace.bindings.map((binding) => <article key={binding.id}><span className="device-icon"><MonitorSmartphone aria-hidden="true" size={23} /></span><div><strong>{binding.displayName}</strong><p>陪伴对象：{workspace.recipients.find((item) => item.id === binding.recipientId)?.preferredName ?? binding.recipientId}</p><small>激活于 {new Date(binding.activatedAt).toLocaleString("zh-CN")}</small></div><span className={`status-pill ${binding.status === "ACTIVE" ? "success" : "neutral"}`}>{binding.status}</span></article>)}</div>
        )}
      </section>
    </div>
  );
};
