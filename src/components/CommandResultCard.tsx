import { useEffect, useState } from "react";
import {
  setActivityCollapsed,
  upsertArtifactActivity,
  useAgentActivities,
} from "../agent/activity/activityStore";
import type { CommandRiskAnalysis } from "../commands/commandRiskTypes";
import { detectCwdMismatch } from "../commands/detectCwdMismatch";
import {
  captureTerminalCommandRun,
  getTerminalOutputSinceRun,
  markTerminalCommandRunSent,
  type TerminalCommandRun,
  type TerminalOutputCapture,
  useTerminalCommandRun,
} from "../terminal/terminalRuntime";
import { AgentActivityRow } from "./AgentActivityRow";

type Props = {
  run: TerminalCommandRun;
  analysis: CommandRiskAnalysis;
  terminalTitle: string;
  onSendToAgent: (
    run: TerminalCommandRun,
    capture: TerminalOutputCapture,
  ) => Promise<void>;
  onOpenTerminal: (paneId: string) => void;
};

function formatSize(length: number): string {
  return length < 1024
    ? `${length} B`
    : `${(length / 1024).toFixed(1)} KB`;
}

export function CommandResultCard({
  run,
  analysis,
  terminalTitle,
  onSendToAgent,
  onOpenTerminal,
}: Props) {
  const liveRun = useTerminalCommandRun(run.id);
  const activities = useAgentActivities();
  const activity = activities.find(
    (candidate) => candidate.artifactId === run.id,
  );
  const [capture, setCapture] = useState<TerminalOutputCapture>(() =>
    getTerminalOutputSinceRun(run.id),
  );
  const [status, setStatus] = useState<string>();
  const [sending, setSending] = useState(false);
  const completionStatus =
    liveRun.completionStatus ??
    (liveRun.status === "completed" || liveRun.status === "failed"
      ? liveRun.status
      : liveRun.status === "pending" || liveRun.status === "running"
        ? liveRun.status
        : "running");
  const duration =
    liveRun.completedAt === undefined
      ? undefined
      : Math.max(
          0,
          (new Date(liveRun.completedAt).getTime() -
            new Date(liveRun.startedAt).getTime()) /
            1000,
        );

  useEffect(() => {
    upsertArtifactActivity(run.id, {
      taskId: liveRun.source?.taskId ?? "",
      kind: "command_result",
      status:
        completionStatus === "failed"
          ? "failed"
          : completionStatus === "completed"
            ? "completed"
            : "running",
      title:
        completionStatus === "failed"
          ? "Command failed"
          : completionStatus === "completed"
            ? "Command completed"
            : "Command running",
      summary: [
        liveRun.exitCode === undefined ? undefined : `exit ${liveRun.exitCode}`,
        duration === undefined ? undefined : `${duration.toFixed(1)}s`,
        formatSize(capture.rawLength),
        terminalTitle,
        liveRun.runLocation === "workspace_root"
          ? "workspace root"
          : "terminal cwd",
      ]
        .filter(Boolean)
        .join(" · "),
      metadata: {
        terminal: terminalTitle,
        cwd: liveRun.cwdBefore,
        cwdAfter: liveRun.cwdAfter,
        workspaceRoot: liveRun.workspaceRoot,
        runLocation: liveRun.runLocation,
        exitCode: liveRun.exitCode,
        duration,
        outputBytes: capture.rawLength,
        truncated: capture.truncated,
      },
    });
  }, [
    capture.rawLength,
    completionStatus,
    duration,
    liveRun.exitCode,
    liveRun.runLocation,
    liveRun.source?.taskId,
    run.id,
    terminalTitle,
  ]);

  const refresh = () => {
    captureTerminalCommandRun(run.id);
    const next = getTerminalOutputSinceRun(run.id);
    setCapture(next);
    setStatus("Output captured.");
    return next;
  };

  const copy = async () => {
    const next = refresh();
    await navigator.clipboard.writeText(next.output);
    setStatus("Captured output copied.");
  };

  const send = async () => {
    const next = refresh();
    setSending(true);
    setStatus(undefined);
    try {
      await onSendToAgent(liveRun, next);
      markTerminalCommandRunSent(run.id);
      setStatus("Output sent to Agent.");
    } catch (reason) {
      setStatus(String(reason));
    } finally {
      setSending(false);
    }
  };

  if (!activity) {
    return null;
  }

  const cwdMismatch = detectCwdMismatch(
    liveRun.command,
    capture.output,
    liveRun.runLocation,
    liveRun.cwdBefore,
    liveRun.workspaceRoot,
  );

  return (
    <AgentActivityRow
      activity={activity}
      onToggle={setActivityCollapsed}
      actions={
        <>
          <button type="button" disabled={sending} onClick={() => void send()}>
            Send Output to Agent
          </button>
          <button type="button" onClick={() => void copy()}>
            Copy Output
          </button>
          <button
            type="button"
            onClick={() => onOpenTerminal(run.terminalPaneId)}
          >
            Open Terminal
          </button>
        </>
      }
    >
      <div
        className={`command-result command-result--${completionStatus}`}
        data-task-id={liveRun.source?.taskId}
      >
        <div className="command-result__header">
          <strong>Command result</strong>
          <span className="command-result__state">{completionStatus}</span>
          {liveRun.exitCode !== undefined && <span>exit {liveRun.exitCode}</span>}
          {duration !== undefined && <span>{duration.toFixed(1)}s</span>}
          <span>{terminalTitle}</span>
        </div>
        <pre>{liveRun.command}</pre>
        <div className="command-result__meta">
          Terminal: {terminalTitle}
          {" · "}Terminal cwd: {liveRun.cwdBefore ?? "unknown"}
          {" · "}Workspace root: {liveRun.workspaceRoot ?? "none"}
          {" · "}Run from:{" "}
          {liveRun.runLocation === "workspace_root"
            ? liveRun.workspaceRoot ?? "workspace root"
            : "terminal cwd"}
          {liveRun.cwdAfter ? ` · Cwd after: ${liveRun.cwdAfter}` : ""}
          {" · "}Risk: {analysis.risk} / {analysis.category}
          {" · "}Captured: {formatSize(capture.rawLength)}
          {capture.truncated ? " (truncated)" : ""}
        </div>
        <pre className="command-result__output">{capture.output}</pre>
        {cwdMismatch && (
          <div className="command-result__cwd-hint">
            This command may have been run outside the workspace root. Try
            running it from the workspace root.
          </div>
        )}
        <div className="command-result__controls">
          <button type="button" onClick={refresh}>
            Capture Output
          </button>
        </div>
        {status && <div className="command-result__status">{status}</div>}
      </div>
    </AgentActivityRow>
  );
}
