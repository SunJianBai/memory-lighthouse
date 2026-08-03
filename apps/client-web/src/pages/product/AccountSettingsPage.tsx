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
import {
  isCompleteEmailVerificationCode,
  normalizeEmailVerificationCode,
} from "../../auth/email-verification-model";

export const AccountSettingsPage = () => {
  const auth = useAuth();
  const [sessions, setSessions] = useState<SessionView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [verificationError, setVerificationError] = useState("");
  const [message, setMessage] = useState("");
  const email = auth.user?.identities.find((identity) => identity.type === "EMAIL");
  const [verificationEmail, setVerificationEmail] = useState(email?.value ?? "");
  const [verificationCode, setVerificationCode] = useState("");

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
  useEffect(() => {
    if (email?.value) setVerificationEmail(email.value);
  }, [email?.value]);

  const sendVerification = async () => {
    if (!verificationEmail.trim()) {
      setVerificationError("请输入需要绑定和验证的邮箱。 ");
      return;
    }
    setBusy("email-send");
    setVerificationError("");
    setMessage("");
    try {
      await auth.requestEmailVerification(verificationEmail);
      setMessage("6 位验证码已发送，请检查收件箱与垃圾邮件。 ");
    } catch (sendError) {
      setVerificationError(readableError(sendError));
    } finally {
      setBusy("");
    }
  };

  const confirmVerification = async () => {
    if (!verificationEmail.trim()) {
      setVerificationError("请输入需要绑定和验证的邮箱。 ");
      return;
    }
    if (!isCompleteEmailVerificationCode(verificationCode)) {
      setVerificationError("请输入邮件中的 6 位数字验证码。 ");
      return;
    }
    setBusy("email-confirm");
    setVerificationError("");
    setMessage("");
    try {
      await auth.confirmEmailVerification(verificationEmail, verificationCode);
      setVerificationCode("");
      setMessage("邮箱验证成功。 ");
    } catch (confirmError) {
      setVerificationError(readableError(confirmError));
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
        {!email?.verifiedAt && (
          <div className="email-verification-panel">
            <label htmlFor="settings-verification-email">需要验证的邮箱</label>
            <input
              id="settings-verification-email"
              type="email"
              autoComplete="email"
              maxLength={320}
              readOnly={Boolean(email)}
              value={verificationEmail}
              onChange={(event) => {
                setVerificationEmail(event.target.value);
                setVerificationError("");
              }}
            />
            {!email && <p className="field-help">当前账号尚未绑定邮箱，发送验证码时会先绑定此邮箱。</p>}
            <div className="email-verification-actions">
              <button className="secondary-button" type="button" disabled={Boolean(busy)} onClick={() => void sendVerification()}><MailCheck aria-hidden="true" size={19} /> {busy === "email-send" ? "正在发送…" : "发送或重发验证码"}</button>
              <input
                className="verification-code-input"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                minLength={6}
                maxLength={6}
                aria-label="6 位邮箱验证码"
                placeholder="6 位验证码"
                value={verificationCode}
                onChange={(event) => {
                  setVerificationCode(normalizeEmailVerificationCode(event.target.value));
                  setVerificationError("");
                }}
              />
              <button className="primary-button" type="button" disabled={Boolean(busy) || !isCompleteEmailVerificationCode(verificationCode)} onClick={() => void confirmVerification()}>{busy === "email-confirm" ? "正在验证…" : "确认验证码"}</button>
            </div>
          </div>
        )}
        {verificationError && <div className="form-message error" role="alert">{verificationError}</div>}
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
