import { useEffect, useId, useRef } from "react";
import type { RoutineView } from "../../api/types";
import { scheduleSummary } from "./routine-schedule";
import "./RoutinesApiPage.css";

export function RoutineLifecycleDialog({
  routine,
  action,
  busy,
  error,
  onConfirm,
  onCancel,
  onEdit,
}: {
  routine: RoutineView;
  action: "pause" | "resume";
  busy: boolean;
  error: string;
  onConfirm: () => void;
  onCancel: () => void;
  onEdit: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDivElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const trigger = document.activeElement;
    cancel.current?.focus();
    return () => {
      if (trigger instanceof HTMLElement && trigger.isConnected)
        trigger.focus();
    };
  }, []);
  return (
    <div className="routine-dialog-backdrop">
      <div
        className="panel-card routine-lifecycle-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        ref={dialog}
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            if (!busy) onCancel();
          }
          if (event.key !== "Tab") return;
          const controls = [
            ...dialog.current!.querySelectorAll<HTMLElement>(
              "button:not(:disabled), [tabindex='0']",
            ),
          ];
          const first = controls[0];
          const last = controls.at(-1);
          if (!first) {
            event.preventDefault();
            dialog.current?.focus();
          } else if (
            event.shiftKey &&
            (document.activeElement === first ||
              document.activeElement === dialog.current)
          ) {
            event.preventDefault();
            last?.focus();
          } else if (
            !event.shiftKey &&
            (document.activeElement === last ||
              document.activeElement === dialog.current)
          ) {
            event.preventDefault();
            first.focus();
          }
        }}
      >
        <h2 id={titleId}>
          {action === "pause" ? "暂停这个日程？" : "恢复这个日程？"}
        </h2>
        <strong>{routine.title}</strong>
        <p>{scheduleSummary(routine.schedules[0])}</p>
        <div id={descriptionId}>
          <p>
            {action === "pause"
              ? "暂停后，尚未确认的提醒将关闭。待家属核验记录和已有待办会保留。"
              : "只安排恢复后的提醒，不补发暂停期间的提醒。"}
          </p>
          <p>
            设备同步日程更新后，将结束当前陪伴。请在设备上重新开始陪伴；已发送或播放的内容无法撤回。
          </p>
        </div>
        {error && (
          <p className="inline-alert danger" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button
            className="secondary-button"
            type="button"
            disabled={busy}
            onClick={onCancel}
            ref={cancel}
          >
            取消
          </button>
          {action === "resume" && error && (
            <button
              className="secondary-button"
              type="button"
              disabled={busy}
              onClick={onEdit}
            >
              修改日程
            </button>
          )}
          <button
            className="primary-button"
            type="button"
            disabled={busy}
            onClick={onConfirm}
          >
            {busy
              ? action === "pause"
                ? "正在暂停…"
                : "正在恢复…"
              : action === "pause"
                ? "暂停日程"
                : "恢复日程"}
          </button>
        </div>
        {busy && <p role="status">正在提交，请稍候…</p>}
      </div>
    </div>
  );
}
