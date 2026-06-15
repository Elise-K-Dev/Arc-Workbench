export type ReadOnlyToolName =
  | "read_file"
  | "read_files"
  | "list_workspace_files"
  | "search_workspace"
  | "get_git_status"
  | "get_git_diff"
  | "get_open_editors"
  | "get_recent_terminal_output";

export type ToolRequest = {
  id: string;
  tool: ReadOnlyToolName;
  args: Record<string, unknown>;
  raw: string;
};

export type ToolResult = {
  id: string;
  requestId: string;
  tool: ReadOnlyToolName;
  status: "completed" | "failed";
  output: string;
  summary: string;
  bytes: number;
  paths: string[];
  resultCount?: number;
  truncated?: boolean;
  backend?: "ripgrep" | "fallback";
  delivery?: "auto_sent" | "waiting";
  createdAt: string;
};

export type ToolRuntimeContext = {
  workspaceRoot?: string;
  openEditors: Array<{ path: string; content?: string }>;
  recentTerminalOutput?: string;
};
