import {
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeOff,
  KeyRound,
  LockKeyhole,
  Mail,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { apiClient, readableError } from "../../api/api-client";
import { navigate } from "../../app/navigation";
import { useAuth } from "../../auth/auth-context";
import { BrandMark } from "../../components/BrandMark";

type AuthMode =
  | "login"
  | "register"
  | "forgot-password"
  | "reset-password"
  | "verify-email";

type AuthPageProps = {
  mode: AuthMode;
  token?: string;
  returnToInvitation?: boolean;
};

const modeCopy: Record<AuthMode, { title: string; description: string }> = {
  login: { title: "欢迎回来", description: "登录后进入家属工作区或已激活的陪伴设备模式。" },
  register: { title: "创建守忆灯塔账号", description: "邮箱验证后才能创建家庭和激活陪伴设备。" },
  "forgot-password": { title: "重置密码", description: "输入邮箱或用户名，我们会发送一次性重置链接。" },
  "reset-password": { title: "设置新密码", description: "此链接只能使用一次；提交后其他会话将失效。" },
  "verify-email": { title: "验证邮箱", description: "验证成功后即可创建家庭、添加陪伴对象和激活设备。" },
};

export const AuthPage = ({ mode, token, returnToInvitation }: AuthPageProps) => {
  const auth = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    setError("");
    setSuccess("");
    setPassword("");
  }, [mode]);

  const finishAuthentication = () => {
    navigate(returnToInvitation ? "accept-invitation" : "workspace-overview");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (mode === "login") {
        await auth.login(identifier.trim(), password);
        finishAuthentication();
      } else if (mode === "register") {
        await auth.register({
          email: email.trim(),
          username: username.trim() || undefined,
          displayName: displayName.trim() || undefined,
          password,
        });
        setSuccess("账号已创建。请前往邮箱完成验证；当前仍可进入账号设置。 ");
      } else if (mode === "forgot-password") {
        await apiClient.request<{ accepted: true }>("/auth/password-resets", {
          method: "POST",
          body: { identifier: identifier.trim() },
          authenticated: false,
          retryAuthentication: false,
        });
        setSuccess("如果账号可用，重置邮件已经发送。请检查收件箱与垃圾邮件。 ");
      } else if (mode === "reset-password") {
        if (!token) throw new Error("重置链接缺少一次性令牌，请重新申请");
        await apiClient.request("/auth/password-resets/confirm", {
          method: "POST",
          body: { token, newPassword: password },
          authenticated: false,
          retryAuthentication: false,
        });
        setSuccess("密码已更新，请使用新密码登录。 ");
      } else {
        if (!token) throw new Error("验证链接缺少一次性令牌，请重新发送");
        await apiClient.request("/auth/email-verifications/confirm", {
          method: "POST",
          body: { token },
          authenticated: false,
          retryAuthentication: false,
        });
        if (auth.status === "authenticated") await auth.refreshUser();
        setSuccess("邮箱验证成功，现在可以创建家庭和激活设备。 ");
      }
    } catch (submitError) {
      setError(readableError(submitError));
    } finally {
      setBusy(false);
    }
  };

  const needsPassword = ["login", "register", "reset-password"].includes(mode);

  return (
    <main id="main-content" className="auth-page" tabIndex={-1}>
      <section className="auth-story" aria-label="守忆灯塔安全说明">
        <button className="brand-button" type="button" onClick={() => navigate("home")}>
          <BrandMark />
        </button>
        <div>
          <p className="eyebrow">一个账号 · 两个清晰工作区</p>
          <h1>家属负责授权，陪伴设备只使用激活后的设备身份。</h1>
          <p>前端切换只改变页面；家庭、记忆、摄像头与麦克风权限都由服务器核验。</p>
        </div>
        <ul>
          <li><ShieldCheck aria-hidden="true" size={20} /> 家属远程通话不录音、不转写</li>
          <li><LockKeyhole aria-hidden="true" size={20} /> Web 刷新令牌仅放在 HttpOnly Cookie</li>
          <li><KeyRound aria-hidden="true" size={20} /> 一次性链接打开后立即从地址栏清除</li>
        </ul>
      </section>

      <section className="auth-form-card">
        <button className="text-button auth-back" type="button" onClick={() => navigate("home")}>
          <ArrowLeft aria-hidden="true" size={18} /> 返回首页
        </button>
        <div className="auth-heading">
          <span className="auth-icon"><UserRound aria-hidden="true" size={25} /></span>
          <h2>{modeCopy[mode].title}</h2>
          <p>{modeCopy[mode].description}</p>
        </div>

        <form className="stack-form" onSubmit={(event) => void submit(event)}>
          {mode === "register" && (
            <>
              <label htmlFor="register-email">邮箱 <span aria-hidden="true">*</span></label>
              <div className="input-with-icon">
                <Mail aria-hidden="true" size={19} />
                <input id="register-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
              <p className="field-help">创建家庭与激活设备前必须完成邮箱验证。</p>

              <label htmlFor="register-username">用户名（可选）</label>
              <input id="register-username" minLength={3} maxLength={32} autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />

              <label htmlFor="register-name">显示名称（可选）</label>
              <input id="register-name" maxLength={100} autoComplete="name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </>
          )}

          {(mode === "login" || mode === "forgot-password") && (
            <>
              <label htmlFor="auth-identifier">邮箱或用户名</label>
              <input id="auth-identifier" autoComplete="username" minLength={3} required value={identifier} onChange={(event) => setIdentifier(event.target.value)} />
            </>
          )}

          {needsPassword && (
            <>
              <label htmlFor="auth-password">{mode === "reset-password" ? "新密码" : "密码"}</label>
              <div className="password-field">
                <input
                  id="auth-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={10}
                  maxLength={128}
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "隐藏密码" : "显示密码"}>
                  {showPassword ? <EyeOff aria-hidden="true" size={20} /> : <Eye aria-hidden="true" size={20} />}
                </button>
              </div>
              {mode !== "login" && <p className="field-help">至少 10 个字符，请勿使用其他网站相同的密码。</p>}
            </>
          )}

          {error && <div className="form-message error" role="alert">{error}</div>}
          {success && <div className="form-message success" role="status">{success}</div>}

          <button className="primary-button full-width" type="submit" disabled={busy || ((mode === "verify-email" || mode === "reset-password") && !token)}>
            {busy ? "正在提交…" : mode === "login" ? "登录" : mode === "register" ? "创建账号" : mode === "forgot-password" ? "发送重置邮件" : mode === "reset-password" ? "更新密码" : "确认邮箱验证"}
            {!busy && <ArrowRight aria-hidden="true" size={19} />}
          </button>
        </form>

        <div className="auth-links">
          {mode === "login" && (
            <>
              <button type="button" onClick={() => navigate("forgot-password")}>忘记密码</button>
              <button type="button" onClick={() => navigate("register")}>注册新账号</button>
            </>
          )}
          {mode === "register" && <button type="button" onClick={() => navigate("login")}>已有账号，去登录</button>}
          {(["forgot-password", "reset-password", "verify-email"] as AuthMode[]).includes(mode) && (
            <button type="button" onClick={() => navigate("login")}>返回登录</button>
          )}
          {success && auth.status === "authenticated" && (
            <button type="button" onClick={() => navigate("workspace-overview")}>进入家属工作区</button>
          )}
        </div>
      </section>
    </main>
  );
};
