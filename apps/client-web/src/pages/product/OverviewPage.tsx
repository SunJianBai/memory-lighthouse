import {
  BookHeart,
  CalendarCheck,
  ChevronDown,
  CircleUserRound,
  House,
  MonitorSmartphone,
  MailPlus,
  Plus,
  ShieldCheck,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiClient, readableError } from "../../api/api-client";
import type { HouseholdMemberView } from "../../api/types";
import { navigate } from "../../app/navigation";
import { useAuth } from "../../auth/auth-context";
import { useWorkspace } from "../../workspace/workspace-context";
import { CareAuthorityPanel } from "./CareAuthorityPanel";

const localTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai";

export const OverviewPage = () => {
  const auth = useAuth();
  const workspace = useWorkspace();
  const [householdName, setHouseholdName] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [preferredName, setPreferredName] = useState("");
  const [homeLabel, setHomeLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [members, setMembers] = useState<HouseholdMemberView[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"CAREGIVER" | "VIEWER">("CAREGIVER");
  const [inviteMessage, setInviteMessage] = useState("");
  const email = auth.user?.identities.find((identity) => identity.type === "EMAIL");

  const loadMembers = useCallback(async () => {
    if (!workspace.householdId) {
      setMembers([]);
      return;
    }
    try {
      setMembers(await apiClient.request<HouseholdMemberView[]>(`/households/${workspace.householdId}/members`));
    } catch (loadError) {
      setError(readableError(loadError));
    }
  }, [workspace.householdId]);

  useEffect(() => { void loadMembers(); }, [loadMembers]);

  const createHousehold = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await workspace.createHousehold(householdName.trim(), localTimezone);
      setHouseholdName("");
    } catch (createError) {
      setError(readableError(createError));
    } finally {
      setBusy(false);
    }
  };

  const createRecipient = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await workspace.createRecipient({
        name: recipientName.trim(),
        preferredName: preferredName.trim() || undefined,
        timezone: localTimezone,
        homeLabel: homeLabel.trim() || undefined,
      });
      setRecipientName("");
      setPreferredName("");
      setHomeLabel("");
    } catch (createError) {
      setError(readableError(createError));
    } finally {
      setBusy(false);
    }
  };

  const inviteMember = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspace.householdId) return;
    setBusy(true);
    setError("");
    setInviteMessage("");
    try {
      await apiClient.request(`/households/${workspace.householdId}/invitations`, {
        method: "POST",
        body: { targetEmail: inviteEmail.trim(), roleCode: inviteRole },
      });
      setInviteEmail("");
      setInviteMessage("邀请邮件已发送。对方登录后，令牌会通过请求正文提交。 ");
    } catch (inviteError) {
      setError(readableError(inviteError));
    } finally {
      setBusy(false);
    }
  };

  if (!email?.verifiedAt) {
    return (
      <section className="setup-callout warning">
        <ShieldCheck aria-hidden="true" size={28} />
        <div>
          <h2>先完成邮箱验证</h2>
          <p>为了防止匿名账号创建家庭或激活摄像头设备，请先在账号设置中输入邮件里的 6 位验证码。</p>
          <button className="primary-button" type="button" onClick={() => navigate("workspace-settings")}>前往账号设置</button>
        </div>
      </section>
    );
  }

  if (workspace.households.length === 0) {
    return (
      <section className="setup-grid">
        <div className="setup-copy">
          <span><House aria-hidden="true" size={30} /></span>
          <h2>创建第一个家庭</h2>
          <p>家庭是成员、陪伴对象、记忆、日程和设备授权的边界。创建者成为家庭所有者。</p>
        </div>
        <form className="panel-card stack-form" onSubmit={(event) => void createHousehold(event)}>
          <label htmlFor="household-name">家庭名称</label>
          <input id="household-name" required maxLength={100} value={householdName} onChange={(event) => setHouseholdName(event.target.value)} placeholder="例如：林阿姨的家" />
          <p className="field-help">默认时区：{localTimezone}</p>
          {error && <div className="form-message error" role="alert">{error}</div>}
          <button className="primary-button" type="submit" disabled={busy}><Plus aria-hidden="true" size={19} /> {busy ? "正在创建…" : "创建家庭"}</button>
        </form>
      </section>
    );
  }

  if (workspace.recipients.length === 0) {
    return (
      <section className="setup-grid">
        <div className="setup-copy">
          <span><CircleUserRound aria-hidden="true" size={30} /></span>
          <h2>添加陪伴对象</h2>
          <p>一台陪伴设备只绑定一位长者。称呼和家庭位置会用于陪伴界面与模型最小上下文。</p>
        </div>
        <form className="panel-card stack-form" onSubmit={(event) => void createRecipient(event)}>
          <label htmlFor="recipient-name">姓名</label>
          <input id="recipient-name" required maxLength={100} value={recipientName} onChange={(event) => setRecipientName(event.target.value)} />
          <label htmlFor="recipient-preferred">希望如何称呼（可选）</label>
          <input id="recipient-preferred" maxLength={100} value={preferredName} onChange={(event) => setPreferredName(event.target.value)} placeholder="例如：林阿姨" />
          <label htmlFor="recipient-home">家庭位置说明（可选）</label>
          <input id="recipient-home" maxLength={100} value={homeLabel} onChange={(event) => setHomeLabel(event.target.value)} placeholder="例如：杭州 · 家中客厅" />
          {error && <div className="form-message error" role="alert">{error}</div>}
          <button className="primary-button" type="submit" disabled={busy}><Plus aria-hidden="true" size={19} /> {busy ? "正在添加…" : "添加陪伴对象"}</button>
        </form>
      </section>
    );
  }

  const quickActions = [
    { icon: BookHeart, title: "建立记忆", copy: "录入称呼、人物、偏好和位置等可核验信息。", route: "workspace-memories" as const },
    { icon: CalendarCheck, title: "安排日程", copy: "把提醒内容原样交给陪伴端，不做医疗推断。", route: "workspace-routines" as const },
    { icon: MonitorSmartphone, title: "激活设备", copy: "二维码或动态码 Claim 后，仍需家属现场批准。", route: "workspace-devices" as const },
  ];

  return (
    <div className="overview-stack">
      <section className="recipient-hero">
        <span className="recipient-monogram" aria-hidden="true">{workspace.recipient?.preferredName.slice(0, 1)}</span>
        <div>
          <p className="eyebrow">当前陪伴对象</p>
          <h2>{workspace.recipient?.preferredName}</h2>
          <p>{workspace.recipient?.homeLabel || "尚未填写家庭位置"} · {workspace.recipient?.timezone}</p>
        </div>
        <span className="status-pill success"><ShieldCheck aria-hidden="true" size={17} /> 服务器授权生效</span>
      </section>

      <section className="metric-grid" aria-label="家庭配置摘要">
        <article><small>家庭角色</small><strong>{workspace.household?.roleCodes.join(" / ")}</strong><p>由成员关系决定</p></article>
        <article><small>陪伴对象</small><strong>{workspace.recipients.length}</strong><p>当前家庭内</p></article>
        <article><small>已绑定设备</small><strong>{workspace.bindings.filter((item) => item.status === "ACTIVE").length}</strong><p>一台设备对应一位长者</p></article>
      </section>

      <section className="quick-action-grid" aria-labelledby="quick-actions-title">
        <div className="section-heading span-full"><p className="eyebrow">下一步</p><h2 id="quick-actions-title">完成陪伴配置</h2></div>
        {quickActions.map((action) => {
          const Icon = action.icon;
          return (
            <button key={action.route} className="quick-action-card" type="button" onClick={() => navigate(action.route)}>
              <span><Icon aria-hidden="true" size={24} /></span>
              <strong>{action.title}</strong>
              <p>{action.copy}</p>
            </button>
          );
        })}
      </section>

      <section className="panel-card household-members-panel">
        <div className="panel-heading"><div><p className="eyebrow">成员与角色</p><h2>家庭成员</h2></div><span className="count-badge"><Users aria-hidden="true" size={17} /> {members.length}</span></div>
        <div className="member-invite-layout">
          <div className="member-list">
            {members.map((member) => <article key={member.id}><span>{member.displayName.slice(0, 1)}</span><div><strong>{member.displayName}</strong><p>{member.roleCodes.join(" / ")} · {member.status}</p></div></article>)}
          </div>
          <form className="stack-form invite-form" onSubmit={(event) => void inviteMember(event)}>
            <div><MailPlus aria-hidden="true" size={22} /><div><strong>邀请家属</strong><p>邮件中的一次性令牌不会放入路径或查询参数。</p></div></div>
            <label htmlFor="invite-email">对方邮箱</label>
            <input id="invite-email" type="email" required maxLength={320} value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} />
            <label htmlFor="invite-role">家庭角色</label>
            <span className="select-wrap"><select id="invite-role" value={inviteRole} onChange={(event) => setInviteRole(event.target.value as "CAREGIVER" | "VIEWER")}><option value="CAREGIVER">照护家属</option><option value="VIEWER">只读成员</option></select><ChevronDown aria-hidden="true" size={17} /></span>
            {inviteMessage && <div className="form-message success" role="status">{inviteMessage}</div>}
            <button className="secondary-button full-width" type="submit" disabled={busy || !workspace.household?.roleCodes.includes("OWNER")}><MailPlus aria-hidden="true" size={18} /> {busy ? "正在发送…" : workspace.household?.roleCodes.includes("OWNER") ? "发送家庭邀请" : "仅家庭所有者可邀请"}</button>
          </form>
        </div>
      </section>

      {workspace.recipient && auth.user && (
        <CareAuthorityPanel
          householdId={workspace.householdId}
          recipientId={workspace.recipient.id}
          recipientName={workspace.recipient.preferredName}
          currentUserId={auth.user.id}
          members={members}
          canManage={Boolean(workspace.household?.roleCodes.includes("OWNER"))}
          onMemberUpdated={(updated) =>
            setMembers((current) =>
              current.map((member) =>
                member.id === updated.id ? updated : member,
              ),
            )
          }
          onMemberRemoved={(memberId) =>
            setMembers((current) =>
              current.filter((member) => member.id !== memberId),
            )
          }
        />
      )}
    </div>
  );
};
