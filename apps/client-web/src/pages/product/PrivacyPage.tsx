import {
  Bell,
  Camera,
  CheckCircle2,
  CircleAlert,
  Database,
  Eye,
  FileClock,
  History,
  Mic,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Speech,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAdminAccessNotifications } from "../../api/admin-access-notifications";
import { apiClient, readableError } from "../../api/api-client";
import type { ConsentScope, ConsentStateView } from "../../api/types";
import { useWorkspace } from "../../workspace/workspace-context";
import {
  createWorkspaceOperationOwner,
  LatestScopedRequest,
} from "../../workspace/workspace-scope";
import {
  createScopedPageState,
  createScopedMutationOwner,
  isScopedMutationOwnerCurrent,
  pageValueForScope,
  type ScopedPageState,
} from "./family-page-state";

const consentCatalog: Record<ConsentScope, {
  documentVersionId: string;
  title: string;
  description: string;
  detail: string;
  icon: typeof Camera;
  sensitive?: boolean;
}> = {
  CAMERA_CAPTURE: { documentVersionId: "01KYYD3S55C7TCKGXJ32HBEV8E", title: "陪伴摄像头", description: "陪伴会话中采集画面供模型处理。", detail: "撤回后，新的陪伴会话不能开启摄像头。", icon: Camera },
  MICROPHONE_CAPTURE: { documentVersionId: "01KYYD3S566Y0A1HCZZCAYDTXV", title: "陪伴麦克风", description: "陪伴会话中采集声音供模型处理。", detail: "不包含家属远程通话录音授权。", icon: Mic },
  MODEL_PROCESSING: { documentVersionId: "01KYYD3S57AE606GFKY35H2KYM", title: "全模态模型处理", description: "把已授权的会话输入交给 MiniCPM-o。", detail: "模型输出不是医疗诊断，也不能替代家属确认。", icon: Speech },
  MODEL_INPUT_TRANSCRIPTION: { documentVersionId: "01KYYD3S58BSZQF3256C7HA6MK", title: "用户语音转写", description: "允许 ASR 单独保存陪伴会话中的用户原文。", detail: "未授权时不能从模型回复反推用户说了什么。", icon: FileClock, sensitive: true },
  REMOTE_ASSISTANCE_AUDIO: { documentVersionId: "01KYYD3S59JC1S1RCT09YTQ38Q", title: "家属远程音频", description: "现场接听后，家属与陪伴端实时对话。", detail: "远程通话始终不录音、不转写。", icon: PhoneCall },
  REMOTE_ASSISTANCE_VIDEO: { documentVersionId: "01KYYD3S5AYMHN86J6H4FJ9K67", title: "家属查看陪伴端画面", description: "现场接听后，向家属发送陪伴端摄像头画面。", detail: "家属端不会向陪伴端发送摄像头画面。", icon: Video },
  MEMORY_STORAGE: { documentVersionId: "01KYYD3S5BADE8WTHRP83JSP3K", title: "长期记忆存储", description: "保存家属录入并核验的长期记忆。", detail: "撤回后，记忆不再进入新的模型上下文。", icon: Database },
  CONTENT_INSPECTION: { documentVersionId: "01KYYD3S5CVXPGQK0GQB3VY36D", title: "开发期原文检查", description: "允许受审计的管理员在开发期检查记忆与对话原文。", detail: "还需双人审批的临时检查授权；生产环境硬关闭。", icon: Eye, sensitive: true },
};

