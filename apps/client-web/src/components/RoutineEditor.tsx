import { useEffect, useRef, useState } from "react";
import type { RoutineView } from "../api/types";
import { dateInTimeZone } from "../pages/product/routine-date";
import {
  repeatMode,
  repeatOptions,
  scheduleError,
  scheduleSummary,
  scheduleTime,
  weekdays,
  type RepeatMode,
  type RoutineFormInput,
} from "../pages/product/routine-schedule";

export function RoutineEditor({
  routine,
  timezone,
  busy,
  error,
  onSave,
  onCancel,
}: {
  routine: RoutineView | null;
  timezone: string;
  busy: boolean;
  error: string;
  onSave: (input: RoutineFormInput) => void;
  onCancel: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    heading.current?.scrollIntoView?.({ block: "center" });
  }, []);
  const existing = routine?.schedules[0];
  const zone = existing?.timezone ?? timezone;
  const [type, setType] = useState(routine?.type ?? "OTHER");
  const [title, setTitle] = useState(routine?.title ?? "");
  const [instructions, setInstructions] = useState(routine?.instructions ?? "");
  const [question, setQuestion] = useState(routine?.confirmationQuestion ?? "");
  const [time, setTime] = useState(
    scheduleTime(existing?.localTimeMinutes ?? 510),
  );
  const [mode, setMode] = useState<RepeatMode>(repeatMode(existing));
  const [mask, setMask] = useState(existing?.weekdayMask ?? 127);
  const [start, setStart] = useState(
    existing?.startDate ?? dateInTimeZone(new Date(), zone),
  );
  const [end, setEnd] = useState(existing?.endDate ?? "");
  const [grace, setGrace] = useState(String(existing?.graceMinutes ?? 5));
  const [notice, setNotice] = useState(
    String(existing?.familyNoticeMinutes ?? 15),
  );
  const minutes = /^\d{2}:\d{2}$/.test(time)
    ? Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
    : NaN;
  const schedule = {
    timezone: zone,
    localTimeMinutes: minutes,
    weekdayMask:
      mode === "once"
        ? existing?.startDate === start && existing.endDate === start
          ? existing.weekdayMask
          : 127
        : mask,
    startDate: start,
    endDate: mode === "once" ? start : end || null,
    graceMinutes: grace === "" ? NaN : Number(grace),
    familyNoticeMinutes: notice === "" ? NaN : Number(notice),
  };
  const validation = scheduleError(schedule);
  const changeMode = (next: RepeatMode) => {
    setMode(next);
    if (next !== "custom")
      setMask(repeatOptions.find((option) => option.value === next)!.mask);
    if (mode === "once" && next !== "once") setEnd("");
  };
  return (
    <form
      className="panel-card resource-form routine-editor"
      onSubmit={(event) => {
        event.preventDefault();
        if (
          !busy &&
          !validation &&
          title.trim() &&
          instructions.trim() &&
          question.trim()
        )
          onSave({
            type,
            title: title.trim(),
            instructions: instructions.trim(),
            confirmationQuestion: question.trim(),
            schedule,
          });
      }}
    >
      <h2 ref={heading} tabIndex={-1}>
        {routine ? "编辑日程" : "新建日程"}
      </h2>
      {routine && <p>修改整条日程规则；已确认及已产生的家庭待办会保留。</p>}
      {routine?.status === "PAUSED" && (
        <p>
          此日程已暂停，保存后仍保持暂停。修改日期或重复规则后，可再单独恢复日程。
        </p>
      )}
      <fieldset disabled={busy}>
        <div className="form-grid two-columns">
          <label>
            日程类型
            <select
              value={type}
              onChange={(event) => setType(event.target.value)}
            >
              <option value="OTHER">日常事项</option>
              <option value="MEDICATION">用药提醒</option>
              <option value="MEAL">用餐提醒</option>
              <option value="HYDRATION">饮水提醒</option>
              <option value="ACTIVITY">活动安排</option>
              <option value="APPOINTMENT">预约事项</option>
            </select>
          </label>
          <label>
            提醒时间
            <input
              type="time"
              required
              value={time}
              onChange={(event) => setTime(event.target.value)}
            />
          </label>
        </div>
        <label>
          标题
          <input
            required
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        </label>
        <label>
          家属录入的提醒内容
          <textarea
            required
            rows={3}
            maxLength={4000}
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
          />
        </label>
        <label>
          确认问题
          <input
            required
            maxLength={1000}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="例如：您已经完成了吗？"
          />
        </label>
        <label>
          重复周期
          <select
            value={mode}
            onChange={(event) => changeMode(event.target.value as RepeatMode)}
          >
            {repeatOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        {mode === "custom" && (
          <div className="routine-weekdays" role="group" aria-label="选择星期">
            {weekdays.map((day) => (
              <button
                className="secondary-button"
                type="button"
                key={day.bit}
                aria-pressed={Boolean(mask & day.bit)}
                onClick={() => setMask(mask ^ day.bit)}
              >
                {day.label}
              </button>
            ))}
          </div>
        )}
        <div className="form-grid two-columns">
          <label>
            {mode === "once" ? "提醒日期" : "开始日期"}
            <input
              type="date"
              required
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          </label>
          {mode !== "once" && (
            <label>
              结束日期（可选）
              <input
                type="date"
                min={start}
                value={end}
                onChange={(event) => setEnd(event.target.value)}
              />
              <small>留空表示持续重复</small>
            </label>
          )}
        </div>
        <p>提醒时区：{zone}</p>
        <details>
          <summary>确认与家属待办设置</summary>
          <div className="form-grid two-columns">
            <label>
              确认等待（分钟）
              <input
                type="number"
                min={0}
                max={1440}
                required
                value={grace}
                onChange={(event) => setGrace(event.target.value)}
              />
            </label>
            <label>
              确认超时后的待办延迟（分钟）
              <input
                type="number"
                min={0}
                max={10080}
                required
                value={notice}
                onChange={(event) => setNotice(event.target.value)}
              />
            </label>
          </div>
          <p>提醒后先等待确认；仍未确认时，再等待设定时长生成家属待办。</p>
        </details>
      </fieldset>
      <div className="routine-schedule-preview" role="status">
        {validation || scheduleSummary(schedule)}
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
        >
          取消
        </button>
        <button
          className="primary-button"
          type="submit"
          disabled={busy || Boolean(validation)}
        >
          {busy ? "正在保存…" : "保存日程"}
        </button>
      </div>
    </form>
  );
}
