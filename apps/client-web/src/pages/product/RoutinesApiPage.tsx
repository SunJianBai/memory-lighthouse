import {
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Plus,
  RefreshCw,
  UserRoundCheck,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { apiClient, readableError } from "../../api/api-client";
import type { FamilyTaskView, RoutineView } from "../../api/types";
import { useWorkspace } from "../../workspace/workspace-context";

const today = () => new Date().toISOString().slice(0, 10);
const toMinutes = (value: string) => {
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
};
const showTime = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

export const RoutinesApiPage = () => {
  const workspace = useWorkspace();
  const [routines, setRoutines] = useState<RoutineView[]>([]);
  const [tasks, setTasks] = useState<FamilyTaskView[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [type, setType] = useState("OTHER");
  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [question, setQuestion] = useState("");
  const [time, setTime] = useState("08:30");

  const load = useCallback(async () => {
    if (!workspace.householdId || !workspace.recipientId) {
      setRoutines([]);
      setTasks([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const [nextRoutines, nextTasks] = await Promise.all([
        apiClient.request<RoutineView[]>(`/households/${workspace.householdId}/care-recipients/${workspace.recipientId}/routines`),
        apiClient.request<FamilyTaskView[]>(`/households/${workspace.householdId}/family-tasks?recipientId=${workspace.recipientId}`),
      ]);
      setRoutines(nextRoutines);
      setTasks(nextTasks);
    } catch (loadError) {
      setError(readableError(loadError));
    } finally {
      setLoading(false);
    }
  }, [workspace.householdId, workspace.recipientId]);

  useEffect(() => { void load(); }, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    if (!workspace.householdId || !workspace.recipientId) return;
    setBusyId("create");
    setError("");
    try {
      const created = await apiClient.request<RoutineView>(`/households/${workspace.householdId}/care-recipients/${workspace.recipientId}/routines`, {
        method: "POST",
        body: {
          type,
          title: title.trim(),
          instructions: instructions.trim(),
          confirmationQuestion: question.trim(),
          schedule: {
            timezone: workspace.recipient?.timezone || "Asia/Shanghai",
            localTimeMinutes: toMinutes(time),
            weekdayMask: 127,
            startDate: today(),
            graceMinutes: 5,
            familyNoticeMinutes: 15,
          },
        },
      });
      setRoutines((current) => [...current, created]);
      setTitle("");
      setInstructions("");
      setQuestion("");
      setFormOpen(false);
    } catch (createError) {
      setError(readableError(createError));
    } finally {
      setBusyId("");
    }
  };

  const taskAction = async (task: FamilyTaskView, action: "claim" | "resolve" | "dismiss") => {
    if (!workspace.householdId) return;
    setBusyId(task.id);
    setError("");
    try {
      const body = action === "claim"
        ? { version: task.version }
        : { version: task.version, resolutionCode: action === "resolve" ? "FAMILY_CONFIRMED" : "NOT_ACTIONABLE" };
      const updated = await apiClient.request<FamilyTaskView>(`/households/${workspace.householdId}/family-tasks/${task.id}/${action}`, { method: "POST", body });
      setTasks((current) => current.map((item) => item.id === updated.id ? updated : item));
    } catch (actionError) {
      setError(readableError(actionError));
    } finally {
      setBusyId("");
    }
  };

  const openTasks = useMemo(() => tasks.filter((task) => !["RESOLVED", "DISMISSED"].includes(task.status)), [tasks]);

  if (!workspace.recipientId) {
    return <section className="empty-resource-state"><CalendarClock aria-hidden="true" size={34} /><h2>尚未选择陪伴对象</h2><p>日程和待办都严格归属于一位陪伴对象。</p></section>;
  }

  return (
    <div className="resource-page">
      <section className="resource-toolbar">
        <div><strong>确定性日程与家庭待办</strong><p>提醒内容由家属原样录入，完成状态只能走明确命令接口。</p></div>
        <div><button className="secondary-button" type="button" disabled={loading} onClick={() => void load()}><RefreshCw aria-hidden="true" size={18} /> 刷新</button><button className="primary-button" type="button" onClick={() => setFormOpen((current) => !current)} aria-expanded={formOpen}><Plus aria-hidden="true" size={18} /> 新建日程</button></div>
      </section>

      {formOpen && (
        <form className="panel-card resource-form" onSubmit={(event) => void create(event)}>
          <div className="panel-heading"><div><p className="eyebrow">每天重复</p><h2>新建日程</h2></div></div>
          <div className="form-grid two-columns">
            <label>日程类型<span className="select-wrap"><select value={type} onChange={(event) => setType(event.target.value)}><option value="OTHER">日常事项</option><option value="MEDICATION">用药提醒</option><option value="MEAL">用餐提醒</option><option value="HYDRATION">饮水提醒</option><option value="ACTIVITY">活动安排</option><option value="APPOINTMENT">预约事项</option></select><ChevronDown aria-hidden="true" size={17} /></span></label>
            <label>提醒时间<input type="time" required value={time} onChange={(event) => setTime(event.target.value)} /></label>
          </div>
          <label>标题<input required maxLength={200} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
          <label>家属录入的提醒内容<textarea required rows={3} maxLength={4_000} value={instructions} onChange={(event) => setInstructions(event.target.value)} /></label>
          <label>确认问题<input required maxLength={1_000} value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="例如：您已经按家属安排完成了吗？" /></label>
          <div className="form-actions"><button className="secondary-button" type="button" onClick={() => setFormOpen(false)}>取消</button><button className="primary-button" type="submit" disabled={busyId === "create"}>{busyId === "create" ? "正在保存…" : "保存日程"}</button></div>
        </form>
      )}

      {error && <div className="inline-alert danger" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>重试</button></div>}

      <div className="routine-task-columns">
        <section className="panel-card">
          <div className="panel-heading"><div><p className="eyebrow">日程</p><h2>已启用规则</h2></div><span className="count-badge">{routines.length}</span></div>
          {loading ? <div className="list-loading">正在加载日程…</div> : routines.length === 0 ? <div className="compact-empty"><CalendarClock aria-hidden="true" size={28} /><strong>暂无日程</strong><p>新建后，服务器会按时区物化待执行事项。</p></div> : (
            <div className="api-routine-list">{routines.map((routine) => <article key={routine.id}><time>{showTime(routine.schedules[0]?.localTimeMinutes ?? 0)}</time><div><strong>{routine.title}</strong><p>{routine.instructions}</p><small>{routine.contentProvenance === "FAMILY_ENTERED_VERBATIM" ? "家属原文" : routine.contentProvenance}</small></div><span className="status-pill success">{routine.status}</span></article>)}</div>
          )}
        </section>

        <section className="panel-card">
          <div className="panel-heading"><div><p className="eyebrow">待办</p><h2>需要家属处理</h2></div><span className="count-badge attention">{openTasks.length}</span></div>
          {loading ? <div className="list-loading">正在加载待办…</div> : openTasks.length === 0 ? <div className="compact-empty"><CheckCircle2 aria-hidden="true" size={28} /><strong>暂无待办</strong><p>这不等于系统作出安全判断，只表示没有待人工处理事项。</p></div> : (
            <div className="family-task-list">{openTasks.map((task) => <article key={task.id}><div><span className="status-pill neutral">{task.priority}</span><strong>家庭协同事项</strong><p>来源事件：{task.sourceEventId}</p></div><div className="task-actions">{task.status !== "CLAIMED" && <button type="button" disabled={busyId === task.id} onClick={() => void taskAction(task, "claim")}><UserRoundCheck aria-hidden="true" size={17} /> 领取</button>}<button type="button" disabled={busyId === task.id} onClick={() => void taskAction(task, "resolve")}><ClipboardCheck aria-hidden="true" size={17} /> 已处理</button></div></article>)}</div>
          )}
        </section>
      </div>
    </div>
  );
};
