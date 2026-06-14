import { useEffect, useMemo, useState } from "react";
import { classifyCommandRisk } from "../commands/classifyCommandRisk";
import type { CommandProposal } from "../commands/commandTypes";
import type {
  TerminalCommandRun,
  TerminalOutputCapture,
} from "../terminal/terminalRuntime";
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
  onRun: (
    paneId: string,
    command: string,
    risk: import("../commands/commandTypes").CommandRisk,
    source?: TerminalCommandRun["source"],
    shellHint?: import("../commands/commandTypes").ShellHint,
  ) => Promise<TerminalCommandRun>;
  onRunInNewTerminal: (
    command: string,
    risk: import("../commands/commandTypes").CommandRisk,
    source?: TerminalCommandRun["source"],
    shellHint?: import("../commands/commandTypes").ShellHint,
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
  onRun,
  onRunInNewTerminal,
  onSendResultToAgent,
  onOpenTerminal,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [command, setCommand] = useState(proposal.raw);
  const [targetId, setTargetId] = useState(defaultTerminalId ?? "");
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string>();
  const [runs, setRuns] = useState<TerminalCommandRun[]>([]);
  const classified = useMemo(() => classifyCommandRisk(command), [command]);

  useEffect(() => {
    if (!targetId || !terminals.some((terminal) => terminal.paneId === targetId)) {
      setTargetId(defaultTerminalId ?? terminals[0]?.paneId ?? "");
    }
  }, [defaultTerminalId, targetId, terminals]);

  const confirmRun = () => {
    if (classified.risk === "medium") {
      return window.confirm(`Run this command?\n\n${command}`);
    }
    if (classified.risk === "high") {
      return window.confirm(
        `This command may modify or delete files or system state.\n\nRun anyway?\n\n${command}`,
      );
    }
    return true;
  };

  const run = async (newTerminal: boolean) => {
    const text = command.trim();
    if (!text || classified.risk === "blocked" || !confirmRun()) {
      return;
    }
    if (!newTerminal && !targetId) {
      setStatus("No terminal pane available. Create one first.");
      return;
    }
    setRunning(true);
    setStatus(undefined);
    try {
      const source = {
        agentMessageId: sourceAgentMessageId,
        proposalId: proposal.id,
        taskId,
      };
      const run = newTerminal
        ? await onRunInNewTerminal(
            text,
            classified.risk,
            source,
            proposal.shellHint,
          )
        : await onRun(
            targetId,
            text,
            classified.risk,
            source,
            proposal.shellHint,
          );
      setRuns((current) => [...current, run]);
      if (newTerminal) {
        setStatus("Command sent to a new terminal.");
      } else {
        setStatus("Command sent to terminal.");
      }
    } catch (reason) {
      setStatus(String(reason));
    } finally {
      setRunning(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setStatus("Command copied.");
    } catch (reason) {
      setStatus(`Could not copy command. ${String(reason)}`);
    }
  };

  return (
    <div
      className={`command-proposal command-proposal--${classified.risk}`}
      data-task-id={taskId}
    >
      <div className="command-proposal__header">
        <strong>Command proposal</strong>
        <span>{proposal.shellHint ?? "shell"}</span>
        <span className={`command-risk command-risk--${classified.risk}`}>
          {classified.risk}
        </span>
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
      <div className="command-proposal__reason">
        {classified.risk === "blocked"
          ? "Blocked by Arc safety policy. Copy manually if you really intend to run it."
          : classified.reason}
      </div>
      <div className="command-proposal__controls">
        {classified.risk !== "blocked" && (
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
        )}
        {classified.risk !== "blocked" && (
          <button
            type="button"
            disabled={running || !targetId || !command.trim()}
            onClick={() => void run(false)}
          >
            Run
          </button>
        )}
        <button type="button" onClick={() => void copy()}>
          Copy
        </button>
        {classified.risk !== "blocked" && (
          <button type="button" onClick={() => setEditing((current) => !current)}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
        {classified.risk !== "blocked" && (
          <button
            type="button"
            disabled={running || !command.trim()}
            onClick={() => void run(true)}
          >
            Run in New Terminal
          </button>
        )}
      </div>
      {status && <div className="command-proposal__status">{status}</div>}
      {runs.map((run) => (
        <CommandResultCard
          key={run.id}
          run={run}
          terminalTitle={
            terminals.find((terminal) => terminal.paneId === run.terminalPaneId)
              ?.title ?? "terminal"
          }
          onSendToAgent={onSendResultToAgent}
          onOpenTerminal={onOpenTerminal}
        />
      ))}
    </div>
  );
}
