import { useEffect, useRef, useState } from "react";
import { CheckCircle2 } from "lucide-react";
import {
  filterFamilyTasks,
  taskFilters,
  taskStatusLabel,
  taskPriorityLabel,
  taskResolutionLabel,
  type FamilyTaskBoardItem,
  type TaskFilter,
} from "../api/family-task-board";

export function FamilyTaskPanel({
  tasks,
  loading,
  error,
  busyId,
  timezone,
  onAction,
}: {
  tasks: FamilyTaskBoardItem[];
  loading: boolean;
  error: string;
  busyId: string;
  timezone: string;
  onAction: (
    task: FamilyTaskBoardItem,
    action: "claim" | "release" | "resolve" | "dismiss",
  ) => void;
}) {
  const [filter, setFilter] = useState<TaskFilter>("unfinished");
  const [confirmation, setConfirmation] = useState<{
    id: string;
    version: number;
    action: "release" | "dismiss";
  } | null>(null);
  const confirmationTrigger = useRef<HTMLButtonElement | null>(null);
  useEffect(() => setConfirmation(null), [tasks, loading, error]);
  const visible = filterFamilyTasks(tasks, filter);
  const format = (instant: string) =>
    new Date(instant).toLocaleString("zh-CN", {
      timeZone: timezone,
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  return (
    <section className="panel-card">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">待办</p>
          <h2>家庭待办</h2>
        </div>
      </div>
      <div className="task-board-filters" role="group" aria-label="待办筛选">
        {taskFilters.map((option) => (
          <button
            key={option.id}
            type="button"
            aria-pressed={filter === option.id}
            onClick={() => {
              setFilter(option.id);
              setConfirmation(null);
            }}
          >
            {option.label}
            <span>
              {loading || error
                ? "—"
                : filterFamilyTasks(tasks, option.id).length}
            </span>
          </button>
        ))}
      </div>
      {loading ? (
        <div className="list-loading" role="status">
          正在加载待办…
        </div>
      ) : error ? (
        <div className="compact-empty" role="status">
          <strong>待办需要刷新</strong>
          <p>请使用页面顶部的“刷新”重新读取。</p>
        </div>
      ) : visible.length === 0 ? (
        <div className="compact-empty">
          <CheckCircle2 aria-hidden="true" size={28} />
          <strong>
            {taskFilters.find((option) => option.id === filter)?.empty}
          </strong>
        </div>
      ) : (
        <div className="family-task-list task-board-list">
          {visible.map((task) => (
            <article key={task.id}>
              <div className="task-board-content">
                <div className="task-board-badges">
                  <span className="status-pill neutral">
                    {taskPriorityLabel(task.priority)}
                  </span>
                  <span className="status-pill neutral">
                    {taskStatusLabel(task.status)}
                  </span>
                </div>
                <h3>{task.sourceTitle}</h3>
                <p>{task.sourceSummary}</p>
                <p className="task-board-owner">
                  {task.assignedToMe
                    ? "我负责"
                    : task.assigneeDisplayName
                      ? `负责人：${task.assigneeDisplayName}`
                      : "尚未认领"}
                </p>
                {task.dueAt && (
                  <p>
                    截止：{format(task.dueAt)}（{timezone}）
                  </p>
                )}
                {task.resolvedAt && <p>结束：{format(task.resolvedAt)}</p>}
                {["RESOLVED", "DISMISSED"].includes(task.status) && (
                  <p>处理结果：{taskResolutionLabel(task.resolutionCode)}</p>
                )}
                {task.resolutionNote && <p>处理备注：{task.resolutionNote}</p>}
                {!task.canFinish && task.status === "CLAIMED" && (
                  <p>由负责人处理</p>
                )}
              </div>
              <div className="task-actions">
                {task.canClaim && (
                  <button
                    type="button"
                    disabled={Boolean(busyId)}
                    onClick={() => onAction(task, "claim")}
                  >
                    认领
                  </button>
                )}
                {task.canFinish && (
                  <>
                    <button
                      type="button"
                      disabled={Boolean(busyId)}
                      onClick={() => onAction(task, "resolve")}
                    >
                      完成
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(busyId)}
                      aria-expanded={
                        confirmation?.id === task.id &&
                        confirmation.version === task.version &&
                        confirmation.action === "dismiss"
                      }
                      onClick={(event) => {
                        confirmationTrigger.current = event.currentTarget;
                        setConfirmation({
                          id: task.id,
                          version: task.version,
                          action: "dismiss",
                        });
                      }}
                    >
                      不再处理
                    </button>
                  </>
                )}
                {task.canRelease && (
                  <button
                    type="button"
                    disabled={Boolean(busyId)}
                    aria-expanded={
                      confirmation?.id === task.id &&
                      confirmation.version === task.version &&
                      confirmation.action === "release"
                    }
                    onClick={(event) => {
                      confirmationTrigger.current = event.currentTarget;
                      setConfirmation({
                        id: task.id,
                        version: task.version,
                        action: "release",
                      });
                    }}
                  >
                    交回待认领
                  </button>
                )}
                {confirmation?.id === task.id &&
                  confirmation.version === task.version &&
                  (confirmation.action === "release"
                    ? task.canRelease
                    : task.canFinish) && (
                    <div
                      className="task-dismiss-confirmation"
                      role="group"
                      aria-label={
                        confirmation.action === "release"
                          ? "确认交回待办"
                          : "确认结束待办"
                      }
                    >
                      <p>
                        {confirmation.action === "release"
                          ? "交回后将不再由你负责，其他有权限的家属可以认领。此待办仍未完成。"
                          : "确认不再处理这条待办吗？结束后可在“已结束”中查看。"}
                      </p>
                      <button
                        type="button"
                        disabled={Boolean(busyId)}
                        onClick={() => {
                          const action = confirmation.action;
                          setConfirmation(null);
                          onAction(task, action);
                        }}
                      >
                        {confirmation.action === "release"
                          ? "确认交回"
                          : "确认不再处理"}
                      </button>
                      <button
                        type="button"
                        disabled={Boolean(busyId)}
                        onClick={() => {
                          setConfirmation(null);
                          confirmationTrigger.current?.focus();
                        }}
                      >
                        取消
                      </button>
                    </div>
                  )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
