import type { ReactNode } from "react";
import type { AgentTaskActivity } from "../agent/activity/activityTypes";

type Props = {
  activity: AgentTaskActivity;
  children?: ReactNode;
  onToggle: (id: string, collapsed: boolean) => void;
  actions?: ReactNode;
};

const STATUS_MARK = {
  pending: "·",
  awaiting_approval: "?",
  running: "…",
  completed: "✓",
  failed: "✕",
  blocked: "!",
  cancelled: "−",
} as const;

export function AgentActivityRow({
  activity,
  children,
  onToggle,
  actions,
}: Props) {
  return (
    <section
      className={`agent-activity agent-activity--${activity.status}`}
      data-task-id={activity.taskId}
      data-activity-id={activity.id}
    >
      <div className="agent-activity__row">
        <button
          type="button"
          className="agent-activity__toggle"
          aria-expanded={!activity.collapsed}
          onClick={() => onToggle(activity.id, !activity.collapsed)}
        >
          <span>{STATUS_MARK[activity.status]}</span>
          <strong>{activity.title}</strong>
          {activity.summary && <small>{activity.summary}</small>}
        </button>
        {actions && <div className="agent-activity__actions">{actions}</div>}
      </div>
      {!activity.collapsed && children && (
        <div className="agent-activity__details">{children}</div>
      )}
    </section>
  );
}
