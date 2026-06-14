import { useState } from "react";
import {
  captureTerminalCommandRun,
  getTerminalOutputSinceRun,
  markTerminalCommandRunSent,
  type TerminalCommandRun,
  type TerminalOutputCapture,
  useTerminalCommandRun,
} from "../terminal/terminalRuntime";

type Props = {
  run: TerminalCommandRun;
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
  terminalTitle,
  onSendToAgent,
  onOpenTerminal,
}: Props) {
  const liveRun = useTerminalCommandRun(run.id);
  const [capture, setCapture] = useState<TerminalOutputCapture>(() =>
    getTerminalOutputSinceRun(run.id),
  );
  const [status, setStatus] = useState<string>();
  const [sending, setSending] = useState(false);

  const refresh = () => {
    captureTerminalCommandRun(run.id);
    const next = getTerminalOutputSinceRun(run.id);
    setCapture(next);
    setStatus("Output captured.");
    return next;
  };

  const copy = async () => {
    const next = refresh();
    try {
      await navigator.clipboard.writeText(next.output);
      setStatus("Captured output copied.");
    } catch (reason) {
      setStatus(`Could not copy output. ${String(reason)}`);
    }
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

  const completionStatus =
    liveRun.completionStatus ??
    (liveRun.status === "completed" || liveRun.status === "failed"
      ? liveRun.status
      : liveRun.status === "pending" || liveRun.status === "running"
        ? liveRun.status
        : "unknown");
  const duration =
    liveRun.completedAt === undefined
      ? undefined
      : Math.max(
          0,
          (new Date(liveRun.completedAt).getTime() -
            new Date(liveRun.startedAt).getTime()) /
            1000,
        );

  return (
    <div
      className={`command-result command-result--${completionStatus}`}
      data-task-id={liveRun.source?.taskId}
    >
      <div className="command-result__header">
        <strong>Command result</strong>
        <span className="command-result__state">{completionStatus}</span>
        {liveRun.exitCode !== undefined && (
          <span>exit {liveRun.exitCode}</span>
        )}
        {duration !== undefined && <span>{duration.toFixed(1)}s</span>}
        <span>{terminalTitle}</span>
        <span>{new Date(liveRun.startedAt).toLocaleTimeString()}</span>
      </div>
      <pre>{liveRun.command}</pre>
      <div className="command-result__meta">
        Captured: {formatSize(capture.rawLength)}
        {capture.truncated ? " (truncated)" : ""}
      </div>
      <pre className="command-result__output">{capture.output}</pre>
      <div className="command-result__controls">
        <button type="button" onClick={refresh}>
          Capture Output
        </button>
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
      </div>
      {status && <div className="command-result__status">{status}</div>}
    </div>
  );
}
