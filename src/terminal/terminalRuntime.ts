import { useSyncExternalStore } from "react";
import type { CommandRisk } from "../commands/commandTypes";
import type { ShellHint } from "../commands/commandTypes";
import type { CommandRunLocation } from "../commands/commandRiskTypes";
import { redactSecrets, stripAnsi } from "../agent/redaction";
import {
  attachCommandRun,
  setAgentTaskStatus,
} from "../agent/tasks/taskStore";
import { recordRouterCommandFailure } from "../agent/router/routerStore";

export type TerminalRuntimeEntry = {
  paneId: string;
  sessionId?: string;
  output: string;
  outputBaseOffset: number;
  outputEndOffset: number;
  cwd?: string;
};

const MAX_OUTPUT_CHARS = 50_000;
const MAX_CAPTURE_CHARS = 20_000;

export type TerminalCommandRun = {
  id: string;
  terminalPaneId: string;
  sessionId: string;
  command: string;
  risk: CommandRisk;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  outputStartOffset: number;
  outputEndOffset?: number;
  status:
    | "pending"
    | "running"
    | "completed"
    | "failed"
    | "captured"
    | "sent_to_agent"
    | "unknown";
  completionStatus?: "completed" | "failed" | "unknown";
  shellHint?: ShellHint;
  runLocation: CommandRunLocation;
  workspaceRoot?: string;
  cwdBefore?: string;
  cwdAfter?: string;
  source?: {
    agentMessageId?: string;
    proposalId?: string;
    taskId?: string;
  };
};

export type TerminalOutputCapture = {
  output: string;
  rawLength: number;
  truncated: boolean;
};

const entries = new Map<string, TerminalRuntimeEntry>();
const commandRuns = new Map<string, TerminalCommandRun>();
const listeners = new Set<() => void>();
const sessionWaiters = new Map<
  string,
  Set<(sessionId: string | undefined) => void>
>();
const removalTimers = new Map<string, number>();
let snapshot: TerminalRuntimeEntry[] = [];
let runSnapshot: TerminalCommandRun[] = [];

function publish() {
  snapshot = Array.from(entries.values(), (entry) => ({ ...entry }));
  runSnapshot = Array.from(commandRuns.values(), (run) => ({ ...run }));
  for (const listener of listeners) {
    listener();
  }
}

export function registerTerminalSession(paneId: string, sessionId: string) {
  const removalTimer = removalTimers.get(paneId);
  if (removalTimer !== undefined) {
    window.clearTimeout(removalTimer);
    removalTimers.delete(paneId);
  }
  const current = entries.get(paneId);
  entries.set(paneId, {
    paneId,
    sessionId,
    output: current?.output ?? "",
    outputBaseOffset: current?.outputBaseOffset ?? 0,
    outputEndOffset: current?.outputEndOffset ?? 0,
    cwd: current?.cwd,
  });
  for (const waiter of sessionWaiters.get(paneId) ?? []) {
    waiter(sessionId);
  }
  sessionWaiters.delete(paneId);
  publish();
}

export function appendTerminalOutput(paneId: string, data: string) {
  const current = entries.get(paneId) ?? {
    paneId,
    output: "",
    outputBaseOffset: 0,
    outputEndOffset: 0,
  };
  const combined = `${current.output}${data}`;
  const trimmedChars = Math.max(0, combined.length - MAX_OUTPUT_CHARS);
  entries.set(paneId, {
    ...current,
    output: trimmedChars > 0 ? combined.slice(trimmedChars) : combined,
    outputBaseOffset: current.outputBaseOffset + trimmedChars,
    outputEndOffset: current.outputEndOffset + data.length,
  });
  parseCommandMarkers(paneId);
  publish();
}

