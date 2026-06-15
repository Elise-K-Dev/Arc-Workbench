import { useEffect, useRef, useState } from "react";
import {
  buildAgentContext,
  buildSystemPrompt,
  type AgentContextSelection,
} from "../agent/contextBuilder";
import {
  agentChat,
  agentChatStream,
  cancelAgentStream,
  listenToAgentStream,
  type AgentMessage,
  type AgentStreamCancelled,
  type AgentStreamDelta,
  type AgentStreamDone,
  type AgentStreamError,
} from "../api/agentApi";
import { extractPatchesFromText } from "../patch/extractPatchesFromText";
import { storePatch } from "../patch/patchStore";
import { extractCommandProposals } from "../commands/extractCommandProposals";
import type { CommandProposal } from "../commands/commandTypes";
import { CommandProposalCard } from "../components/CommandProposalCard";
import { AgentTaskCard } from "../components/AgentTaskCard";
import { useAgentTasks } from "../agent/tasks/useAgentTasks";
import { getAgentTask } from "../agent/tasks/taskStore";
import {
  attachAssistantMessage,
  attachCommandProposal,
  attachPatch,
  attachUserMessage,
  closeAgentTask,
  createAgentTask,
} from "../agent/tasks/taskStore";
import {
  dismissRouterDecision,
  evaluateTaskRouting,
  keepTaskLocal,
  useRouterDecisions,
} from "../agent/router/routerStore";
import { buildCodexHandoffPrompt } from "../agent/router/buildCodexHandoffPrompt";
import { CodexRouterCard } from "../components/CodexRouterCard";
import { ToolRequestCard } from "../components/ToolRequestCard";
import { getGitFileDiff, getGitStatus } from "../api/gitApi";
import {
  getTerminalCommandRunsForTask,
  getTerminalOutputSinceRun,
  useTerminalRuntime,
  type TerminalCommandRun,
  type TerminalOutputCapture,
} from "../terminal/terminalRuntime";
import type { ExtractedPatch, PatchFile } from "../patch/patchTypes";
import type {
  AgentFloatingPane,
  EditorFloatingPane,
  FloatingPaneState,
} from "../workspace/floatingPaneTypes";
import {
  loadPermissionSettings,
  savePermissionSettings,
  selectPermissionProfile,
} from "../agent/permissions/permissionSettings";
import type {
  AgentPermissionProfile,
  AgentPermissionSettings,
} from "../agent/permissions/permissionTypes";
import { extractToolRequests } from "../agent/tools/extractToolRequests";
import { runReadOnlyTool } from "../agent/tools/runReadOnlyTool";
import type {
  ToolRequest,
  ToolResult,
} from "../agent/tools/toolTypes";
import {
  addAgentActivity,
  upsertArtifactActivity,
} from "../agent/activity/activityStore";
import { canContinueToolLoop } from "../agent/tools/toolLoop";
import {
  applyWorkspaceTrust,
  type WorkspaceTrustLevel,
} from "../workspace/workspaceTrust";

type Props = {
  pane: AgentFloatingPane;
  panes: FloatingPaneState[];
  rootPath?: string;
  workspaceTrust: WorkspaceTrustLevel;
  onUpdate: (
    id: string,
    update: Partial<AgentFloatingPane["payload"]>,
  ) => void;
  onPreviewPatch: (patchId: string) => void;
  onOpenFile: (path: string) => Promise<void>;
  onRunCommand: (
    paneId: string,
    command: string,
    risk: import("../commands/commandTypes").CommandRisk,
    source?: TerminalCommandRun["source"],
    shellHint?: import("../commands/commandTypes").ShellHint,
    runLocation?: import("../commands/commandRiskTypes").CommandRunLocation,
  ) => Promise<TerminalCommandRun>;
  onRunCommandInNewTerminal: (
    command: string,
    risk: import("../commands/commandTypes").CommandRisk,
    source?: TerminalCommandRun["source"],
    shellHint?: import("../commands/commandTypes").ShellHint,
    runLocation?: import("../commands/commandRiskTypes").CommandRunLocation,
  ) => Promise<TerminalCommandRun>;
  onFocusTerminal: (paneId: string) => void;
};

type ChatMessage = AgentMessage & {
  id: string;
  createdAt: string;
  taskId: string;
  patches?: Array<{ id: string; patch: ExtractedPatch }>;
  commands?: CommandProposal[];
  tools?: Array<{ request: ToolRequest; result?: ToolResult }>;
};

