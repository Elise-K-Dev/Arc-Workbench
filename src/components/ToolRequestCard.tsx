import { useEffect, useState } from "react";
import {
  addAgentActivity,
  setActivityCollapsed,
  upsertArtifactActivity,
  useAgentActivities,
} from "../agent/activity/activityStore";
import type { PermissionAction } from "../agent/permissions/permissionTypes";
import type { ToolRequest, ToolResult } from "../agent/tools/toolTypes";
import { AgentActivityRow } from "./AgentActivityRow";

type Props = {
  taskId: string;
  request: ToolRequest;
  result?: ToolResult;
  permission: PermissionAction;
  onRun: (request: ToolRequest) => Promise<void>;
  onSendResult: (request: ToolRequest, result: ToolResult) => Promise<void>;
  onOpenFile: (path: string) => Promise<void>;
};

export function ToolRequestCard({
  taskId,
  request,
  result,
  permission,
  onRun,
  onSendResult,
  onOpenFile,
}: Props) {
  const activities = useAgentActivities();
  const [status, setStatus] = useState<string>();
  const [running, setRunning] = useState(false);
  const activity = activities.find(
    (candidate) => candidate.artifactId === request.id,
  );

  useEffect(() => {
    if (!activity) {
      addAgentActivity({
        taskId,
        kind: "tool_request",
        status: "awaiting_approval",
        title: `Tool request · ${request.tool}`,
        summary:
          permission === "auto_allow"
            ? "Read-only · auto-allowed"
            : "Read-only · approval required",
        artifactId: request.id,
      });
    }
  }, [activity, permission, request.id, request.tool, taskId]);

  useEffect(() => {
    if (result) {
      upsertArtifactActivity(request.id, {
        taskId,
        kind: "tool_result",
        status: result.status,
        title:
          result.status === "completed"
            ? `Read tool completed · ${request.tool}`
            : `Read tool failed · ${request.tool}`,
        summary: `${result.summary} · ${
          result.delivery === "auto_sent" ? "auto-sent" : "waiting for user"
        }`,
        metadata: {
          tool: request.tool,
          bytes: result.bytes,
          resultCount: result.resultCount,
          truncated: result.truncated,
          delivery: result.delivery,
        },
      });
    }
  }, [request.id, request.tool, result, taskId]);

  if (!activity) {
    return null;
  }

  const run = async () => {
    setRunning(true);
    setStatus(undefined);
    try {
      await onRun(request);
    } catch (reason) {
      setStatus(String(reason));
    } finally {
      setRunning(false);
    }
  };

  const copy = async () => {
    if (!result) {
      return;
    }
    await navigator.clipboard.writeText(result.output);
    setStatus("Tool result copied.");
  };

  const send = async () => {
    if (!result) {
      return;
    }
    setRunning(true);
    try {
      await onSendResult(request, result);
      setStatus("Tool result sent to Agent.");
    } finally {
      setRunning(false);
    }
  };

  return (
    <AgentActivityRow
      activity={activity}
      onToggle={setActivityCollapsed}
      actions={
        <>
          {!result && (
            <button type="button" disabled={running} onClick={() => void run()}>
              {permission === "auto_allow" ? "Run Again" : "Run Read Tool"}
            </button>
          )}
          {result && (
            <>
              {result.delivery !== "auto_sent" && (
                <button
                  type="button"
                  disabled={running}
                  onClick={() => void send()}
                >
                  Send Result to Agent
                </button>
              )}
              <button type="button" onClick={() => void copy()}>
                Copy Result
              </button>
              {result.paths[0] && (
                <button
                  type="button"
                  onClick={() => void onOpenFile(result.paths[0])}
                >
                  Open File
                </button>
              )}
            </>
          )}
        </>
      }
    >
      <pre className="tool-request-card__request">{request.raw}</pre>
      {result && (
        <>
          <div className="tool-request-card__meta">
            {result.resultCount === undefined
              ? `${result.bytes} B`
              : `${result.resultCount} results · ${result.bytes} B`}
            {result.backend ? ` · ${result.backend}` : ""}
            {result.truncated ? " · truncated" : ""}
            {result.delivery === "auto_sent"
              ? " · auto-sent"
              : " · waiting for user"}
          </div>
          <pre className="tool-request-card__result">{result.output}</pre>
        </>
      )}
      {status && <div className="tool-request-card__status">{status}</div>}
    </AgentActivityRow>
  );
}