function parseCommandMarkers(paneId: string) {
  const terminal = entries.get(paneId);
  if (!terminal) {
    return;
  }
  for (const [runId, run] of commandRuns) {
    if (run.terminalPaneId !== paneId) {
      continue;
    }
    const cwdBefore = findCwdMarker(terminal.output, "BEFORE", runId);
    if (cwdBefore && cwdBefore !== run.cwdBefore) {
      commandRuns.set(runId, { ...run, cwdBefore });
      entries.set(paneId, { ...terminal, cwd: cwdBefore });
    }
    const cwdAfter = findCwdMarker(terminal.output, "AFTER", runId);
    if (cwdAfter) {
      entries.set(paneId, { ...terminal, cwd: cwdAfter });
      const latest = commandRuns.get(runId)!;
      commandRuns.set(runId, { ...latest, cwdAfter });
    }
    if (run.completedAt) {
      continue;
    }
    const currentBeforeStart = commandRuns.get(runId)!;
    const startPattern = new RegExp(
      `(?:^|\\r?\\n)__ARC_CMD_START:${escapeRegExp(runId)}__(?:\\r?\\n|$)`,
    );
    const startMatch = startPattern.exec(terminal.output);
    if (startMatch) {
      const markerOffset =
        terminal.outputBaseOffset +
        startMatch.index +
        startMatch[0].length;
      if (run.outputStartOffset !== markerOffset) {
        commandRuns.set(runId, {
          ...currentBeforeStart,
          outputStartOffset: markerOffset,
          status: "running",
        });
      }
    }
    const current = commandRuns.get(runId)!;
    const endPattern = new RegExp(
      `(?:^|\\r?\\n)__ARC_CMD_END:${escapeRegExp(runId)}:(-?\\d+)__(?:\\r?\\n|$)`,
    );
    const endMatch = endPattern.exec(terminal.output);
    if (!endMatch) {
      continue;
    }
    const exitCode = Number(endMatch[1]);
    const prefixLength = endMatch[0].startsWith("\r\n")
      ? 2
      : endMatch[0].startsWith("\n")
        ? 1
        : 0;
    const outputEndOffset =
      terminal.outputBaseOffset + endMatch.index + prefixLength;
    commandRuns.set(runId, {
      ...current,
      completedAt: new Date().toISOString(),
      exitCode,
      outputEndOffset,
      status:
        current.status === "captured" || current.status === "sent_to_agent"
          ? current.status
          : exitCode === 0
            ? "completed"
            : "failed",
      completionStatus: exitCode === 0 ? "completed" : "failed",
    });
    if (current.source?.taskId) {
      setAgentTaskStatus(
        current.source.taskId,
        exitCode === 0 ? "command_completed" : "command_failed",
      );
      if (exitCode !== 0) {
        recordRouterCommandFailure(current.source.taskId);
      }
    }
  }
}

