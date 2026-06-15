import type { ReadOnlyToolName, ToolRequest } from "./toolTypes";

const TOOL_NAMES = new Set<ReadOnlyToolName>([
  "read_file",
  "read_files",
  "list_workspace_files",
  "search_workspace",
  "get_git_status",
  "get_git_diff",
  "get_open_editors",
  "get_recent_terminal_output",
]);

export function extractToolRequests(text: string): ToolRequest[] {
  const requests: ToolRequest[] = [];
  const pattern = /```tool_request\s*\r?\n([\s\S]*?)```/gi;
  for (const match of text.matchAll(pattern)) {
    const raw = match[1].trim();
    try {
      const parsed = JSON.parse(raw) as {
        tool?: unknown;
        args?: unknown;
      };
      if (
        typeof parsed.tool !== "string" ||
        !TOOL_NAMES.has(parsed.tool as ReadOnlyToolName) ||
        (parsed.args !== undefined &&
          (!parsed.args ||
            typeof parsed.args !== "object" ||
            Array.isArray(parsed.args)))
      ) {
        continue;
      }
      requests.push({
        id: crypto.randomUUID(),
        tool: parsed.tool as ReadOnlyToolName,
        args: (parsed.args as Record<string, unknown> | undefined) ?? {},
        raw,
      });
    } catch {
      continue;
    }
  }
  return requests;
}
