import { useState, type ReactNode } from "react";
import type { AgentTask } from "../agent/tasks/agentTaskTypes";

type Props = {
  task: AgentTask;
  children: ReactNode;
  onClose: (taskId: string) => void;
};

export function AgentTaskCard({ task, children, onClose }: Props) {
  const [expanded, setExpanded] = useState(true);
  const messageCount =
    task.userMessageIds.length + task.assistantMessageIds.length;

  return (
    <section className="agent-task" data-task-id={task.id}>
      <div className="agent-task__header">
        <button
          type="button"
          className="agent-task__toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded((current) => !current)}
        >
          <span>{expanded ? "−" : "+"}</span>
          <strong>{task.title}</strong>
        </button>
        <span className={`agent-task__status agent-task__status--${task.status}`}>
          {task.status.replaceAll("_", " ")}
        </span>
        <button type="button" onClick={() => onClose(task.id)}>
          Close Task
        </button>
      </div>
      <div className="agent-task__meta">
        <span>{messageCount} messages</span>
        <span>{task.patchIds.length} patches</span>
        <span>{task.commandProposalIds.length} commands</span>
        <span>{task.commandRunIds.length} results</span>
        <span>{new Date(task.updatedAt).toLocaleTimeString()}</span>
      </div>
      {expanded && <div className="agent-task__body">{children}</div>}
    </section>
  );
}

