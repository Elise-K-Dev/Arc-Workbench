import {
  readDirectory,
  readWorkspaceTextFile,
  searchWorkspace,
} from "../../api/fileApi";
import { getGitFileDiff, getGitStatus } from "../../api/gitApi";
import { redactSecrets, stripAnsi } from "../redaction";
import { relativeToolPath, resolveToolPath } from "./toolSafety";
import type {
  ToolRequest,
  ToolResult,
  ToolRuntimeContext,
} from "./toolTypes";

const MAX_FILE_CHARS = 50_000;
const MAX_TOTAL_CHARS = 120_000;
const MAX_LIST_FILES = 500;

function textArg(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${name} must be a non-empty string.`);
  }
  return value.trim();
}

function pathArgs(args: Record<string, unknown>): string[] {
  const paths = args.paths;
  if (!Array.isArray(paths) || paths.some((path) => typeof path !== "string")) {
    throw new Error("paths must be an array of workspace-relative strings.");
  }
  return paths.slice(0, 20) as string[];
}

function bounded(value: string, limit: number): string {
  return value.length > limit
    ? `${value.slice(0, limit)}\n[truncated]`
    : value;
}

async function listWorkspaceFiles(root: string): Promise<string[]> {
  const files: string[] = [];
  const queue = [root];
  while (queue.length > 0 && files.length < MAX_LIST_FILES) {
    const directory = queue.shift()!;
    for (const node of await readDirectory(directory)) {
      if (node.kind === "directory") {
        queue.push(node.path);
      } else {
        files.push(relativeToolPath(root, node.path));
      }
      if (files.length >= MAX_LIST_FILES) {
        break;
      }
    }
  }
  return files;
}

async function readFiles(
  root: string | undefined,
  paths: string[],
): Promise<{ output: string; paths: string[] }> {
  let total = 0;
  const sections: string[] = [];
  const readPaths: string[] = [];
  for (const relativePath of paths) {
    if (total >= MAX_TOTAL_CHARS) {
      sections.push("[total output truncated]");
      break;
    }
    resolveToolPath(root, relativePath);
    const content = bounded(
      await readWorkspaceTextFile(root!, relativePath),
      MAX_FILE_CHARS,
    );
    const remaining = MAX_TOTAL_CHARS - total;
    const section = `--- ${relativePath}\n${bounded(content, remaining)}`;
    sections.push(section);
    readPaths.push(relativePath);
    total += section.length;
  }
  return { output: sections.join("\n\n"), paths: readPaths };
}

async function execute(
  request: ToolRequest,
  context: ToolRuntimeContext,
): Promise<{
  output: string;
  summary: string;
  paths: string[];
  resultCount?: number;
  truncated?: boolean;
  backend?: "ripgrep" | "fallback";
}> {
  const root = context.workspaceRoot;
  if (request.tool === "read_file") {
    const path = textArg(request.args, "path");
    const result = await readFiles(root, [path]);
    return { ...result, summary: `Read 1 file · ${result.output.length} B` };
  }
  if (request.tool === "read_files") {
    const result = await readFiles(root, pathArgs(request.args));
    return {
      ...result,
      summary: `Read ${result.paths.length} files · ${result.output.length} B`,
    };
  }
  if (request.tool === "list_workspace_files") {
    if (!root) {
      throw new Error("Open a workspace before listing files.");
    }
    const files = await listWorkspaceFiles(root);
    return {
      output: `${files.join("\n")}${
        files.length >= MAX_LIST_FILES ? "\n[truncated]" : ""
      }`,
      summary: `Listed ${files.length} files`,
      paths: files,
    };
  }
  if (request.tool === "search_workspace") {
    if (!root) {
      throw new Error("Open a workspace before searching files.");
    }
    const query = textArg(request.args, "query");
    const contextLines =
      typeof request.args.contextLines === "number"
        ? request.args.contextLines
        : undefined;
    const pathFilter =
      typeof request.args.pathFilter === "string"
        ? request.args.pathFilter
        : undefined;
    const extensions = Array.isArray(request.args.extensions)
      ? request.args.extensions.filter(
          (extension): extension is string => typeof extension === "string",
        )
      : undefined;
    const result = await searchWorkspace(root, query, {
      maxResults: 500,
      maxOutputBytes: MAX_TOTAL_CHARS,
      contextLines,
      pathFilter,
      extensions,
    });
    const output = JSON.stringify(result, null, 2);
    return {
      output,
      summary: `Search found ${result.matches.length} matches · ${result.backend}${
        result.truncated ? " · truncated" : ""
      }`,
      paths: [...new Set(result.matches.map((match) => match.path))],
      resultCount: result.matches.length,
      truncated: result.truncated,
      backend: result.backend,
    };
  }
  if (request.tool === "get_git_status") {
    if (!root) {
      throw new Error("Open a workspace before reading Git status.");
    }
    const status = await getGitStatus(root);
    const output = [
      `branch: ${status.branch ?? "unknown"}`,
      ...status.files.map((file) => `${file.status} ${file.path}`),
    ].join("\n");
    return {
      output,
      summary: `Git status · ${status.files.length} changed files`,
      paths: status.files.map((file) => file.path),
    };
  }
  if (request.tool === "get_git_diff") {
    if (!root) {
      throw new Error("Open a workspace before reading a Git diff.");
    }
    const path = textArg(request.args, "path");
    resolveToolPath(root, path);
    const output = bounded(await getGitFileDiff(root, path), MAX_TOTAL_CHARS);
    return { output, summary: `Read Git diff · ${path}`, paths: [path] };
  }
  if (request.tool === "get_open_editors") {
    const output = context.openEditors
      .map(({ path, content }) => `--- ${path}\n${bounded(content ?? "", MAX_FILE_CHARS)}`)
      .join("\n\n");
    return {
      output: bounded(output || "[no open editors]", MAX_TOTAL_CHARS),
      summary: `Read ${context.openEditors.length} open editors`,
      paths: context.openEditors.map(({ path }) => path),
    };
  }
  const output = bounded(
    stripAnsi(context.recentTerminalOutput ?? "[no terminal output]"),
    20_000,
  );
  return {
    output,
    summary: `Read recent terminal output · ${output.length} B`,
    paths: [],
  };
}

export async function runReadOnlyTool(
  request: ToolRequest,
  context: ToolRuntimeContext,
): Promise<ToolResult> {
  try {
    const result = await execute(request, context);
    const output = redactSecrets(result.output);
    return {
      id: crypto.randomUUID(),
      requestId: request.id,
      tool: request.tool,
      status: "completed",
      output,
      summary: result.summary,
      bytes: output.length,
      paths: result.paths,
      resultCount: result.resultCount,
      truncated: result.truncated,
      backend: result.backend,
      createdAt: new Date().toISOString(),
    };
  } catch (reason) {
    const output = redactSecrets(String(reason));
    return {
      id: crypto.randomUUID(),
      requestId: request.id,
      tool: request.tool,
      status: "failed",
      output,
      summary: `Tool failed · ${output}`,
      bytes: output.length,
      paths: [],
      createdAt: new Date().toISOString(),
    };
  }
}
