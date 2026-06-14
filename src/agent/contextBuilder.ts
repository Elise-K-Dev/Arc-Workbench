import { readDirectory } from "../api/fileApi";
import { getGitFileDiff, getGitStatus } from "../api/gitApi";
import type {
  EditorFloatingPane,
  FloatingPaneState,
} from "../workspace/floatingPaneTypes";
import {
  getLatestTerminalCommandRun,
  getTerminalRuntime,
} from "../terminal/terminalRuntime";
import { redactSecrets, stripAnsi } from "./redaction";

export type AgentContextSelection = {
  activeEditor: boolean;
  openEditors: boolean;
  gitStatus: boolean;
  selectedGitDiff: boolean;
  workspace: boolean;
  browserUrls: boolean;
  terminalOutput: boolean;
};

type ContextInput = {
  panes: FloatingPaneState[];
  rootPath?: string;
  selection: AgentContextSelection;
};

function truncate(value: string, limit: number): string {
  return value.length > limit
    ? `${value.slice(0, limit)}\n[truncated]`
    : value;
}

function activeEditor(panes: FloatingPaneState[]) {
  return panes.reduce<EditorFloatingPane | undefined>(
    (active, pane) =>
      pane.kind === "editor" && (!active || pane.zIndex > active.zIndex)
        ? pane
        : active,
    undefined,
  );
}

function isSensitivePath(path: string): boolean {
  const name = path.replace(/\\/g, "/").split("/").pop()?.toLowerCase() ?? "";
  return (
    name.startsWith(".") ||
    name === "credentials" ||
    name === "credentials.json" ||
    name === "id_rsa" ||
    name === "id_ed25519" ||
    name.endsWith(".pem") ||
    name.endsWith(".key")
  );
}

async function workspaceFileList(rootPath: string): Promise<string[]> {
  const paths: string[] = [];
  const queue = [rootPath];
  while (queue.length > 0 && paths.length < 300) {
    const directory = queue.shift()!;
    const children = await readDirectory(directory);
    for (const child of children) {
      if (isSensitivePath(child.path)) {
        continue;
      }
      if (paths.length >= 300) {
        break;
      }
      paths.push(child.path);
      if (child.kind === "directory") {
        queue.push(child.path);
      }
    }
  }
  if (queue.length > 0 || paths.length >= 300) {
    paths.push("[truncated]");
  }
  return paths;
}

