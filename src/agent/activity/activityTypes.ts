export type AgentActivityKind =
  | "message"
  | "tool_request"
  | "tool_result"
  | "command_proposal"
  | "command_run"
  | "command_result"
  | "patch"
  | "patch_apply"
  | "rollback"
  | "router";

export type AgentActivityStatus =
  | "pending"
  | "awaiting_approval"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export type AgentTaskActivity = {
  id: string;
  taskId: string;
  kind: AgentActivityKind;
  status: AgentActivityStatus;
  title: string;
  summary?: string;
  createdAt: string;
  updatedAt: string;
  artifactId?: string;
  collapsed?: boolean;
  metadata?: Record<string, unknown>;
};