export const PrivacyPage = () => {
  const workspace = useWorkspace();
  const adminAccesses = useAdminAccessNotifications();
  const [consentState, setConsentState] = useState<
    ScopedPageState<ConsentStateView[]>
  >(() => createScopedPageState("", []));
  const [loadingScopeKey, setLoadingScopeKey] = useState("");
  const [busyState, setBusyState] = useState<
    ScopedPageState<ConsentScope | "">
  >(() => createScopedPageState("", ""));
  const [errorState, setErrorState] = useState<ScopedPageState<string>>(() =>
    createScopedPageState("", ""),
  );
  const currentScopeKey = useRef(workspace.workspaceScopeKey);
  currentScopeKey.current = workspace.workspaceScopeKey;
  const scopeIdentity = {
    key: workspace.workspaceScopeKey,
    epoch: workspace.workspaceScopeEpoch,
  };
  const currentScopeIdentity = useRef(scopeIdentity);
  currentScopeIdentity.current = scopeIdentity;
  const loadRequests = useRef(new LatestScopedRequest());
  const states = pageValueForScope(
    consentState,
    workspace.workspaceScopeKey,
    [],
  );
  const loading =
    loadingScopeKey === workspace.workspaceScopeKey ||
    (Boolean(workspace.householdId && workspace.recipientId) &&
      consentState.scopeKey !== workspace.workspaceScopeKey);
  const busyScope = pageValueForScope(
    busyState,
    workspace.workspaceScopeKey,
    "",
  );
  const error = pageValueForScope(
    errorState,
    workspace.workspaceScopeKey,
    "",
  );

  const load = useCallback(async () => {
    if (!workspace.householdId || !workspace.recipientId) {
      loadRequests.current.invalidate();
      setConsentState(
        createScopedPageState(workspace.workspaceScopeKey, []),
      );
      setLoadingScopeKey("");
      return;
    }
    const owner = createWorkspaceOperationOwner(
      workspace.workspaceScopeKey,
      workspace.householdId,
      workspace.recipientId,
    );
    const request = loadRequests.current.begin(owner.scopeKey);
    setLoadingScopeKey(owner.scopeKey);
    setErrorState(createScopedPageState(owner.scopeKey, ""));
    try {
      const nextStates = await apiClient.request<ConsentStateView[]>(
        `/households/${owner.householdId}/care-recipients/${owner.recipientId}/consents`,
      );
      if (
        !loadRequests.current.isCurrent(request) ||
        currentScopeKey.current !== owner.scopeKey
      )
        return;
      setConsentState(createScopedPageState(owner.scopeKey, nextStates));
    } catch (loadError) {
      if (
        loadRequests.current.isCurrent(request) &&
        currentScopeKey.current === owner.scopeKey
      ) {
        setErrorState(
          createScopedPageState(owner.scopeKey, readableError(loadError)),
        );
      }
    } finally {
      if (
        loadRequests.current.isCurrent(request) &&
        currentScopeKey.current === owner.scopeKey
      ) {
        setLoadingScopeKey("");
      }
    }
  }, [
    workspace.householdId,
    workspace.recipientId,
    workspace.workspaceScopeKey,
  ]);

  useEffect(() => {
    loadRequests.current.invalidate();
    setConsentState(createScopedPageState(workspace.workspaceScopeKey, []));
    setLoadingScopeKey("");
    setBusyState(createScopedPageState(workspace.workspaceScopeKey, ""));
    setErrorState(createScopedPageState(workspace.workspaceScopeKey, ""));
  }, [workspace.workspaceScopeKey]);

  useEffect(() => { void load(); }, [load]);

  const decide = async (scope: ConsentScope, grant: boolean) => {
    if (!workspace.householdId || !workspace.recipientId) return;
    const owner = createScopedMutationOwner(
      scopeIdentity,
      workspace.householdId,
      workspace.recipientId,
    );
    const copy = consentCatalog[scope];
    if (!grant && !window.confirm(`确认撤回“${copy.title}”吗？相关能力会在新的请求中立即被服务器拒绝。`)) return;
    setBusyState(createScopedPageState(owner.scopeKey, scope));
    setErrorState(createScopedPageState(owner.scopeKey, ""));
    try {
      const current = states.find((state) => state.scope === scope);
      await apiClient.request(`/households/${owner.householdId}/care-recipients/${owner.recipientId}/consents/${scope}/${grant ? "grant" : "revoke"}`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: {
          documentVersionId: current?.lastEvent?.documentVersion.id ?? copy.documentVersionId,
          reason: grant ? "家属在隐私中心明确授权" : "家属在隐私中心主动撤回",
        },
      });
      if (
        !isScopedMutationOwnerCurrent(
          owner,
          currentScopeIdentity.current,
        )
      )
        return;
      await load();
    } catch (decisionError) {
      if (
        isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current)
      ) {
        setErrorState(
          createScopedPageState(owner.scopeKey, readableError(decisionError)),
        );
      }
    } finally {
      if (
        isScopedMutationOwnerCurrent(owner, currentScopeIdentity.current)
      ) {
        setBusyState((current) =>
          current.scopeKey === owner.scopeKey && current.value === scope
            ? createScopedPageState(owner.scopeKey, "")
            : current,
        );
      }
    }
  };

  return (
    <div className="privacy-api-page">
      <section className="privacy-principles">
        <ShieldCheck aria-hidden="true" size={27} />
        <div><h2>授权管理</h2><details><summary>了解授权规则</summary><p>你可以逐项授权或撤回功能。</p></details></div>
        <button className="secondary-button" type="button" disabled={loading} onClick={() => void load()}><RefreshCw aria-hidden="true" size={18} /> 刷新状态</button>
      </section>

      <section
        id="admin-accesses"
        className="admin-access-panel"
        aria-labelledby="admin-accesses-title"
        tabIndex={-1}
      >
        <header className="admin-access-heading">
          <span className="admin-access-heading-icon"><Bell aria-hidden="true" size={23} /></span>
          <div>
            <p className="eyebrow">站内隐私通知</p>
            <h2 id="admin-accesses-title">管理员访问记录</h2>
            <p>查看管理员读取本家庭数据的记录。</p>
          </div>
          {adminAccesses.isOwner && (
            <button
              className="secondary-button"
              type="button"
              disabled={adminAccesses.loading}
              onClick={() => void adminAccesses.refresh()}
            >
              <RefreshCw
                aria-hidden="true"
                className={adminAccesses.loading ? "spin" : ""}
                size={18}
              />
              {adminAccesses.loading ? "正在刷新…" : "刷新记录"}
            </button>
          )}
        </header>

        {!adminAccesses.isOwner ? (
          <div className="admin-access-owner-only">
            <ShieldCheck aria-hidden="true" size={24} />
            <div>
              <strong>仅家庭所有者可见</strong>
              <p>当前账号不能查看这些记录。</p>
            </div>
          </div>
        ) : (
          <>
            <div
              className={`admin-access-summary ${
                adminAccesses.status === "error" ? "is-error" : ""
              }`}
              aria-live="polite"
            >
              <strong>
                {adminAccesses.status === "error"
                  ? "未读状态暂时未知"
                  : adminAccesses.status === "loading"
                    ? "正在核对未读通知…"
                    : `${adminAccesses.page.unreadCount} 条未读通知`}
              </strong>
              <span>
                {adminAccesses.page.items.length > 0
                  ? `已加载 ${adminAccesses.page.items.length} 条管理员成功访问记录`
                  : "访问记录按时间从新到旧显示"}
              </span>
            </div>

            {adminAccesses.error && (
              <div className="inline-alert danger" role="alert">
                <span>{adminAccesses.error}</span>
                <button type="button" onClick={() => void adminAccesses.refresh()}>重试</button>
              </div>
            )}

            {adminAccesses.loading && adminAccesses.page.items.length === 0 ? (
              <div className="admin-access-state" role="status">
                <span className="loading-beacon" aria-hidden="true" />
                <span>正在读取访问记录…</span>
              </div>
            ) : adminAccesses.status === "error" && adminAccesses.page.items.length === 0 ? (
              <div className="admin-access-state is-error">
                <CircleAlert aria-hidden="true" size={28} />
                <strong>暂时无法确认访问记录</strong>
                <span>访问记录加载失败，请重试。</span>
              </div>
            ) : adminAccesses.page.items.length === 0 ? (
              <div className="admin-access-state">
                <CheckCircle2 aria-hidden="true" size={28} />
                <strong>暂无管理员访问记录</strong>
                <span>暂无管理员访问记录。</span>
              </div>
            ) : (
              <ol className="admin-access-list" aria-label="管理员访问记录">
                {adminAccesses.page.items.map((record) => {
                  const unread = record.notificationState === "UNREAD";
                  const historical = record.notificationState === "HISTORICAL";
                  const markingRead = adminAccesses.markingReadIds.has(record.id);
                  return (
                    <li key={record.id} className={unread ? "is-unread" : ""}>
                      <article>
                        <header>
                          <span className={`admin-access-status ${unread ? "is-unread" : historical ? "is-historical" : "is-read"}`}>
                            {unread ? <Bell aria-hidden="true" size={15} /> : historical ? <History aria-hidden="true" size={15} /> : <CheckCircle2 aria-hidden="true" size={15} />}
                            {unread ? "未读" : historical ? "历史记录" : "已读"}
                          </span>
                          <time dateTime={record.occurredAt}>{new Date(record.occurredAt).toLocaleString("zh-CN")}</time>
                        </header>
                        <dl>
                          <div>
                            <dt>实际类别</dt>
                            <dd><strong>{record.categoryLabel}</strong><code>{record.category}</code></dd>
                          </div>
                          <div>
                            <dt>访问原因</dt>
                            <dd>{record.reason}</dd>
                          </div>
                        </dl>
                        <footer>
                          {unread ? (
                            <button
                              className="secondary-button admin-access-read-button"
                              type="button"
                              disabled={markingRead}
                              onClick={() => void adminAccesses.markRead(record.id)}
                            >
                              <CheckCircle2 aria-hidden="true" size={17} />
                              {markingRead ? "正在标记…" : "标为已读"}
                            </button>
                          ) : historical ? (
                            <span>该记录形成于站内通知状态启用前，保留为历史访问凭证。</span>
                          ) : (
                            <span>已于 {record.readAt ? new Date(record.readAt).toLocaleString("zh-CN") : "此前"} 阅读</span>
                          )}
                        </footer>
                      </article>
                    </li>
                  );
                })}
              </ol>
            )}

            {adminAccesses.page.nextCursor && (
              <div className="admin-access-more">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={adminAccesses.loadingMore}
                  onClick={() => void adminAccesses.loadMore()}
                >
                  <History aria-hidden="true" size={18} />
                  {adminAccesses.loadingMore ? "正在加载…" : "加载更早记录"}
                </button>
              </div>
            )}
          </>
        )}
      </section>

      {!workspace.recipientId ? (
        <section className="empty-resource-state"><ShieldCheck aria-hidden="true" size={34} /><h2>尚未选择陪伴对象</h2><p>请先选择要管理的长者。</p></section>
      ) : (
        <>
          {error && <div className="inline-alert danger" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>重试</button></div>}
          <section className="consent-grid" aria-label="授权项目">
            {(Object.entries(consentCatalog) as Array<[ConsentScope, typeof consentCatalog[ConsentScope]]>).map(([scope, copy]) => {
              const state = states.find((item) => item.scope === scope);
              const granted = state?.granted ?? false;
              const Icon = copy.icon;
              return (
                <article key={scope} className={`consent-card ${copy.sensitive ? "is-sensitive" : ""}`}>
                  <div className="consent-card-heading"><span><Icon aria-hidden="true" size={23} /></span><div><h2>{copy.title}</h2><p>{copy.description}</p></div></div>
                  <details className="consent-detail"><summary>了解影响</summary><p>{copy.detail}</p></details>
                  <div className="consent-card-footer">
                    <span className={`status-pill ${granted ? "success" : "neutral"}`}><span className="status-dot" /> {granted ? "已授权" : state?.decision === "REVOKED" ? "已撤回" : "未授权"}</span>
                    <button className={granted ? "danger-outline-button" : "primary-button"} type="button" disabled={loading || busyScope === scope} onClick={() => void decide(scope, !granted)}>{busyScope === scope ? "正在提交…" : granted ? "撤回" : "查看并授权"}</button>
                  </div>
                  {state?.lastEvent && <small>最近决定：{new Date(state.lastEvent.occurredAt).toLocaleString("zh-CN")} · 文档 v{state.lastEvent.documentVersion.version}</small>}
                </article>
              );
            })}
          </section>
        </>
      )}
    </div>
  );
};
