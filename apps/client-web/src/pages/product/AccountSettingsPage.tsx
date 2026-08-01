import {
  CheckCircle2,
  Laptop,
  LogOut,
  MailCheck,
  RefreshCw,
  ShieldAlert,
  Smartphone,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiClient, readableError } from "../../api/api-client";
import type { SessionView } from "../../api/types";
import { useAuth } from "../../auth/auth-context";

export const AccountSettingsPage = () => {
  const auth = useAuth();
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const email = auth.user?.identities.find((identity) => identity.type === "EMAIL");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setSessions(await apiClient.request<SessionView[]>("/me/sessions"));
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const sendVerification = async () => {
    if (!email) return;
    setBusy("email");
    setError("");
    try {
      await auth.requestEmailVerification(email.value);
      setMessage("验证邮件已发送。打开链接后，一次性令牌会立即从地址栏清除。 ");
    } catch (sendError) {
      setError(readableError(sendError));
    } finally {
      setBusy("");
    }
  };

  const revoke = async (session: SessionView) => {
    if (session.current || !window.confirm("确认撤销此会话吗？该设备需要重新登录。")) return;
    setBusy(session.id);
    try {
      await apiClient.request(`/me/sessions/${session.id}`, { method: "DELETE" });
      await load();
    } catch (revokeError) {
      setError(readableError(revokeError));
    } finally {
      setBusy("");
    }
  };

  const logoutAll = async () => {
    if (!window.confirm("确认退出所有设备吗？当前页面也会退出。")) return;
    setBusy("all");
    try {
      await auth.logoutAll();
    } catch (logoutError) {
      setError(readableError(logoutError));
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="settings-api-grid">
      <section className="panel-card account-card">
        <div className="panel-heading"><div><p className="eyebrow">身份</p><h2>账号与邮箱</h2></div>{email?.verifiedAt ? <CheckCircle2 aria-hidden="true" size={25} /> : <ShieldAlert aria-hidden="true" size={25} />}</div>
        <dl className="account-details">
          <div><dt>显示名称</dt><dd>{auth.user?.displayName}</dd></div>
          <div><dt>邮箱</dt><dd>{email?.value ?? "未绑定邮箱"}</dd></div>
          <div><dt>验证状态</dt><dd>{email?.verifiedAt ? `已于 ${new Date(email.verifiedAt).toLocaleString("zh-CN")} 验证` : "待验证"}</dd></div>
        </dl>
        {!email?.verifiedAt && email && <button className="primary-button" type="button" disabled={busy === "email"} onClick={() => void sendVerification()}><MailCheck aria-hidden="true" size={19} /> {busy === "email" ? "正在发送…" : "发送验证邮件"}</button>}
        {message && <div className="form-message success" role="status">{message}</div>}
      </section>

      <section className="panel-card sessions-card">
        <div className="panel-heading"><div><p className="eyebrow">安全</p><h2>登录会话</h2></div><button className="icon-button" type="button" disabled={loading} onClick={() => void load()} aria-label="刷新登录会话"><RefreshCw aria-hidden="true" size={19} /></button></div>
        {error && <div className="form-message error" role="alert">{error}</div>}
        <div className="session-list">
          {sessions.map((session) => {
            const Icon = session.clientType === "ANDROID" ? Smartphone : Laptop;
            return <article key={session.id}><span><Icon aria-hidden="true" size={22} /></span><div><strong>{session.clientType === "ANDROID" ? "Android 应用" : "Web 浏览器"} {session.current && <em>当前</em>}</strong><p>{session.userAgent || "未知设备"}</p><small>最近使用：{session.lastUsedAt ? new Date(session.lastUsedAt).toLocaleString("zh-CN") : "尚无记录"}</small></div>{!session.current && <button className="icon-button danger" type="button" disabled={busy === session.id} onClick={() => void revoke(session)} aria-label="撤销此登录会话"><Trash2 aria-hidden="true" size={19} /></button>}</article>;
          })}
        </div>
        <button className="danger-outline-button" type="button" disabled={busy === "all"} onClick={() => void logoutAll()}><LogOut aria-hidden="true" size={18} /> 退出所有设备</button>
      </section>
    </div>
  );
};
