import { useEffect, useRef, useState } from "react";
import {
  buildAgentContext,
  SYSTEM_PROMPT,
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
import {
  attachAssistantMessage,
  attachCommandProposal,
  attachPatch,
  attachUserMessage,
  closeAgentTask,
  createAgentTask,
} from "../agent/tasks/taskStore";
import {
  useTerminalRuntime,
  type TerminalCommandRun,
  type TerminalOutputCapture,
} from "../terminal/terminalRuntime";
import type { ExtractedPatch, PatchFile } from "../patch/patchTypes";
import type {
  AgentFloatingPane,
  FloatingPaneState,
} from "../workspace/floatingPaneTypes";

type Props = {
  pane: AgentFloatingPane;
  panes: FloatingPaneState[];
  rootPath?: string;
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
  ) => Promise<TerminalCommandRun>;
  onRunCommandInNewTerminal: (
    command: string,
    risk: import("../commands/commandTypes").CommandRisk,
    source?: TerminalCommandRun["source"],
    shellHint?: import("../commands/commandTypes").ShellHint,
  ) => Promise<TerminalCommandRun>;
  onFocusTerminal: (paneId: string) => void;
};

type ChatMessage = AgentMessage & {
  id: string;
  createdAt: string;
  taskId: string;
  patches?: Array<{ id: string; patch: ExtractedPatch }>;
  commands?: CommandProposal[];
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

export function AgentPane({
  pane,
  panes,
  rootPath,
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
  const chatEndRef = useRef<HTMLDivElement>(null);
  const activeStreamIdRef = useRef<string | undefined>(undefined);
  const streamMessageIdRef = useRef<string | undefined>(undefined);
  const streamTaskIdRef = useRef<string | undefined>(undefined);
  const streamContentRef = useRef("");
  const unlistenStreamRef = useRef<(() => void) | undefined>(undefined);
  const terminalRuntime = useTerminalRuntime();
  const tasks = useAgentTasks();
  const terminalPanes = panes
    .filter((candidate) => candidate.kind === "terminal")
    .sort((left, right) => right.zIndex - left.zIndex);
  const terminalOptions = terminalPanes.map((terminal) => ({
    paneId: terminal.id,
    title: terminal.title,
    ready: terminalRuntime.some(
      (runtime) => runtime.paneId === terminal.id && !!runtime.sessionId,
    ),
  }));
  const defaultTerminalId = terminalPanes[0]?.id;

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

  const attachResponseArtifacts = (
    messageId: string,
    taskId: string,
    content: string,
  ) => {
    const patches = extractPatchesFromText(content).map((patch) => ({
      id: storePatch(patch, taskId),
      patch,
    }));
    const commands = extractCommandProposals(content);
    for (const patch of patches) {
      attachPatch(taskId, patch.id);
    }
    for (const command of commands) {
      attachCommandProposal(taskId, command.id);
    }
    setMessages((current) =>
      current.map((message) =>
        message.id === messageId
          ? { ...message, content, patches, commands }
          : message,
      ),
    );
  };

  const finishStream = (
    kind: "done" | "cancelled" | "error",
    message?: string,
  ) => {
    const messageId = streamMessageIdRef.current;
    const taskId = streamTaskIdRef.current;
    const content = streamContentRef.current;
    if (messageId && taskId && content && kind !== "error") {
      attachResponseArtifacts(messageId, taskId, content);
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
    const userMessage: ChatMessage = {
      id: userMessageId,
      role: "user",
      content: requestText,
      createdAt: new Date().toISOString(),
      taskId: task.id,
    };
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
      const composed = contextText
        ? `Context:\n${contextText}\n\nUser request:\n${requestText}`
        : requestText;
      const request = {
        endpoint: pane.payload.endpoint,
        model: pane.payload.model,
        temperature: pane.payload.temperature,
        maxTokens: pane.payload.maxTokens,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
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
        attachResponseArtifacts(messageId, task.id, response.content);
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
                          sourceAgentMessageId={message.id}
                          terminals={terminalOptions}
                          defaultTerminalId={defaultTerminalId}
                          onRun={onRunCommand}
                          onRunInNewTerminal={onRunCommandInNewTerminal}
                          onSendResultToAgent={sendCommandResult}
                          onOpenTerminal={onFocusTerminal}
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
