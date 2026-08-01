import {
  Camera,
  Database,
  Eye,
  FileClock,
  Mic,
  PhoneCall,
  RefreshCw,
  ShieldCheck,
  Speech,
  Video,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { apiClient, readableError } from "../../api/api-client";
import type { ConsentScope, ConsentStateView } from "../../api/types";
import { useWorkspace } from "../../workspace/workspace-context";

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
  const [states, setStates] = useState<ConsentStateView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyScope, setBusyScope] = useState<ConsentScope | "">("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    if (!workspace.householdId || !workspace.recipientId) {
      setStates([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      setStates(await apiClient.request<ConsentStateView[]>(`/households/${workspace.householdId}/care-recipients/${workspace.recipientId}/consents`));
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoading(false);
    }
  }, [workspace.householdId, workspace.recipientId]);

  useEffect(() => { void load(); }, [load]);

  const decide = async (scope: ConsentScope, grant: boolean) => {
    if (!workspace.householdId || !workspace.recipientId) return;
    const copy = consentCatalog[scope];
    if (!grant && !window.confirm(`确认撤回“${copy.title}”吗？相关能力会在新的请求中立即被服务器拒绝。`)) return;
    setBusyScope(scope);
    setError("");
    try {
      const current = states.find((state) => state.scope === scope);
      await apiClient.request(`/households/${workspace.householdId}/care-recipients/${workspace.recipientId}/consents/${scope}/${grant ? "grant" : "revoke"}`, {
        method: "POST",
        headers: { "Idempotency-Key": crypto.randomUUID() },
        body: {
          documentVersionId: current?.lastEvent?.documentVersion.id ?? copy.documentVersionId,
          reason: grant ? "家属在隐私中心明确授权" : "家属在隐私中心主动撤回",
        },
      });
      await load();
    } catch (decisionError) {
      setError(readableError(decisionError));
    } finally {
      setBusyScope("");
    }
  };

  if (!workspace.recipientId) {
    return <section className="empty-resource-state"><ShieldCheck aria-hidden="true" size={34} /><h2>尚未选择陪伴对象</h2><p>授权按具体陪伴对象分别管理，不使用全局默认授权。</p></section>;
  }

  return (
    <div className="privacy-api-page">
      <section className="privacy-principles">
        <ShieldCheck aria-hidden="true" size={27} />
        <div><h2>默认拒绝，逐项授权，随时撤回</h2><p>每次决定都会形成不可变授权事件。页面显示结果，真正的准入由服务器当前状态决定。</p></div>
        <button className="secondary-button" type="button" disabled={loading} onClick={() => void load()}><RefreshCw aria-hidden="true" size={18} /> 刷新状态</button>
      </section>
      {error && <div className="inline-alert danger" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>重试</button></div>}
      <section className="consent-grid" aria-label="授权项目">
        {(Object.entries(consentCatalog) as Array<[ConsentScope, typeof consentCatalog[ConsentScope]]>).map(([scope, copy]) => {
          const state = states.find((item) => item.scope === scope);
          const granted = state?.granted ?? false;
          const Icon = copy.icon;
          return (
            <article key={scope} className={`consent-card ${copy.sensitive ? "is-sensitive" : ""}`}>
              <div className="consent-card-heading"><span><Icon aria-hidden="true" size={23} /></span><div><h2>{copy.title}</h2><p>{copy.description}</p></div></div>
              <p className="consent-detail">{copy.detail}</p>
              <div className="consent-card-footer">
                <span className={`status-pill ${granted ? "success" : "neutral"}`}><span className="status-dot" /> {granted ? "已授权" : state?.decision === "REVOKED" ? "已撤回" : "未授权"}</span>
                <button className={granted ? "danger-outline-button" : "primary-button"} type="button" disabled={loading || busyScope === scope} onClick={() => void decide(scope, !granted)}>{busyScope === scope ? "正在提交…" : granted ? "撤回" : "查看并授权"}</button>
              </div>
              {state?.lastEvent && <small>最近决定：{new Date(state.lastEvent.occurredAt).toLocaleString("zh-CN")} · 文档 v{state.lastEvent.documentVersion.version}</small>}
            </article>
          );
        })}
      </section>
    </div>
  );
};
