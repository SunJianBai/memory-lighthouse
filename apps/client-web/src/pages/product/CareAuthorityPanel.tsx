import { Save, ShieldCheck, Trash2, UserCog } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiClient, readableError } from "../../api/api-client";
import type {
  CareAuthorityView,
  HouseholdMemberView,
} from "../../api/types";
import {
  authorityDraftFor,
  authorityRequestBody,
  type CareAuthorityDraft,
} from "./care-authority-model";

type HouseholdRole = "OWNER" | "CAREGIVER" | "VIEWER";
const householdRoles: HouseholdRole[] = ["OWNER", "CAREGIVER", "VIEWER"];

type Props = {
  householdId: string;
  recipientId: string;
  recipientName: string;
  currentUserId: string;
  members: HouseholdMemberView[];
  canManage: boolean;
  onMemberUpdated: (member: HouseholdMemberView) => void;
  onMemberRemoved: (memberId: string) => void;
};

const capabilityFields: Array<{
  key: keyof Pick<
    CareAuthorityDraft,
    | "canManageProfile"
    | "canManageConsent"
    | "canManageRoutine"
    | "canViewEvents"
    | "canViewConversation"
    | "canActivateDevice"
    | "canRemoteCall"
    | "receiveNotifications"
  >;
  label: string;
}> = [
  { key: "canManageProfile", label: "管理档案" },
  { key: "canManageConsent", label: "管理授权" },
  { key: "canManageRoutine", label: "管理日程" },
  { key: "canViewEvents", label: "查看事件" },
  { key: "canViewConversation", label: "查看对话原文" },
  { key: "canActivateDevice", label: "激活/撤销设备" },
  { key: "canRemoteCall", label: "发起远程通话" },
  { key: "receiveNotifications", label: "接收通知" },
];