const DEFAULT_CONTEXT: AgentContextSelection = {
  activeEditor: true,
  openEditors: false,
  gitStatus: true,
  selectedGitDiff: true,
  workspace: true,
  browserUrls: false,
  terminalOutput: false,
};

const CONTEXT_LABELS: Array<[keyof AgentContextSelection, string]> = [
  ["activeEditor", "Active Editor"],
  ["openEditors", "Open Editors"],
  ["gitStatus", "Git Status"],
  ["selectedGitDiff", "Selected Git Diff"],
  ["workspace", "Workspace"],
  ["browserUrls", "Browser URLs"],
  ["terminalOutput", "Terminal Output"],
];

function patchFilePath(file: PatchFile): string | undefined {
  const path = file.isDeletedFile ? file.oldPath : file.newPath || file.oldPath;
  return path && path !== "/dev/null" ? path : undefined;
}

function resolveWorkspacePath(
  rootPath: string | undefined,
  relativePath: string,
): string | undefined {
  if (
    !rootPath ||
    relativePath.startsWith("/") ||
    /^[A-Za-z]:[\\/]/.test(relativePath)
  ) {
    return undefined;
  }
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.split("/").includes("..")) {
    return undefined;
  }
  const separator = rootPath.includes("\\") ? "\\" : "/";
  return `${rootPath.replace(/[\\/]+$/, "")}${separator}${normalized.replace(
    /\//g,
    separator,
  )}`;
}

function routingMetadataFromContext(contextText: string) {
  const gitStatus = /<git_status>[\s\S]*?files:\n([\s\S]*?)\n<\/git_status>/.exec(
    contextText,
  )?.[1];
  const selectedDiff = /<git_diff\b[^>]*>\n([\s\S]*?)\n<\/git_diff>/.exec(
    contextText,
  )?.[1];
  const workspace = /<workspace>[\s\S]*?files:\n([\s\S]*?)\n<\/workspace>/.exec(
    contextText,
  )?.[1];
  return {
    gitChangedFileCount: gitStatus
      ? gitStatus.split(/\r?\n/).filter(Boolean).length
      : undefined,
    selectedDiffSize: selectedDiff?.length,
    workspaceFileCount: workspace
      ? workspace
          .split(/\r?\n/)
          .filter((line) => line && line !== "[truncated]").length
      : undefined,
  };
}

