import { useState } from "react";
import type { CodexRouterDecision } from "../agent/router/routerTypes";

type Props = {
  decision: CodexRouterDecision;
  onDismiss: (decisionId: string) => void;
  onKeepLocal: (decisionId: string) => void;
  onCopyHandoff: () => Promise<void>;
};

const RECOMMENDATION_LABELS = {
  local: "Local model is enough",
  codex: "Consider Codex",
  manual: "Manual review recommended",
} as const;

export function CodexRouterCard({
  decision,
  onDismiss,
  onKeepLocal,
  onCopyHandoff,
}: Props) {
  const [copyStatus, setCopyStatus] = useState<string>();

  const copy = async () => {
    setCopyStatus(undefined);
    try {
      await onCopyHandoff();
      setCopyStatus("Handoff prompt copied.");
    } catch (reason) {
      setCopyStatus(`Could not copy handoff. ${String(reason)}`);
    }
  };

  return (
    <aside
      className={`codex-router-card codex-router-card--${decision.recommendedWorker}`}
      data-task-id={decision.taskId}
      data-router-decision-id={decision.id}
    >
      <div className="codex-router-card__header">
        <div>
          <strong>{RECOMMENDATION_LABELS[decision.recommendedWorker]}</strong>
          {decision.recommendedWorker === "codex" && (
            <span>This task may be better suited for Codex.</span>
          )}
        </div>
        <span>{Math.round(decision.confidence * 100)}% confidence</span>
      </div>
      <div className="codex-router-card__metrics">
        <span>difficulty: {decision.difficulty}</span>
        <span>risk: {decision.risk}</span>
      </div>
      <ul>
        {decision.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>
      <p>{decision.suggestedNextStep}</p>
      <div className="codex-router-card__actions">
        <button type="button" onClick={() => onDismiss(decision.id)}>
          Dismiss
        </button>
        <button type="button" onClick={() => onKeepLocal(decision.id)}>
          Keep Local
        </button>
        <button
          type="button"
          disabled
          title="Codex execution is not implemented in Router v0."
        >
          Prepare Codex Handoff
        </button>
        <button type="button" onClick={() => void copy()}>
          Copy Handoff Prompt
        </button>
      </div>
      {copyStatus && (
        <div className="codex-router-card__status">{copyStatus}</div>
      )}
    </aside>
  );
}
