import type { ReadOnlyToolName } from "./toolTypes";

export type AgentToolLoopSettings = {
  enabled: boolean;
  maxTurns: number;
};

export const DEFAULT_TOOL_LOOP_SETTINGS: AgentToolLoopSettings = {
  enabled: false,
  maxTurns: 3,
};

const READ_ONLY_TOOLS = new Set<ReadOnlyToolName>([
  "read_file",
  "read_files",
  "list_workspace_files",
  "search_workspace",
  "get_git_status",
  "get_git_diff",
  "get_open_editors",
  "get_recent_terminal_output",
]);

export function isToolLoopTool(tool: string): tool is ReadOnlyToolName {
  return READ_ONLY_TOOLS.has(tool as ReadOnlyToolName);
}

export function canContinueToolLoop(
  settings: AgentToolLoopSettings,
  completedTurns: number,
  tool: string,
): boolean {
  return (
    settings.enabled &&
    completedTurns < settings.maxTurns &&
    isToolLoopTool(tool)
  );
}
