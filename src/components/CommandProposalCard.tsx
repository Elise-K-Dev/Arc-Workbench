import { useEffect, useMemo, useState } from "react";
import {
  addAgentActivity,
  setActivityCollapsed,
  useAgentActivities,
} from "../agent/activity/activityStore";
import { evaluateCommandPermission } from "../agent/permissions/evaluateCommandPermission";
import type { AgentPermissionSettings } from "../agent/permissions/permissionTypes";
import { classifyCommandRisk } from "../commands/classifyCommandRisk";
import type { CommandRunLocation } from "../commands/commandRiskTypes";
import type { CommandProposal } from "../commands/commandTypes";
import type {
  TerminalCommandRun,
  TerminalOutputCapture,
} from "../terminal/terminalRuntime";
import { AgentActivityRow } from "./AgentActivityRow";
import { CommandResultCard } from "./CommandResultCard";

export type CommandTerminalOption = {
  paneId: string;
  title: string;
  ready: boolean;
};

type Props = {
  proposal: CommandProposal;
  terminals: CommandTerminalOption[];
  defaultTerminalId?: string;
  sourceAgentMessageId: string;
  taskId: string;
  workspaceRoot?: string;
  permissions: AgentPermissionSettings;
  onRun: (
    paneId: string,
    command: string,
    risk: import("../commands/commandTypes").CommandRisk,
    source?: TerminalCommandRun["source"],
    shellHint?: import("../commands/commandTypes").ShellHint,
    runLocation?: CommandRunLocation,
  ) => Promise<TerminalCommandRun>;
  onRunInNewTerminal: (
    command: string,
    risk: import("../commands/commandTypes").CommandRisk,
    source?: TerminalCommandRun["source"],
    shellHint?: import("../commands/commandTypes").ShellHint,
    runLocation?: CommandRunLocation,
  ) => Promise<TerminalCommandRun>;
  onSendResultToAgent: (
    run: TerminalCommandRun,
    capture: TerminalOutputCapture,
  ) => Promise<void>;
  onOpenTerminal: (paneId: string) => void;
};