function findCwdMarker(
  output: string,
  phase: "BEFORE" | "AFTER",
  runId: string,
): string | undefined {
  const pattern = new RegExp(
    `__ARC_CWD_${phase}:${escapeRegExp(runId)}:([^\\r\\n]*?)__`,
  );
  return pattern.exec(output)?.[1]?.trim() || undefined;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function unregisterTerminal(paneId: string) {
  window.clearTimeout(removalTimers.get(paneId));
  removalTimers.set(
    paneId,
    window.setTimeout(() => {
      removalTimers.delete(paneId);
      entries.delete(paneId);
      for (const waiter of sessionWaiters.get(paneId) ?? []) {
        waiter(undefined);
      }
      sessionWaiters.delete(paneId);
      publish();
    }, 0),
  );
}

export function getTerminalRuntime(paneId: string) {
  return entries.get(paneId);
}

export function recordTerminalCommandRun(input: {
  paneId: string;
  command: string;
  risk: CommandRisk;
  source?: TerminalCommandRun["source"];
  shellHint?: ShellHint;
  runLocation?: CommandRunLocation;
  workspaceRoot?: string;
}): TerminalCommandRun {
  const terminal = entries.get(input.paneId);
  if (!terminal?.sessionId) {
    throw new Error("Selected terminal session is not ready.");
  }
  const run: TerminalCommandRun = {
    id: crypto.randomUUID(),
    terminalPaneId: input.paneId,
    sessionId: terminal.sessionId,
    command: input.command,
    risk: input.risk,
    startedAt: new Date().toISOString(),
    outputStartOffset: terminal.outputEndOffset,
    status: "pending",
    shellHint: input.shellHint,
    runLocation: input.runLocation ?? "terminal_cwd",
    workspaceRoot: input.workspaceRoot,
    source: input.source,
  };
  commandRuns.set(run.id, run);
  if (run.source?.taskId) {
    attachCommandRun(run.source.taskId, run.id);
  }
  publish();
  return { ...run };
}

export function getTerminalCommandRun(runId: string) {
  const run = commandRuns.get(runId);
  return run ? { ...run } : undefined;
}

export function getTerminalOutputSinceRun(
  runId: string,
): TerminalOutputCapture {
  const run = commandRuns.get(runId);
  if (!run) {
    throw new Error("Command run marker was not found.");
  }
  const terminal = entries.get(run.terminalPaneId);
  if (!terminal) {
    return { output: "No captured output yet.", rawLength: 0, truncated: false };
  }
  const lostPrefix = run.outputStartOffset < terminal.outputBaseOffset;
  const start = Math.max(
    0,
    run.outputStartOffset - terminal.outputBaseOffset,
  );
  const rawEnd =
    run.outputEndOffset === undefined
      ? terminal.outputEndOffset
      : Math.min(run.outputEndOffset, terminal.outputEndOffset);
  const end = Math.max(start, rawEnd - terminal.outputBaseOffset);
  const raw = terminal.output.slice(start, end);
  const withoutMarkers = raw
    .replace(
      new RegExp(
        `(?:^|\\r?\\n)__ARC_CMD_(?:START:${escapeRegExp(run.id)}|END:${escapeRegExp(run.id)}:-?\\d+)__(?:\\r?\\n|$)`,
        "g",
      ),
      "\n",
    )
    .replace(
      new RegExp(
        `(?:^|\\r?\\n)__ARC_CWD_(?:BEFORE|AFTER):${escapeRegExp(run.id)}:[^\\r\\n]*?__(?:\\r?\\n|$)`,
        "g",
      ),
      "\n",
    )
    .trimStart();
  const clean = redactSecrets(stripAnsi(withoutMarkers));
  const sizeTruncated = clean.length > MAX_CAPTURE_CHARS;
  const output = sizeTruncated
    ? clean.slice(clean.length - MAX_CAPTURE_CHARS)
    : clean;
  const truncated = lostPrefix || sizeTruncated;
  return {
    output: `${truncated ? "[truncated]\n" : ""}${
      output || "No captured output yet."
    }`,
    rawLength: raw.length,
    truncated,
  };
}

export function captureTerminalCommandRun(runId: string): TerminalCommandRun {
  const run = commandRuns.get(runId);
  if (!run) {
    throw new Error("Command run marker was not found.");
  }
  const terminal = entries.get(run.terminalPaneId);
  const updated: TerminalCommandRun = {
    ...run,
    outputEndOffset:
      run.outputEndOffset ??
      terminal?.outputEndOffset ??
      run.outputStartOffset,
    status: "captured",
    completionStatus:
      run.completionStatus ??
      (run.completedAt
        ? run.exitCode === 0
          ? "completed"
          : "failed"
        : "unknown"),
  };
  commandRuns.set(runId, updated);
  publish();
  return { ...updated };
}

export function markTerminalCommandRunSent(runId: string) {
  const run = commandRuns.get(runId);
  if (run) {
    commandRuns.set(runId, { ...run, status: "sent_to_agent" });
    publish();
  }
}

export function getLatestTerminalCommandRun(paneId: string) {
  return Array.from(commandRuns.values())
    .filter((run) => run.terminalPaneId === paneId)
    .sort((left, right) => right.startedAt.localeCompare(left.startedAt))[0];
}

export function getTerminalCommandRunsForTask(taskId: string) {
  return Array.from(commandRuns.values())
    .filter((run) => run.source?.taskId === taskId)
    .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    .map((run) => ({ ...run }));
}

export function useTerminalCommandRun(runId: string): TerminalCommandRun {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => runSnapshot.find((run) => run.id === runId) ?? getMissingRun(runId),
    () => runSnapshot.find((run) => run.id === runId) ?? getMissingRun(runId),
  );
}

function getMissingRun(runId: string): TerminalCommandRun {
  const run = commandRuns.get(runId);
  if (!run) {
    throw new Error("Command run marker was not found.");
  }
  return { ...run };
}

export function waitForTerminalSession(
  paneId: string,
  timeoutMs = 10_000,
): Promise<string> {
  const existing = entries.get(paneId)?.sessionId;
  if (existing) {
    return Promise.resolve(existing);
  }
  return new Promise((resolve, reject) => {
    const waiters =
      sessionWaiters.get(paneId) ?? new Set<(sessionId?: string) => void>();
    const timer = window.setTimeout(() => {
      waiters.delete(complete);
      reject(new Error("Terminal session did not become ready."));
    }, timeoutMs);
    const complete = (sessionId?: string) => {
      window.clearTimeout(timer);
      waiters.delete(complete);
      if (sessionId) {
        resolve(sessionId);
      } else {
        reject(new Error("Terminal pane closed before its session was ready."));
      }
    };
    waiters.add(complete);
    sessionWaiters.set(paneId, waiters);
  });
}

export function useTerminalRuntime(): TerminalRuntimeEntry[] {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => snapshot,
    () => snapshot,
  );
}
