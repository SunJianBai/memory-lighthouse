import {
  BookHeart,
  ChevronDown,
  FilePenLine,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { apiClient, readableError } from "../../api/api-client";
import type { MemoryView } from "../../api/types";
import { useWorkspace } from "../../workspace/workspace-context";
import { LatestScopedRequest } from "../../workspace/workspace-scope";
import {
  createMemoryFormScope,
  isMemoryFormScopeCurrent,
  mergeMemoryPage,
  type MemoryFormScope,
} from "./memory-page-state";

const kindLabels: Record<string, string> = {
  PERSON: "人物",
  PREFERENCE: "偏好",
  PLACE: "位置",
  STORY: "生活故事",
  ROUTINE: "日常习惯",
};

export const MemoriesApiPage = () => {
  const {
    householdId,
    recipientId,
    recipient,
    workspaceScopeKey,
  } = useWorkspace();
  const [items, setItems] = useState<MemoryView[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MemoryView | null>(null);
  const [formScope, setFormScope] = useState<MemoryFormScope | null>(null);
  const [kind, setKind] = useState("PREFERENCE");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sensitivity, setSensitivity] = useState("SENSITIVE");
  const loadRequests = useRef(new LatestScopedRequest());
  const currentScopeKey = useRef(workspaceScopeKey);
  currentScopeKey.current = workspaceScopeKey;

  const load = useCallback(async (cursor: string | null = null) => {
    if (!householdId || !recipientId) {
      setItems([]);
      setNextCursor(null);
      return;
    }
    const append = Boolean(cursor);
    const requestScopeKey = workspaceScopeKey;
    const request = loadRequests.current.begin(requestScopeKey);
    if (append) setLoadingMore(true);
    else setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams({ limit: "50" });
      if (cursor) query.set("cursor", cursor);
      const result = await apiClient.request<{ items: MemoryView[]; nextCursor: string | null }>(
        `/households/${householdId}/care-recipients/${recipientId}/memories?${query.toString()}`,
      );
      if (
        !loadRequests.current.isCurrent(request) ||
        currentScopeKey.current !== requestScopeKey
      )
        return;
      setItems((current) => mergeMemoryPage(current, result.items, append));
      setNextCursor(result.nextCursor);
    } catch (loadError) {
      if (
        loadRequests.current.isCurrent(request) &&
        currentScopeKey.current === requestScopeKey
      ) {
        setError(readableError(loadError));
      }
    } finally {
      if (
        loadRequests.current.isCurrent(request) &&
        currentScopeKey.current === requestScopeKey
      ) {
        if (append) setLoadingMore(false);
        else setLoading(false);
      }
    }
  }, [householdId, recipientId, workspaceScopeKey]);

  useEffect(() => {
    loadRequests.current.invalidate();
    setLoading(false);
    setLoadingMore(false);
    setBusy(false);
    setItems([]);
    setNextCursor(null);
    setFormOpen(false);
    setEditing(null);
    setFormScope(null);
    setKind("PREFERENCE");
    setSensitivity("SENSITIVE");
    setTitle("");
    setContent("");
    setError("");
  }, [workspaceScopeKey]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!isMemoryFormScopeCurrent(formScope, workspaceScopeKey)) {
      setError("陪伴对象已切换，请重新打开记忆表单后再保存。");
      return;
    }
    const submissionScope = formScope;
    const editingAtSubmit = editing;
    setBusy(true);
    setError("");
    try {
      const saved = editingAtSubmit
        ? await apiClient.request<MemoryView>(
            `/households/${submissionScope.householdId}/memories/${editingAtSubmit.id}`,
            {
              method: "PATCH",
              body: {
                kind,
                title: title.trim(),
                content: content.trim(),
                sensitivity,
                verificationStatus: editingAtSubmit.verificationStatus,
                changeReason: "家属在 Web 记忆档案中更新",
                version: editingAtSubmit.version,
              },
            },
          )
        : await apiClient.request<MemoryView>(
            `/households/${submissionScope.householdId}/care-recipients/${submissionScope.recipientId}/memories`,
            {
              method: "POST",
              body: {
                kind,
                title: title.trim(),
                content: content.trim(),
                sensitivity,
                verificationStatus: "FAMILY_REPORTED",
                source: "FAMILY",
              },
            },
          );
      if (currentScopeKey.current !== submissionScope.key) return;
      setItems((current) =>
        editingAtSubmit
          ? current.map((item) => (item.id === saved.id ? saved : item))
          : [saved, ...current.filter((item) => item.id !== saved.id)],
      );
      setTitle("");
      setContent("");
      setEditing(null);
      setFormScope(null);
      setFormOpen(false);
    } catch (createError) {
      if (currentScopeKey.current === submissionScope.key) {
        setError(readableError(createError));
      }
    } finally {
      if (currentScopeKey.current === submissionScope.key) setBusy(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setFormScope(
      createMemoryFormScope(workspaceScopeKey, householdId, recipientId),
    );
    setKind("PREFERENCE");
    setSensitivity("SENSITIVE");
    setTitle("");
    setContent("");
    setFormOpen(true);
  };

  const openEdit = (memory: MemoryView) => {
    setEditing(memory);
    setFormScope(
      createMemoryFormScope(workspaceScopeKey, householdId, recipientId),
    );
    setKind(memory.kind);
    setSensitivity(memory.sensitivity);
    setTitle(memory.title);
    setContent(memory.currentRevision.content);
    setFormOpen(true);
    window.requestAnimationFrame(() => document.getElementById("memory-title")?.focus());
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditing(null);
    setFormScope(null);
  };

  const remove = async (memory: MemoryView) => {
    if (!householdId || !window.confirm(`确认删除“${memory.title}”吗？删除后将无法在陪伴中使用。`)) return;
    const submissionScopeKey = workspaceScopeKey;
    const submissionHouseholdId = householdId;
    setBusy(true);
    setError("");
    try {
      await apiClient.request(
        `/households/${submissionHouseholdId}/memories/${memory.id}?version=${memory.version}`,
        { method: "DELETE" },
      );
      if (currentScopeKey.current === submissionScopeKey) {
        setItems((current) => current.filter((item) => item.id !== memory.id));
      }
    } catch (removeError) {
      if (currentScopeKey.current === submissionScopeKey) {
        setError(readableError(removeError));
      }
    } finally {
      if (currentScopeKey.current === submissionScopeKey) setBusy(false);
    }
  };

  if (!recipientId) {
    return <EmptyMemory title="尚未选择陪伴对象" copy="请先在家庭概览中添加并选择一位陪伴对象。" />;
  }

  return (
    <div className="resource-page">
      <section className="resource-toolbar">
        <div>
          <strong>{recipient?.preferredName}的记忆档案</strong>
          <p>已加载 {items.length} 条记忆。</p>
        </div>
        <div>
          <button
            className="secondary-button"
            type="button"
            disabled={loading || loadingMore}
            onClick={() => void load()}
          >
            <RefreshCw aria-hidden="true" size={18} />
            {loading ? "正在刷新…" : "刷新"}
          </button>
          <button className="primary-button" type="button" onClick={() => formOpen ? closeForm() : openCreate()} aria-expanded={formOpen}>
            <Plus aria-hidden="true" size={18} /> 新增记忆
          </button>
        </div>
      </section>

      {formOpen && (
        <form className="panel-card resource-form" onSubmit={(event) => void create(event)}>
          <div className="panel-heading"><div><p className="eyebrow">家属录入</p><h2>{editing ? "编辑记忆" : "新增记忆"}</h2></div></div>
          <div className="form-grid two-columns">
            <label>类型
              <span className="select-wrap"><select value={kind} onChange={(event) => setKind(event.target.value)}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><ChevronDown aria-hidden="true" size={17} /></span>
            </label>
            <label>敏感等级
              <span className="select-wrap"><select value={sensitivity} onChange={(event) => setSensitivity(event.target.value)}><option value="SENSITIVE">敏感信息</option><option value="HOUSEHOLD">家庭内信息</option></select><ChevronDown aria-hidden="true" size={17} /></span>
            </label>
          </div>
          <label htmlFor="memory-title">标题</label>
          <input id="memory-title" required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} />
          <label htmlFor="memory-content">内容</label>
          <textarea id="memory-content" required maxLength={20_000} rows={5} value={content} onChange={(event) => setContent(event.target.value)} />
          <p className="field-help"><ShieldCheck aria-hidden="true" size={16} /> 请填写本人或家属已确认的信息。</p>
          <div className="form-actions"><button className="secondary-button" type="button" onClick={closeForm}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "正在保存…" : editing ? "保存新修订" : "保存记忆"}</button></div>
        </form>
      )}

      {error && <div className="inline-alert danger" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>重试</button></div>}
      {loading ? (
        <div className="resource-skeleton" aria-label="正在加载记忆"><span /><span /><span /></div>
      ) : items.length === 0 ? (
        <EmptyMemory title="还没有记忆" copy="点击新增开始记录。" />
      ) : (
        <section className="memory-api-grid" aria-label="记忆列表">
          {items.map((memory) => (
            <article key={memory.id} className="memory-api-card">
              <div className="memory-card-top">
                <span>{kindLabels[memory.kind] ?? memory.kind}</span>
                <span className="status-pill neutral">{memory.verificationStatus === "FAMILY_REPORTED" ? "家属录入" : memory.verificationStatus}</span>
              </div>
              <h2>{memory.title}</h2>
              <p>{memory.currentRevision.content}</p>
              <footer>
                <small>第 {memory.currentRevision.revisionNo} 版 · {memory.sensitivity}</small>
                <div>
                  <button className="icon-button" type="button" disabled={busy} onClick={() => openEdit(memory)} aria-label={`编辑${memory.title}`}><FilePenLine aria-hidden="true" size={18} /></button>
                  <button className="icon-button danger" type="button" disabled={busy} onClick={() => void remove(memory)} aria-label={`删除${memory.title}`}><Trash2 aria-hidden="true" size={18} /></button>
                </div>
              </footer>
            </article>
          ))}
        </section>
      )}
      {nextCursor && !loading && (
        <div className="form-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={loadingMore || busy}
            onClick={() => void load(nextCursor)}
          >
            <RefreshCw aria-hidden="true" size={18} />
            {loadingMore ? "正在加载更多…" : "加载更多记忆"}
          </button>
        </div>
      )}
    </div>
  );
};

const EmptyMemory = ({ title, copy }: { title: string; copy: string }) => (
  <section className="empty-resource-state">
    <BookHeart aria-hidden="true" size={34} />
    <h2>{title}</h2>
    <p>{copy}</p>
  </section>
);