export function CommandProposalCard({
  proposal,
  terminals,
  defaultTerminalId,
  sourceAgentMessageId,
  taskId,
  workspaceRoot,
  permissions,
  onRun,
  onRunInNewTerminal,
  onSendResultToAgent,
  onOpenTerminal,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [command, setCommand] = useState(proposal.raw);
  const [targetId, setTargetId] = useState(defaultTerminalId ?? "");
  const [runLocation, setRunLocation] = useState<CommandRunLocation>(
    workspaceRoot ? "workspace_root" : "terminal_cwd",
  );
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>();
  const [runs, setRuns] = useState<TerminalCommandRun[]>([]);
  const [reviewMode, setReviewMode] = useState<
    "strong_confirm" | "typed_confirm"
  >();
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [reviewNewTerminal, setReviewNewTerminal] = useState(false);
  const activities = useAgentActivities();
  const activity = activities.find(
    (candidate) => candidate.artifactId === proposal.id,
  );
  const analysis = useMemo(() => classifyCommandRisk(command), [command]);
  const permission = evaluateCommandPermission(analysis, permissions);

  useEffect(() => {
    if (!activity) {
      addAgentActivity({
        taskId,
        kind: "command_proposal",
        status: "awaiting_approval",
        title: "Command proposal",
        summary: `${analysis.category} · ${analysis.risk}`,
        artifactId: proposal.id,
        collapsed: command.length > 180 || command.includes("\n"),
      });
    }
  }, [
    activity,
    analysis.category,
    analysis.risk,
    command,
    proposal.id,
    taskId,
  ]);

  useEffect(() => {
    if (
      !targetId ||
      !terminals.some((terminal) => terminal.paneId === targetId)
    ) {
      setTargetId(defaultTerminalId ?? terminals[0]?.paneId ?? "");
    }
  }, [defaultTerminalId, targetId, terminals]);

  const execute = async (newTerminal: boolean) => {
    const text = command.trim();
    if (!text || permission === "copy_only") {
      return;
    }
    if (!newTerminal && !targetId) {
      setStatus("No terminal pane available. Create one first.");
      return;
    }
    setRunning(true);
    setStatus(undefined);
    setReviewMode(undefined);
    setReviewNewTerminal(false);
    setTypedConfirmation("");
    try {
      const source = {
        agentMessageId: sourceAgentMessageId,
        proposalId: proposal.id,
        taskId,
      };
      const run = newTerminal
        ? await onRunInNewTerminal(
            text,
            analysis.risk,
            source,
            proposal.shellHint,
            runLocation,
          )
        : await onRun(
            targetId,
            text,
            analysis.risk,
            source,
            proposal.shellHint,
            runLocation,
          );
      setRuns((current) => [...current, run]);
      if (activity) {
        setActivityCollapsed(activity.id, true);
      }
      setStatus(
        newTerminal
          ? "Command sent to a new visible terminal."
          : "Command sent to the visible terminal.",
      );
    } catch (reason) {
      setStatus(String(reason));
    } finally {
      setRunning(false);
    }
  };

  const requestRun = (newTerminal: boolean) => {
    if (permission === "strong_confirm" || permission === "typed_confirm") {
      setReviewNewTerminal(newTerminal);
      setReviewMode(permission);
      return;
    }
    void execute(newTerminal);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setStatus("Command copied.");
    } catch (reason) {
      setStatus(`Could not copy command. ${String(reason)}`);
    }
  };

  if (!activity) {
    return null;
  }

  return (
    <>
      <AgentActivityRow
        activity={activity}
        onToggle={setActivityCollapsed}
        actions={
          <>
            {permission === "ask" || permission === "auto_allow" ? (
              <button
                type="button"
                disabled={running || !targetId || !command.trim()}
                onClick={() => requestRun(false)}
              >
                Run
              </button>
            ) : permission === "strong_confirm" ? (
              <button
                type="button"
                disabled={running || !targetId || !command.trim()}
                onClick={() => requestRun(false)}
              >
                Review & Run
              </button>
            ) : permission === "typed_confirm" ? (
              <button
                type="button"
                disabled={running || !targetId || !command.trim()}
                onClick={() => requestRun(false)}
              >
                Advanced Run
              </button>
            ) : null}
            <button type="button" onClick={() => void copy()}>
              {permission === "copy_only" ? "Copy Only" : "Copy"}
            </button>
          </>
        }
      >
        <div
          className={`command-proposal command-proposal--${analysis.risk}`}
          data-task-id={taskId}
        >
          <div className="command-proposal__header">
            <strong>Command review</strong>
            <span>{proposal.shellHint ?? "shell"}</span>
            <span className={`command-risk command-risk--${analysis.risk}`}>
              {analysis.risk}
            </span>
            <span>{analysis.category}</span>
          </div>
          {editing ? (
            <textarea
              aria-label="Edit proposed command"
              value={command}
              onChange={(event) => setCommand(event.target.value)}
            />
          ) : (
            <pre>{command}</pre>
          )}
          <div className="command-proposal__analysis">
            <strong>Risk analysis</strong>
            <ul>
              {analysis.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            <div>Detected: {analysis.detectedPatterns.join(", ")}</div>
            {analysis.affectedScope?.length ? (
              <div>Scope: {analysis.affectedScope.join(" ")}</div>
            ) : null}
            {analysis.saferAlternative && (
              <div>Safer alternative: {analysis.saferAlternative}</div>
            )}
          </div>
          <div className="command-proposal__permission">
            {permission === "auto_allow"
              ? "Auto-run allowed by current permission profile. One-click Run is still required."
              : `Permission: ${permission.replaceAll("_", " ")}`}
          </div>
          <div className="command-proposal__controls">
            <select
              aria-label="Target terminal"
              value={targetId}
              onChange={(event) => setTargetId(event.target.value)}
            >
              {terminals.length === 0 && <option value="">No terminal</option>}
              {terminals.map((terminal) => (
                <option
                  key={terminal.paneId}
                  value={terminal.paneId}
                  disabled={!terminal.ready}
                >
                  {terminal.title}
                  {terminal.ready ? "" : " (starting)"}
                </option>
              ))}
            </select>
            <select
              aria-label="Run from"
              value={runLocation}
              onChange={(event) =>
                setRunLocation(event.target.value as CommandRunLocation)
              }
            >
              {workspaceRoot && (
                <option value="workspace_root">Workspace root</option>
              )}
              <option value="terminal_cwd">Terminal cwd</option>
            </select>
            <button
              type="button"
              onClick={() => setEditing((current) => !current)}
            >
              {editing ? "Done" : "Edit"}
            </button>
            <button
              type="button"
              disabled={running || !command.trim()}
              onClick={() => {
                if (
                  permission === "strong_confirm" ||
                  permission === "typed_confirm"
                ) {
                  setReviewMode(permission);
                  setReviewNewTerminal(true);
                } else {
                  void execute(true);
                }
              }}
            >
              Run in New Terminal
            </button>
            <button
              type="button"
              onClick={() => {
                setStatus("Command cancelled.");
                setActivityCollapsed(activity.id, true);
              }}
            >
              Cancel
            </button>
          </div>
          {status && <div className="command-proposal__status">{status}</div>}
        </div>
      </AgentActivityRow>
      {runs.map((run) => (
        <CommandResultCard
          key={run.id}
          run={run}
          analysis={analysis}
          terminalTitle={
            terminals.find(
              (terminal) => terminal.paneId === run.terminalPaneId,
            )?.title ?? "terminal"
          }
          onSendToAgent={onSendResultToAgent}
          onOpenTerminal={onOpenTerminal}
        />
      ))}
      {reviewMode && (
        <div className="command-confirm-overlay" role="presentation">
          <div
            className="command-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label={
              reviewMode === "typed_confirm"
                ? "Dangerous command confirmation"
                : "Command confirmation"
            }
          >
            <strong>
              {reviewMode === "typed_confirm"
                ? "This command is potentially destructive."
                : "This command may modify files or project state."}
            </strong>
            <pre>{command}</pre>
            <div>Risk: {analysis.risk}</div>
            <ul>
              {analysis.reasons.map((reason) => (
                <li key={reason}>{reason}</li>
              ))}
            </ul>
            {reviewMode === "typed_confirm" && (
              <label>
                <span>To run this command, type RUN</span>
                <input
                  aria-label="Type RUN to confirm"
                  value={typedConfirmation}
                  onChange={(event) => setTypedConfirmation(event.target.value)}
                />
              </label>
            )}
            <div className="command-confirm-dialog__actions">
              <button type="button" onClick={() => setReviewMode(undefined)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={
                  reviewMode === "typed_confirm" &&
                  typedConfirmation !== "RUN"
                }
                onClick={() => void execute(reviewNewTerminal)}
              >
                {reviewMode === "typed_confirm" ? "Run" : "Run Anyway"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