export const CareAuthorityPanel = ({
  householdId,
  recipientId,
  recipientName,
  currentUserId,
  members,
  canManage,
  onMemberUpdated,
  onMemberRemoved,
}: Props) => {
  const [authorities, setAuthorities] = useState<CareAuthorityView[]>([]);
  const [drafts, setDrafts] = useState<Record<string, CareAuthorityDraft>>({});
  const [roleDrafts, setRoleDrafts] = useState<Record<string, HouseholdRole[]>>({});
  const [currentPassword, setCurrentPassword] = useState("");
  const [busyMemberId, setBusyMemberId] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadAuthorities = useCallback(async () => {
    if (!canManage || !householdId || !recipientId) {
      setAuthorities([]);
      return;
    }
    try {
      const next = await apiClient.request<CareAuthorityView[]>(
        `/households/${householdId}/care-recipients/${recipientId}/authorities`,
      );
      setAuthorities(next);
      setError("");
    } catch (loadError) {
      setError(readableError(loadError));
    }
  }, [canManage, householdId, recipientId]);

  useEffect(() => {
    void loadAuthorities();
  }, [loadAuthorities]);

  useEffect(() => {
    setRoleDrafts(
      Object.fromEntries(
        members.map((member) => [
          member.id,
          member.roleCodes.filter((role): role is HouseholdRole =>
            householdRoles.includes(role as HouseholdRole),
          ),
        ]),
      ),
    );
    setDrafts(
      Object.fromEntries(
        members.map((member) => [
          member.id,
          authorityDraftFor(
            member,
            authorities.find((authority) => authority.memberId === member.id),
          ),
        ]),
      ),
    );
  }, [authorities, members]);

  const requirePassword = (): string | null => {
    if (currentPassword.length > 0) return currentPassword;
    setError("修改成员或长者级权限前必须重新输入当前密码。");
    return null;
  };

  const updateDraft = (
    memberId: string,
    update: Partial<CareAuthorityDraft>,
  ) => {
    setDrafts((current) => ({
      ...current,
      [memberId]: { ...current[memberId]!, ...update },
    }));
  };

  const saveAuthority = async (member: HouseholdMemberView) => {
    const password = requirePassword();
    const draft = drafts[member.id];
    if (!password || !draft) return;
    const priority = draft.contactPriority === ""
      ? null
      : Number(draft.contactPriority);
    if (
      priority !== null &&
      (!Number.isInteger(priority) || priority < 1 || priority > 100)
    ) {
      setError("联系人优先级必须是 1 到 100。");
      setCurrentPassword("");
      return;
    }
    setBusyMemberId(member.id);
    setError("");
    setMessage("");
    try {
      const existing = authorities.find(
        (authority) => authority.memberId === member.id,
      );
      const saved = await apiClient.request<CareAuthorityView>(
        `/households/${householdId}/care-recipients/${recipientId}/authorities/${member.id}`,
        {
          method: "PUT",
          body: authorityRequestBody(draft, password, existing?.version ?? 0),
        },
      );
      setAuthorities((current) => [
        ...current.filter((authority) => authority.memberId !== member.id),
        saved,
      ]);
      setMessage(`已更新 ${member.displayName} 对 ${recipientName} 的长者级权限。`);
    } catch (saveError) {
      setError(readableError(saveError));
    } finally {
      setCurrentPassword("");
      setBusyMemberId("");
    }
  };

  const saveRole = async (member: HouseholdMemberView) => {
    const password = requirePassword();
    const roleCodes = roleDrafts[member.id];
    if (!password || !roleCodes) return;
    if (roleCodes.length === 0) {
      setError("请至少为成员保留一个家庭角色。");
      setCurrentPassword("");
      return;
    }
    setBusyMemberId(member.id);
    setError("");
    setMessage("");
    try {
      const updated = await apiClient.request<HouseholdMemberView>(
        `/households/${householdId}/members/${member.id}`,
        {
          method: "PATCH",
          body: {
            roleCodes,
            version: member.version,
            currentPassword: password,
          },
        },
      );
      onMemberUpdated(updated);
      setMessage(`已更新 ${member.displayName} 的家庭角色。`);
    } catch (saveError) {
      setError(readableError(saveError));
    } finally {
      setCurrentPassword("");
      setBusyMemberId("");
    }
  };

  const removeMember = async (member: HouseholdMemberView) => {
    const password = requirePassword();
    if (!password) return;
    if (!window.confirm(`确认从家庭中移除 ${member.displayName}？其长者级权限会一并失效。`)) {
      setCurrentPassword("");
      return;
    }
    setBusyMemberId(member.id);
    setError("");
    setMessage("");
    try {
      await apiClient.request(
        `/households/${householdId}/members/${member.id}?version=${member.version}`,
        {
          method: "DELETE",
          body: { currentPassword: password },
        },
      );
      onMemberRemoved(member.id);
      setAuthorities((current) =>
        current.filter((authority) => authority.memberId !== member.id),
      );
      setMessage(`已移除 ${member.displayName}。`);
    } catch (removeError) {
      setError(readableError(removeError));
    } finally {
      setCurrentPassword("");
      setBusyMemberId("");
    }
  };

  if (!canManage) {
    return (
      <section className="panel-card authority-management-panel">
        <div className="panel-heading">
          <div><p className="eyebrow">长者级权限</p><h2>{recipientName} 的 Care Authority</h2></div>
          <ShieldCheck aria-hidden="true" size={24} />
        </div>
        <p className="field-help">只有家庭 OWNER 可以查看和修改成员的长者级权限。</p>
      </section>
    );
  }

  return (
    <section className="panel-card authority-management-panel">
      <div className="panel-heading">
        <div><p className="eyebrow">成员角色与长者级权限</p><h2>{recipientName} 的 Care Authority</h2></div>
        <UserCog aria-hidden="true" size={25} />
      </div>
      <p className="field-help">
        家庭角色只给出基础边界；远程通话、设备激活、对话原文等高风险能力必须在此逐项授权。
      </p>
      <label className="reauth-field" htmlFor="authority-current-password">
        当前密码（每次敏感修改后立即清空）
        <input
          id="authority-current-password"
          type="password"
          autoComplete="current-password"
          maxLength={128}
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </label>
      {message && <div className="form-message success" role="status">{message}</div>}
      {error && <div className="form-message error" role="alert">{error}</div>}
      <div className="authority-card-list">
        {members.map((member) => {
          const draft = drafts[member.id];
          if (!draft) return null;
          const isSelf = member.userId === currentUserId;
          return (
            <article className="authority-card" key={member.id}>
              <header>
                <div><strong>{member.displayName}</strong><p>{member.roleCodes.join(" / ")} · {member.status}</p></div>
                <span className={`status-pill ${draft.status === "ACTIVE" ? "success" : "neutral"}`}>{draft.status}</span>
              </header>
              <div className="member-role-row">
                <fieldset className="member-role-options" disabled={isSelf || busyMemberId === member.id}>
                  <legend>家庭角色</legend>
                  {householdRoles.map((role) => (
                    <label key={role}>
                      <input
                        type="checkbox"
                        checked={(roleDrafts[member.id] ?? []).includes(role)}
                        onChange={(event) => setRoleDrafts((current) => ({
                          ...current,
                          [member.id]: event.target.checked
                            ? [...(current[member.id] ?? []), role]
                            : (current[member.id] ?? []).filter((item) => item !== role),
                        }))}
                      />
                      {role}
                    </label>
                  ))}
                </fieldset>
                <button className="secondary-button" type="button" disabled={isSelf || busyMemberId === member.id} onClick={() => void saveRole(member)}>
                  <Save aria-hidden="true" size={16} /> 保存角色
                </button>
                <button className="danger-button" type="button" disabled={isSelf || busyMemberId === member.id} onClick={() => void removeMember(member)}>
                  <Trash2 aria-hidden="true" size={16} /> 移除成员
                </button>
              </div>
              <div className="authority-meta-grid">
                <label>关系说明<input maxLength={50} value={draft.relationshipLabel} onChange={(event) => updateDraft(member.id, { relationshipLabel: event.target.value })} /></label>
                <label>权限级别<input required maxLength={32} value={draft.accessLevel} onChange={(event) => updateDraft(member.id, { accessLevel: event.target.value })} /></label>
                <label>通知优先级<input type="number" min={1} max={100} value={draft.contactPriority} onChange={(event) => updateDraft(member.id, { contactPriority: event.target.value })} /></label>
                <label>授权状态<select value={draft.status} onChange={(event) => updateDraft(member.id, { status: event.target.value as CareAuthorityDraft["status"] })}><option value="ACTIVE">ACTIVE</option><option value="REVOKED">REVOKED</option></select></label>
              </div>
              <div className="authority-capability-grid">
                {capabilityFields.map((field) => (
                  <label key={field.key}>
                    <input type="checkbox" checked={draft[field.key]} onChange={(event) => updateDraft(member.id, { [field.key]: event.target.checked })} />
                    <span>{field.label}</span>
                  </label>
                ))}
              </div>
              <footer>
                <button className="primary-button" type="button" disabled={busyMemberId === member.id} onClick={() => void saveAuthority(member)}>
                  <ShieldCheck aria-hidden="true" size={17} /> {busyMemberId === member.id ? "正在保存…" : "保存长者级权限"}
                </button>
              </footer>
            </article>
          );
        })}
      </div>
    </section>
  );
};