export function AgentPane({
  pane,
  panes,
  rootPath,
  workspaceTrust,
  onUpdate,
  onPreviewPatch,
  onOpenFile,
  onRunCommand,
  onRunCommandInNewTerminal,
  onFocusTerminal,
}: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [context, setContext] =
    useState<AgentContextSelection>(DEFAULT_CONTEXT);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string>();
  const [permissions, setPermissions] = useState<AgentPermissionSettings>(
    loadPermissionSettings,
  );
  const toolLoopTurnsRef = useRef(new Map<string, number>());
  const stoppedToolLoopsRef = useRef(new Set<string>());
  const chatEndRef = useRef<HTMLDivElement>(null);
  const activeStreamIdRef = useRef<string | undefined>(undefined);
  const streamMessageIdRef = useRef<string | undefined>(undefined);
  const streamTaskIdRef = useRef<string | undefined>(undefined);
  const streamContentRef = useRef("");
  const unlistenStreamRef = useRef<(() => void) | undefined>(undefined);
  const terminalRuntime = useTerminalRuntime();
  const tasks = useAgentTasks();
  const routerDecisions = useRouterDecisions();
  const terminalPanes = panes
    .filter((candidate) => candidate.kind === "terminal")
    .sort((left, right) => right.zIndex - left.zIndex);
  const terminalOptions = terminalPanes.map((terminal) => ({
    paneId: terminal.id,
    title: terminal.title,
    ready: terminalRuntime.some(
      (runtime) => runtime.paneId === terminal.id && !!runtime.sessionId,
    ),
    cwd: terminalRuntime.find((runtime) => runtime.paneId === terminal.id)?.cwd,
  }));
  const defaultTerminalId = terminalPanes[0]?.id;
  const effectivePermissions = applyWorkspaceTrust(
    permissions,
    workspaceTrust,
  );

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "nearest" });
  }, [loading, messages]);

  useEffect(
    () => () => {
      unlistenStreamRef.current?.();
      const streamId = activeStreamIdRef.current;
      if (streamId) {
        void cancelAgentStream(streamId).catch(() => {});
      }
    },
    [],
  );

  const updateNumber = (
    key: "temperature" | "maxTokens",
    rawValue: string,
  ) => {
    const value = Number(rawValue);
    if (Number.isFinite(value)) {
      onUpdate(pane.id, { [key]: value });
    }
  };

  const toolContext = () => {
    const activeTerminal = terminalPanes[0];
    return {
      workspaceRoot: rootPath,
      openEditors: panes
        .filter(
          (candidate): candidate is EditorFloatingPane =>
            candidate.kind === "editor",
        )
        .map((editor) => ({
          path: editor.payload.filePath ?? editor.title,
          content: editor.payload.content,
        })),
      recentTerminalOutput: activeTerminal
        ? terminalRuntime.find((runtime) => runtime.paneId === activeTerminal.id)
            ?.output
        : undefined,
    };
  };

  const runTool = async (
    taskId: string,
    messageId: string,
    request: ToolRequest,
  ): Promise<ToolResult> => {
    upsertArtifactActivity(request.id, {
      taskId,
      kind: "tool_request",
      status: "running",
      title: `Reading · ${request.tool}`,
      summary: "Workspace-bounded read-only tool",
    });
    let result = await runReadOnlyTool(request, toolContext());
    const completedTurns = toolLoopTurnsRef.current.get(taskId) ?? 0;
    const autoSend =
      result.status === "completed" &&
      effectivePermissions.readTools === "auto_allow" &&
      !stoppedToolLoopsRef.current.has(taskId) &&
      canContinueToolLoop(pane.payload.toolLoop, completedTurns, request.tool);
    result = { ...result, delivery: autoSend ? "auto_sent" : "waiting" };
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? {
              ...message,
              tools: message.tools?.map((tool) =>
                tool.request.id === request.id ? { ...tool, result } : tool,
              ),
            }
          : message,
      ),
    );
    upsertArtifactActivity(request.id, {
      taskId,
      kind: "tool_result",
      status: result.status,
      title:
        result.status === "completed"
          ? `Read tool completed · ${request.tool}`
          : `Read tool failed · ${request.tool}`,
      summary: `${result.summary} · ${
        autoSend ? "auto-sent" : "waiting for user"
      }`,
      metadata: {
        tool: request.tool,
        bytes: result.bytes,
        resultCount: result.resultCount,
        truncated: result.truncated,
        delivery: result.delivery,
      },
    });
    if (result.status !== "completed") {
      stoppedToolLoopsRef.current.add(taskId);
    } else if (autoSend) {
      toolLoopTurnsRef.current.set(taskId, completedTurns + 1);
      window.setTimeout(() => {
        void sendToolResult(taskId, request, result).catch((reason) =>
          setError(String(reason)),
        );
      }, 0);
    }
    return result;
  };

  const attachResponseArtifacts = async (
    messageId: string,
    taskId: string,
    content: string,
  ) => {
    const patches = extractPatchesFromText(content).map((patch) => ({
      id: storePatch(patch, taskId),
      patch,
    }));
    const commands = extractCommandProposals(content);
    const tools = extractToolRequests(content).map((request) => ({ request }));
    for (const patch of patches) {
      attachPatch(taskId, patch.id);
    }
    for (const command of commands) {
      attachCommandProposal(taskId, command.id);
    }
    for (const patch of patches) {
      addAgentActivity({
        taskId,
        kind: "patch",
        status: "awaiting_approval",
        title: "Patch detected",
        summary: `${patch.patch.parsed?.files.length ?? 0} files`,
        artifactId: patch.id,
      });
    }
    const task = getAgentTask(taskId);
    if (pane.payload.showCodexRouterSuggestions ?? true) {
      evaluateTaskRouting(taskId, {
        assistantResponse: content,
        patchCount: task?.patchIds.length ?? patches.length,
        patchFileCount:
          patches.reduce(
            (count, item) => count + (item.patch.parsed?.files.length ?? 0),
            0,
          ) +
          messages
            .filter((message) => message.taskId === taskId)
            .flatMap((message) => message.patches ?? [])
            .reduce(
              (count, item) =>
                count + (item.patch.parsed?.files.length ?? 0),
              0,
            ),
        commandProposalCount:
          task?.commandProposalIds.length ?? commands.length,
      });
    }
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? { ...message, content, patches, commands, tools }
          : message,
      ),
    );
    if (effectivePermissions.readTools === "auto_allow") {
      for (const { request } of tools) {
        await runTool(taskId, messageId, request);
      }
    }
  };

  const finishStream = (
    kind: "done" | "cancelled" | "error",
    message?: string,
  ) => {
    const messageId = streamMessageIdRef.current;
    const taskId = streamTaskIdRef.current;
    const content = streamContentRef.current;
    if (messageId && taskId && content && kind !== "error") {
      void attachResponseArtifacts(messageId, taskId, content);
    }
    if (kind === "cancelled") {
      setError("Agent stream cancelled.");
    } else if (kind === "error") {
      setError(message ?? "Agent stream failed.");
    }
    activeStreamIdRef.current = undefined;
    streamMessageIdRef.current = undefined;
    streamTaskIdRef.current = undefined;
    streamContentRef.current = "";
    unlistenStreamRef.current?.();
    unlistenStreamRef.current = undefined;
    setStreaming(false);
    setLoading(false);
  };

  const sendMessage = async (
    rawText: string,
    clearInput = false,
    sourceTaskId?: string,
  ) => {
    const requestText = rawText.trim();
    if (!requestText) {
      return;
    }
    if (loading) {
      throw new Error("Wait for the current Agent response to finish.");
    }

    const userMessageId = crypto.randomUUID();
    const task = sourceTaskId
      ? attachUserMessage(sourceTaskId, userMessageId)
      : createAgentTask(requestText, userMessageId);
    if (!task) {
      throw new Error("The originating Agent task is no longer available.");
    }
    if (!sourceTaskId) {
      toolLoopTurnsRef.current.set(task.id, 0);
      stoppedToolLoopsRef.current.delete(task.id);
    }
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: "user",
      content: requestText,
      createdAt: new Date().toISOString(),
      taskId: task.id,
    };
    if (pane.payload.showCodexRouterSuggestions ?? true) {
      evaluateTaskRouting(task.id, {
        userMessage: requestText,
        hasWorkspaceRoot: Boolean(rootPath),
        patchCount: task.patchIds.length,
        commandProposalCount: task.commandProposalIds.length,
      });
    }
    setMessages((current) => [...current, userMessage]);
    if (clearInput) {
      setInput("");
    }
    setLoading(true);
    setError(undefined);
    try {
      const contextText = await buildAgentContext({
        panes,
        rootPath,
        selection: context,
      });
      if (pane.payload.showCodexRouterSuggestions ?? true) {
        evaluateTaskRouting(task.id, routingMetadataFromContext(contextText));
      }
      const composed = contextText
        ? `Context:\n${contextText}\n\nUser request:\n${requestText}`
        : requestText;
      const request = {
        endpoint: pane.payload.endpoint,
        model: pane.payload.model,
        temperature: pane.payload.temperature,
        maxTokens: pane.payload.maxTokens,
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(pane.payload.toolLoop.maxTurns),
          },
          ...messages.map(({ role, content }) => ({ role, content })),
          { role: "user", content: composed },
        ],
      } satisfies Parameters<typeof agentChat>[0];

      if (!(pane.payload.streaming ?? true)) {
        const response = await agentChat(request);
        const messageId = crypto.randomUUID();
        attachAssistantMessage(task.id, messageId);
        setMessages((current) => [
          ...current,
          {
            id: messageId,
            role: "assistant",
            content: response.content,
            createdAt: new Date().toISOString(),
            taskId: task.id,
          },
        ]);
        await attachResponseArtifacts(messageId, task.id, response.content);
        setLoading(false);
        return;
      }

      const messageId = crypto.randomUUID();
      attachAssistantMessage(task.id, messageId);
      streamMessageIdRef.current = messageId;
      streamTaskIdRef.current = task.id;
      streamContentRef.current = "";
      setMessages((current) => [
        ...current,
        {
          id: messageId,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          taskId: task.id,
        },
      ]);
      setStreaming(true);

      const pending: Array<
        | { type: "delta"; payload: AgentStreamDelta }
        | { type: "done"; payload: AgentStreamDone }
        | { type: "error"; payload: AgentStreamError }
        | { type: "cancelled"; payload: AgentStreamCancelled }
      > = [];
      const handleEvent = (event: (typeof pending)[number]) => {
        const activeId = activeStreamIdRef.current;
        if (!activeId) {
          pending.push(event);
          return;
        }
        if (event.payload.streamId !== activeId) {
          return;
        }
        if (event.type === "delta") {
          streamContentRef.current += event.payload.delta;
          const content = streamContentRef.current;
          setMessages((current) =>
            current.map((message) =>
              message.id === messageId ? { ...message, content } : message,
            ),
          );
        } else if (event.type === "done") {
          finishStream("done");
        } else if (event.type === "cancelled") {
          finishStream("cancelled");
        } else {
          finishStream("error", event.payload.message);
        }
      };
      unlistenStreamRef.current = await listenToAgentStream({
        onDelta: (payload) => handleEvent({ type: "delta", payload }),
        onDone: (payload) => handleEvent({ type: "done", payload }),
        onError: (payload) => handleEvent({ type: "error", payload }),
        onCancelled: (payload) =>
          handleEvent({ type: "cancelled", payload }),
      });
      const response = await agentChatStream(request);
      activeStreamIdRef.current = response.streamId;
      for (const event of pending.splice(0)) {
        handleEvent(event);
      }
    } catch (reason) {
      unlistenStreamRef.current?.();
      unlistenStreamRef.current = undefined;
      activeStreamIdRef.current = undefined;
      streamMessageIdRef.current = undefined;
      streamTaskIdRef.current = undefined;
      streamContentRef.current = "";
      setStreaming(false);
      setError(String(reason));
      setLoading(false);
      throw reason;
    }
  };

  const send = async () => {
    try {
      await sendMessage(input, true);
    } catch {
      // sendMessage already reports the error in the pane.
    }
  };

  const sendCommandResult = async (
    run: TerminalCommandRun,
    capture: TerminalOutputCapture,
  ) => {
    const status =
      run.completionStatus ??
      (run.status === "completed" || run.status === "failed"
        ? run.status
        : "unknown");
    const duration =
      run.completedAt === undefined
        ? undefined
        : Math.max(
            0,
            (new Date(run.completedAt).getTime() -
              new Date(run.startedAt).getTime()) /
              1000,
          );
    const message = `Analyze this command result and suggest the next step.

Command:
\`\`\`bash
${run.command}
\`\`\`

Status: ${status}
Exit code: ${run.exitCode ?? "unknown"}
${duration === undefined ? "" : `Duration: ${duration.toFixed(1)}s\n`}
Terminal output:
\`\`\`text
${capture.output}
\`\`\``;
    await sendMessage(message, false, run.source?.taskId);
  };

  const sendToolResult = async (
    taskId: string,
    request: ToolRequest,
    result: ToolResult,
  ) => {
    const message = `Tool result for ${request.tool}:

<tool_result>
${result.output}
</tool_result>

Continue the analysis based on this result.`;
    await sendMessage(message, false, taskId);
  };

  const stop = async () => {
    const streamId = activeStreamIdRef.current;
    if (!streamId) {
      return;
    }
    try {
      await cancelAgentStream(streamId);
    } catch (reason) {
      setError(String(reason));
    }
  };

  const copyPatch = async (patch: ExtractedPatch) => {
    try {
      await navigator.clipboard.writeText(patch.raw);
      setError(undefined);
    } catch (reason) {
      setError(`Could not copy patch. ${String(reason)}`);
    }
  };

  const openPatchFiles = async (patch: ExtractedPatch) => {
    if (!patch.parsed) {
      setError("Patch could not be parsed.");
      return;
    }
    let opened = 0;
    let skipped = 0;
    for (const file of patch.parsed.files) {
      const relativePath = patchFilePath(file);
      const absolutePath = relativePath
        ? resolveWorkspacePath(rootPath, relativePath)
        : undefined;
      if (!absolutePath || file.isNewFile || file.isDeletedFile) {
        skipped += 1;
        continue;
      }
      try {
        await onOpenFile(absolutePath);
        opened += 1;
      } catch {
        skipped += 1;
      }
    }
    setError(
      skipped > 0
        ? `Opened ${opened} file(s); skipped ${skipped} unavailable file(s).`
        : undefined,
    );
  };

  const copyCodexHandoff = async (taskId: string) => {
    const task = getAgentTask(taskId);
    if (!task) {
      throw new Error("Agent task is no longer available.");
    }
    const taskMessages = messages.filter((message) => message.taskId === taskId);
    const userRequest =
      taskMessages.find((message) => message.role === "user")?.content ??
      task.title;
    const localAgentConclusion = [...taskMessages]
      .reverse()
      .find((message) => message.role === "assistant")?.content;
    const gitPane = panes
      .filter((candidate) => candidate.kind === "git")
      .sort((left, right) => right.zIndex - left.zIndex)[0];
    const gitRoot = gitPane?.payload.rootPath ?? rootPath;
    let gitStatusSummary: string | undefined;
    let selectedDiffSummary: string | undefined;
    if (gitRoot) {
      try {
        const status = await getGitStatus(gitRoot);
        gitStatusSummary = [
          `branch: ${status.branch ?? "unknown"}`,
          ...status.files.map((file) => `${file.status} ${file.path}`),
        ].join("\n");
        if (gitPane?.payload.selectedFile) {
          const diff = await getGitFileDiff(gitRoot, gitPane.payload.selectedFile);
          selectedDiffSummary = `${gitPane.payload.selectedFile}\n${diff}`;
        }
      } catch (reason) {
        gitStatusSummary = `Unavailable: ${String(reason)}`;
      }
    }
    const recentCommandResults = getTerminalCommandRunsForTask(taskId).map(
      (run) => {
        const capture = getTerminalOutputSinceRun(run.id);
        return `Command: ${run.command}\nStatus: ${
          run.completionStatus ?? run.status
        }\nExit code: ${run.exitCode ?? "unknown"}\nOutput:\n${capture.output}`;
      },
    );
    const prompt = buildCodexHandoffPrompt({
      taskTitle: task.title,
      userRequest,
      workspaceRoot: rootPath,
      gitStatusSummary,
      selectedDiffSummary,
      recentCommandResults,
      localAgentConclusion,
    });
    await navigator.clipboard.writeText(prompt);
  };

  const changePermissionProfile = (profile: AgentPermissionProfile) => {
    const next = selectPermissionProfile(profile, permissions);
    setPermissions(next);
    savePermissionSettings(next);
  };

  useEffect(() => {
    const togglePermissions = () => {
      changePermissionProfile(
        permissions.profile === "strict" ? "balanced" : "strict",
      );
    };
    const toggleToolLoop = () =>
      onUpdate(pane.id, {
        toolLoop: {
          ...pane.payload.toolLoop,
          enabled: !pane.payload.toolLoop.enabled,
        },
      });
    const searchWorkspace = () => setInput("Search the workspace for ");
    const prepareCodexHandoff = () => {
      const task = [...tasks].reverse().find((candidate) => candidate.status !== "closed");
      if (!task) {
        setError("Start an Agent task before preparing a Codex handoff.");
        return;
      }
      void copyCodexHandoff(task.id)
        .then(() => setError("Codex handoff copied to clipboard."))
        .catch((reason) => setError(String(reason)));
    };
    window.addEventListener("arc-toggle-agent-permissions", togglePermissions);
    window.addEventListener("arc-toggle-agent-tool-loop", toggleToolLoop);
    window.addEventListener("arc-search-workspace", searchWorkspace);
    window.addEventListener("arc-prepare-codex-handoff", prepareCodexHandoff);
    return () => {
      window.removeEventListener(
        "arc-toggle-agent-permissions",
        togglePermissions,
      );
      window.removeEventListener("arc-toggle-agent-tool-loop", toggleToolLoop);
      window.removeEventListener("arc-search-workspace", searchWorkspace);
      window.removeEventListener(
        "arc-prepare-codex-handoff",
        prepareCodexHandoff,
      );
    };
  });

  return (
    <div className="agent-pane">
      <div className="agent-settings">
        <label>
          <span>Endpoint</span>
          <input
            aria-label="Agent endpoint"
            disabled={loading}
            value={pane.payload.endpoint}
            onChange={(event) =>
              onUpdate(pane.id, { endpoint: event.target.value })
            }
          />
        </label>
        <label>
          <span>Model</span>
          <input
            aria-label="Agent model"
            disabled={loading}
            value={pane.payload.model}
            onChange={(event) =>
              onUpdate(pane.id, { model: event.target.value })
            }
          />
        </label>
        <label className="agent-setting-small">
          <span>Temp</span>
          <input
            aria-label="Agent temperature"
            disabled={loading}
            type="number"
            min="0"
            max="2"
            step="0.1"
            value={pane.payload.temperature}
            onChange={(event) =>
              updateNumber("temperature", event.target.value)
            }
          />
        </label>
        <label className="agent-setting-small">
          <span>Tokens</span>
          <input
            aria-label="Agent max tokens"
            disabled={loading}
            type="number"
            min="1"
            step="1"
            value={pane.payload.maxTokens}
            onChange={(event) => updateNumber("maxTokens", event.target.value)}
          />
        </label>
        <label className="agent-streaming-setting">
          <span>Mode</span>
          <span>
            <input
              aria-label="Stream responses"
              type="checkbox"
              checked={pane.payload.streaming ?? true}
              disabled={loading}
              onChange={(event) =>
                onUpdate(pane.id, { streaming: event.target.checked })
              }
            />
            Stream
          </span>
        </label>
        <label className="agent-streaming-setting agent-router-setting">
          <span>Router</span>
          <span>
            <input
              aria-label="Show Codex Router Suggestions"
              type="checkbox"
              checked={pane.payload.showCodexRouterSuggestions ?? true}
              disabled={loading}
              onChange={(event) =>
                onUpdate(pane.id, {
                  showCodexRouterSuggestions: event.target.checked,
                })
              }
            />
            Suggestions
          </span>
        </label>
      </div>
      <div className="agent-context-chips" aria-label="Agent context">
        {CONTEXT_LABELS.map(([key, label]) => (
          <button
            type="button"
            key={key}
            aria-pressed={context[key]}
            className={context[key] ? "agent-chip agent-chip--active" : "agent-chip"}
            onClick={() =>
              setContext((current) => ({ ...current, [key]: !current[key] }))
            }
          >
            {label}
          </button>
        ))}
      </div>
      <div className="agent-permissions">
        <label>
          <span>Permissions</span>
          <select
            aria-label="Agent permission profile"
            value={permissions.profile}
            onChange={(event) =>
              changePermissionProfile(
                event.target.value as AgentPermissionProfile,
              )
            }
          >
            <option value="strict">Strict</option>
            <option value="balanced">Balanced</option>
            <option value="fast_inspect">Fast Inspect</option>
            <option value="expert">Expert</option>
            <option value="custom">Custom</option>
          </select>
        </label>
        <label>
          <input
            aria-label="Read-only tool loop"
            type="checkbox"
            checked={pane.payload.toolLoop.enabled}
            disabled={workspaceTrust === "untrusted"}
            onChange={(event) => {
              onUpdate(pane.id, {
                toolLoop: {
                  ...pane.payload.toolLoop,
                  enabled: event.target.checked,
                },
              });
            }}
          />
          Read-only tool loop
        </label>
        <label>
          <span>Max tool turns</span>
          <select
            aria-label="Max tool turns"
            value={pane.payload.toolLoop.maxTurns}
            onChange={(event) =>
              onUpdate(pane.id, {
                toolLoop: {
                  ...pane.payload.toolLoop,
                  maxTurns: Number(event.target.value),
                },
              })
            }
          >
            <option value="1">1</option>
            <option value="3">3</option>
            <option value="5">5</option>
          </select>
        </label>
        {pane.payload.toolLoop.enabled && (
          <button
            type="button"
            onClick={() => {
              for (const task of tasks) {
                stoppedToolLoopsRef.current.add(task.id);
              }
              setError("Read-only tool loop stopped.");
            }}
          >
            Stop Tool Loop
          </button>
        )}
        <span>
          Workspace: {workspaceTrust} · Read tools:{" "}
          {effectivePermissions.readTools.replaceAll("_", " ")}
        </span>
      </div>
      <div className="agent-chat" aria-label="Agent chat history">
        {tasks.filter((task) => task.status !== "closed").length === 0 && (
          <div className="agent-chat-empty">
            Ask the local model about the selected workspace context.
          </div>
        )}
        {tasks
          .filter((task) => task.status !== "closed")
          .map((task) => (
            <AgentTaskCard
              key={task.id}
              task={task}
              onClose={closeAgentTask}
            >
              {(pane.payload.showCodexRouterSuggestions ?? true) &&
                routerDecisions
                  .filter(
                    (decision) =>
                      decision.taskId === task.id &&
                      decision.status === "suggested" &&
                      decision.recommendedWorker !== "local",
                  )
                  .map((decision) => (
                    <CodexRouterCard
                      key={decision.id}
                      decision={decision}
                      onDismiss={dismissRouterDecision}
                      onKeepLocal={keepTaskLocal}
                      onCopyHandoff={() => copyCodexHandoff(task.id)}
                    />
                  ))}
              {messages
                .filter((message) => message.taskId === task.id)
                .map((message) => (
                  <div
                    key={message.id}
                    className={`agent-message agent-message--${message.role}`}
                    data-task-id={task.id}
                  >
                    <strong>{message.role === "user" ? "You" : "Agent"}</strong>
                    <pre>{message.content}</pre>
                    {message.role === "assistant" &&
                      message.patches?.map(({ id, patch }, patchIndex) => {
                        const lines = patch.parsed?.files.flatMap((file) =>
                          file.hunks.flatMap((hunk) => hunk.lines),
                        );
                        const additions =
                          lines?.filter((line) => line.type === "add").length ??
                          0;
                        const deletions =
                          lines?.filter((line) => line.type === "remove")
                            .length ?? 0;
                        return (
                          <div
                            className="agent-patch-card"
                            key={`${id}-${patchIndex}`}
                            data-task-id={task.id}
                          >
                            <div>
                              <strong>Patch detected</strong>
                              <span>
                                Files: {patch.parsed?.files.length ?? 0} ·
                                Additions: +{additions} · Deletions: -
                                {deletions}
                              </span>
                              {patch.error && <span>{patch.error}</span>}
                            </div>
                            <div className="agent-patch-actions">
                              <button
                                type="button"
                                onClick={() => onPreviewPatch(id)}
                              >
                                Preview
                              </button>
                              <button
                                type="button"
                                onClick={() => void copyPatch(patch)}
                              >
                                Copy Patch
                              </button>
                              <button
                                type="button"
                                disabled={!patch.parsed}
                                onClick={() => void openPatchFiles(patch)}
                              >
                                Open Files
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    {message.role === "assistant" &&
                      message.commands?.map((proposal) => (
                        <CommandProposalCard
                          key={proposal.id}
                          proposal={proposal}
                          taskId={task.id}
                          workspaceRoot={rootPath}
                          permissions={effectivePermissions}
                          sourceAgentMessageId={message.id}
                          terminals={terminalOptions}
                          defaultTerminalId={defaultTerminalId}
                          onRun={onRunCommand}
                          onRunInNewTerminal={onRunCommandInNewTerminal}
                          onSendResultToAgent={sendCommandResult}
                          onOpenTerminal={onFocusTerminal}
                        />
                      ))}
                    {message.role === "assistant" &&
                      message.tools?.map(({ request, result }) => (
                        <ToolRequestCard
                          key={request.id}
                          taskId={task.id}
                          request={request}
                          result={result}
                          permission={effectivePermissions.readTools}
                          onRun={async (toolRequest) => {
                            await runTool(task.id, message.id, toolRequest);
                          }}
                          onSendResult={(toolRequest, toolResult) =>
                            sendToolResult(task.id, toolRequest, toolResult)
                          }
                          onOpenFile={async (path) => {
                            const absolutePath = resolveWorkspacePath(
                              rootPath,
                              path,
                            );
                            if (!absolutePath) {
                              throw new Error(
                                "Tool result path is outside the workspace.",
                              );
                            }
                            await onOpenFile(absolutePath);
                          }}
                        />
                      ))}
                  </div>
                ))}
            </AgentTaskCard>
          ))}
        {loading && (
          <div className="agent-loading">
            {streaming ? "streaming..." : "Waiting for local model..."}
          </div>
        )}
        {error && <div className="agent-error">{error}</div>}
        <div ref={chatEndRef} />
      </div>
      <div className="agent-input">
        <textarea
          aria-label="Agent message"
          value={input}
          placeholder="Ask Arc Agent..."
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
        />
        <button
          type="button"
          disabled={!loading && !input.trim()}
          onClick={() => void (streaming ? stop() : send())}
        >
          {streaming ? "Stop" : "Send"}
        </button>
      </div>
    </div>
  );
}
