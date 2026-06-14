export type AgentTaskStatus =
  | "open"
  | "waiting_for_user"
  | "patch_available"
  | "command_available"
  | "command_running"
  | "command_failed"
  | "command_completed"
  | "patch_applied"
  | "rolled_back"
  | "closed";

export type AgentTask = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  status: AgentTaskStatus;
  userMessageIds: string[];
  assistantMessageIds: string[];
  patchIds: string[];
  commandProposalIds: string[];
  commandRunIds: string[];
};

