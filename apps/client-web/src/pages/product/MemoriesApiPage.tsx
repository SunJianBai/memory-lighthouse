import {
  BookHeart,
  ChevronDown,
  FilePenLine,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { apiClient, readableError } from "../../api/api-client";
import type { MemoryView } from "../../api/types";
import { useWorkspace } from "../../workspace/workspace-context";

const kindLabels: Record<string, string> = {
  PERSON: "人物",
  PREFERENCE: "偏好",
  PLACE: "位置",
  STORY: "生活故事",
  ROUTINE: "日常习惯",
};

export const MemoriesApiPage = () => {
  const { householdId, recipientId, recipient } = useWorkspace();
  const [items, setItems] = useState<MemoryView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<MemoryView | null>(null);
  const [kind, setKind] = useState("PREFERENCE");
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [sensitivity, setSensitivity] = useState("SENSITIVE");

  const load = useCallback(async () => {
    if (!householdId || !recipientId) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await apiClient.request<{ items: MemoryView[]; nextCursor: string | null }>(
        `/households/${householdId}/care-recipients/${recipientId}/memories?limit=50`,
      );
      setItems(result.items);
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoading(false);
    }
  }, [householdId, recipientId]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!householdId || !recipientId) return;
    setBusy(true);
    setError("");
    try {
      const saved = editing
        ? await apiClient.request<MemoryView>(
            `/households/${householdId}/memories/${editing.id}`,
            {
              method: "PATCH",
              body: {
                kind,
                title: title.trim(),
                content: content.trim(),
                sensitivity,
                verificationStatus: editing.verificationStatus,
                changeReason: "家属在 Web 记忆档案中更新",
                version: editing.version,
              },
            },
          )
        : await apiClient.request<MemoryView>(
            `/households/${householdId}/care-recipients/${recipientId}/memories`,
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
      setItems((current) => editing
        ? current.map((item) => item.id === saved.id ? saved : item)
        : [saved, ...current]);
      setTitle("");
      setContent("");
      setEditing(null);
      setFormOpen(false);
    } catch (createError) {
      setError(readableError(createError));
    } finally {
      setBusy(false);
    }
  };

  const openCreate = () => {
    setEditing(null);
    setKind("PREFERENCE");
    setSensitivity("SENSITIVE");
    setTitle("");
    setContent("");
    setFormOpen(true);
  };

  const openEdit = (memory: MemoryView) => {
    setEditing(memory);
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
  };

  const remove = async (memory: MemoryView) => {
    if (!householdId || !window.confirm(`确认删除“${memory.title}”吗？删除后不会再进入模型上下文。`)) return;
    setBusy(true);
    setError("");
    try {
      await apiClient.request(
        `/households/${householdId}/memories/${memory.id}?version=${memory.version}`,
        { method: "DELETE" },
      );
      setItems((current) => current.filter((item) => item.id !== memory.id));
    } catch (removeError) {
      setError(readableError(removeError));
    } finally {
      setBusy(false);
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
          <p>这里只显示服务器中当前有效的加密记忆。</p>
        </div>
        <div>
          <button className="secondary-button" type="button" disabled={loading} onClick={() => void load()}>
            <RefreshCw aria-hidden="true" size={18} /> 刷新
          </button>
          <button className="primary-button" type="button" onClick={() => formOpen ? closeForm() : openCreate()} aria-expanded={formOpen}>
            <Plus aria-hidden="true" size={18} /> 新增记忆
          </button>
        </div>
      </section>

      {formOpen && (
        <form className="panel-card resource-form" onSubmit={(event) => void create(event)}>
          <div className="panel-heading"><div><p className="eyebrow">家属录入</p><h2>{editing ? "更新记忆并生成新修订" : "新增可核验记忆"}</h2></div></div>
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
          <p className="field-help"><ShieldCheck aria-hidden="true" size={16} /> 仅录入本人或家属确认的信息；模型不得把推测写回记忆。</p>
          <div className="form-actions"><button className="secondary-button" type="button" onClick={closeForm}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? "正在保存…" : editing ? "保存新修订" : "保存记忆"}</button></div>
        </form>
      )}

      {error && <div className="inline-alert danger" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>重试</button></div>}
      {loading ? (
        <div className="resource-skeleton" aria-label="正在加载记忆"><span /><span /><span /></div>
      ) : items.length === 0 ? (
        <EmptyMemory title="还没有服务器记忆" copy="新增第一条记忆后，只有在已授权记忆存储时才会进入陪伴上下文。" />
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