export async function buildAgentContext({
  panes,
  rootPath,
  selection,
}: ContextInput): Promise<string> {
  const sections: string[] = [];
  const editor = activeEditor(panes);

  if (selection.workspace && rootPath) {
    try {
      const files = await workspaceFileList(rootPath);
      sections.push(
        `<workspace>\nroot: ${rootPath}\nfiles:\n${files.join("\n")}\n</workspace>`,
      );
    } catch (reason) {
      sections.push(
        `<workspace>\nroot: ${rootPath}\nerror: ${String(reason)}\n</workspace>`,
      );
    }
  }

  if (selection.activeEditor && editor) {
    const editorPath = editor.payload.filePath ?? editor.title;
    sections.push(
      isSensitivePath(editorPath)
        ? `<active_editor>\npath: ${editorPath}\ncontent: [omitted: sensitive path]\n</active_editor>`
        : `<active_editor>\npath: ${editorPath}\nlanguage: ${
            editor.payload.language ?? "text"
          }\ncontent:\n${truncate(
            editor.payload.content ?? "",
            30_000,
          )}\n</active_editor>`,
    );
  }

  if (selection.openEditors) {
    const paths = panes
      .filter((pane): pane is EditorFloatingPane => pane.kind === "editor")
      .map((pane) => pane.payload.filePath ?? pane.title);
    sections.push(`<open_editors>\n${paths.join("\n")}\n</open_editors>`);
  }

  const gitPane = panes
    .filter((pane) => pane.kind === "git")
    .sort((left, right) => right.zIndex - left.zIndex)[0];
  const gitRoot = gitPane?.payload.rootPath ?? rootPath;
  if ((selection.gitStatus || selection.selectedGitDiff) && gitRoot) {
    try {
      const status = await getGitStatus(gitRoot);
      if (selection.gitStatus) {
        sections.push(
          `<git_status>\nbranch: ${status.branch ?? "unknown"}\nfiles:\n${status.files
            .map((file) => `${file.status} ${file.path}`)
            .join("\n")}\n</git_status>`,
        );
      }
      if (selection.selectedGitDiff && gitPane?.payload.selectedFile) {
        sections.push(
          isSensitivePath(gitPane.payload.selectedFile)
            ? `<git_diff path="${gitPane.payload.selectedFile}">\n[omitted: sensitive path]\n</git_diff>`
            : `<git_diff path="${gitPane.payload.selectedFile}">\n${truncate(
                await getGitFileDiff(gitRoot, gitPane.payload.selectedFile),
                40_000,
              )}\n</git_diff>`,
        );
      }
    } catch (reason) {
      sections.push(`<git_context_error>${String(reason)}</git_context_error>`);
    }
  }

  if (selection.browserUrls) {
    const urls = panes
      .filter((pane) => pane.kind === "browser")
      .map((pane) => pane.payload.url);
    sections.push(`<browser_urls>\n${urls.join("\n")}\n</browser_urls>`);
  }

  if (selection.terminalOutput) {
    const terminal = panes
      .filter((pane) => pane.kind === "terminal")
      .sort((left, right) => right.zIndex - left.zIndex)[0];
    if (terminal) {
      const output = stripAnsi(getTerminalRuntime(terminal.id)?.output ?? "");
      const latestRun = getLatestTerminalCommandRun(terminal.id);
      const truncated =
        output.length > 20_000
          ? `[truncated]\n${output.slice(output.length - 20_000)}`
          : output;
      sections.push(
        `<terminal_output title="${terminal.title}">\n${truncated || "[no output captured]"}\n</terminal_output>`,
      );
      if (latestRun) {
        const status =
          latestRun.completionStatus ??
          (latestRun.status === "pending" || latestRun.status === "running"
            ? latestRun.status
            : "unknown");
        const duration =
          latestRun.completedAt === undefined
            ? "unknown"
            : `${Math.max(
                0,
                (new Date(latestRun.completedAt).getTime() -
                  new Date(latestRun.startedAt).getTime()) /
                  1000,
              ).toFixed(1)}s`;
        sections.push(
          `<latest_command_result>\ncommand: ${latestRun.command}\nstatus: ${status}\nexit_code: ${latestRun.exitCode ?? "unknown"}\nduration: ${duration}\n</latest_command_result>`,
        );
      }
    }
  }

  return redactSecrets(sections.join("\n\n"));
}

export const SYSTEM_PROMPT = `You are Arc Agent, a local-first coding assistant inside Arc Workbench.

You can inspect context provided by Arc Workbench, but you cannot directly modify files or run commands in this version.

Be concise, practical, and explicit.
When suggesting code changes, prefer unified diff format.
When the user asks for code changes, propose changes as a unified diff when appropriate.
Arc Workbench may show your diff as a patch preview, but it will not be applied automatically.
When suggesting terminal commands, put them in fenced shell blocks using bash, sh, zsh, fish, powershell, or pwsh.
Do not claim that commands were run.
Arc Workbench may show command proposal cards, but commands require explicit user approval.
Avoid destructive commands unless the user specifically asks and explain the risk.
When the user provides terminal output, analyze the actual output first.
If the command failed, identify the likely cause and suggest the smallest next step.
If code changes are needed, provide a unified diff.
If another command is needed, provide it in a fenced shell block.
Do not claim you ran commands yourself.
Do not claim that you applied changes.
If more context is needed, ask for it.
If a task is risky or repo-wide, say that it should be escalated to a heavier worker later.`;
