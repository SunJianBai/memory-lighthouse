import {
  ArrowUpRight,
  BellDot,
  CheckCircle2,
  Clock3,
  Eye,
  HeartHandshake,
  MessageSquareText,
  PhoneCall,
  ShieldCheck,
  UserRoundCheck,
} from "lucide-react";
import { hrefFor, navigate } from "../app/navigation";
import { resolveOpenTaskEvents } from "../agent/event-closure";
import type { CareEvent } from "../domain/types";
import { useAppState } from "../state/app-state";
import { formatEventTime } from "../utils/format";

const eventIcon = {
  routine_due: Clock3,
  reminder_spoken: BellDot,
  user_confirmed: CheckCircle2,
  family_acknowledged: UserRoundCheck,
  needs_confirmation: Eye,
  family_contacted: HeartHandshake,
  memory_used: MessageSquareText,
  session_started: UserRoundCheck,
  session_ended: ShieldCheck,
};

const sourceLabels: Record<CareEvent["source"], string> = {
  agent: "助手规则 / 模型",
  user: "长者",
  caregiver: "家属",
  demo: "演示回放",
};

export const FamilyPage = () => {
  const { state, updateState } = useAppState();
  const pending = state.events.filter((event) => event.status === "open");
  const resolved = state.events.filter(
    (event) =>
      ["user_confirmed", "family_acknowledged"].includes(event.type) &&
      event.status === "resolved",
  ).length;
  const firstContact = state.trustedPeople[0];

  const confirmAndClose = (eventId: string) => {
    updateState((current) => {
      const original = current.events.find(
        (event) => event.id === eventId && event.status === "open",
      );
      if (!original) return current;
      const closedAt = new Date().toISOString();
      const closure: CareEvent = {
        id: crypto.randomUUID(),
        type: "family_acknowledged",
        severity: "info",
        status: "resolved",
        title: `${original.title}已由家属确认`,
        summary: "家属在事件面板中完成人工复核并关闭待办。",
        occurredAt: closedAt,
        routineId: original.routineId,
        source: "caregiver",
      };
      return {
        ...current,
        events: [
          closure,
          ...resolveOpenTaskEvents(
            current.events,
            original.routineId,
            original.id,
          ),
        ].slice(0, 200),
      };
    });
  };

  return (
    <div className="family-dashboard">
      <section className="family-hero-card">
        <div>
          <span className="family-avatar" aria-hidden="true">
            {state.recipient.preferredName.slice(0, 1)}
          </span>
          <div>
            <p className="eyebrow">今日陪伴概览</p>
            <h2>{state.recipient.preferredName}目前没有紧急告警</h2>
            <p>
              系统只展示明确确认和“待人工查看”，不会把沉默或单帧判断包装成危险结论。
            </p>
          </div>
        </div>
        <a
          className="secondary-button"
          href={
            firstContact?.phone
              ? `tel:${firstContact.phone.replace(/\s+/g, "")}`
              : hrefFor("demo-memories")
          }
          aria-label={
            firstContact
              ? `拨打${firstContact.name}的电话 ${firstContact.phone}`
              : "前往记忆中心添加联系人"
          }
        >
          <PhoneCall aria-hidden="true" size={19} />
          {firstContact ? "发起关怀通话" : "添加联系人"}
        </a>
      </section>

      <section className="summary-grid" aria-label="今日摘要">
        <article className="summary-card">
          <span className="summary-icon blue">
            <CheckCircle2 aria-hidden="true" size={22} />
          </span>
          <div>
            <small>明确完成</small>
            <strong>{resolved}</strong>
            <p>来自本人确认或家属复核</p>
          </div>
        </article>
        <article className="summary-card">
          <span className="summary-icon amber">
            <BellDot aria-hidden="true" size={22} />
          </span>
          <div>
            <small>待人工查看</small>
            <strong>{pending.length}</strong>
            <p>不是系统判定的紧急事件</p>
          </div>
        </article>
        <article className="summary-card">
          <span className="summary-icon green">
            <ShieldCheck aria-hidden="true" size={22} />
          </span>
          <div>
            <small>敏感信息上传</small>
            <strong>{state.assets.length}</strong>
            <p>当前仅保存于此浏览器</p>
          </div>
        </article>
        <article className="summary-card">
          <span className="summary-icon slate">
            <Clock3 aria-hidden="true" size={22} />
          </span>
          <div>
            <small>已启用日程</small>
            <strong>{state.routines.filter((item) => item.enabled).length}</strong>
            <p>由家属配置的确定性规则</p>
          </div>
        </article>
      </section>

      <div className="dashboard-columns">
        <section className="panel-card event-panel">
          <div className="panel-heading">
            <div>
              <p className="eyebrow">事件时间线</p>
              <h2>今天发生了什么</h2>
            </div>
            <button
              className="text-button"
              type="button"
              onClick={() => navigate("demo")}
            >
              回到演示台
              <ArrowUpRight aria-hidden="true" size={17} />
            </button>
          </div>

          <div className="event-list">
            {state.events.length === 0 && (
              <div className="empty-state">
                <MessageSquareText aria-hidden="true" size={30} />
                <strong>暂无事件</strong>
                <p>完成一次陪伴流程后，摘要会显示在这里。</p>
              </div>
            )}
            {state.events.slice(0, 12).map((event) => {
              const Icon = eventIcon[event.type];
              return (
                <article
                  key={event.id}
                  className={`event-item severity-${event.severity}`}
                >
                  <span className="event-icon">
                    <Icon aria-hidden="true" size={20} />
                  </span>
                  <div className="event-copy">
                    <div>
                      <strong>{event.title}</strong>
                      <time dateTime={event.occurredAt}>
                        {formatEventTime(event.occurredAt)}
                      </time>
                    </div>
                    <p>{event.summary}</p>
                    <div className="event-meta-row">
                      <span className={`event-status status-${event.status}`}>
                        {event.status === "open"
                          ? "待查看"
                          : event.status === "acknowledged"
                            ? "已查看"
                            : "已完成"}
                      </span>
                      <span className="event-source">
                        来源：{sourceLabels[event.source]}
                      </span>
                    </div>
                  </div>
                  {event.status === "open" && (
                    <button
                      className="compact-button"
                      type="button"
                      onClick={() => confirmAndClose(event.id)}
                    >
                      家属确认并关闭
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <aside className="dashboard-side">
          <section className="panel-card routine-panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">日程</p>
                <h2>接下来</h2>
              </div>
            </div>
            <div className="routine-list">
              {state.routines
                .filter((routine) => routine.enabled)
                .map((routine) => (
                  <article key={routine.id}>
                    <time>{routine.scheduledTime}</time>
                    <div>
                      <strong>{routine.title}</strong>
                      <p>{routine.instructions}</p>
                    </div>
                  </article>
                ))}
            </div>
            <button
              className="secondary-button full-width"
              type="button"
              onClick={() => navigate("memories")}
            >
              管理日程与记忆
            </button>
          </section>

          <section className="panel-card contact-card">
            <div className="contact-heading">
              <span className="contact-avatar">
                {firstContact?.name.slice(-1) ?? "家"}
              </span>
              <div>
                <small>第一联系人</small>
                <strong>{firstContact?.name ?? "尚未设置"}</strong>
                <p>{firstContact?.relationship}</p>
              </div>
            </div>
            <dl>
              <div>
                <dt>联系方式</dt>
                <dd>{firstContact?.phone ?? "—"}</dd>
              </div>
              <div>
                <dt>查看权限</dt>
                <dd>{firstContact?.canViewEvidence ? "已授权" : "未授权"}</dd>
              </div>
            </dl>
          </section>
        </aside>
      </div>
    </div>
  );
};
