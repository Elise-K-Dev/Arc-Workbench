import { useSyncExternalStore } from "react";
import { attachRouterDecision } from "../tasks/taskStore";
import { classifyTaskForRouting } from "./classifyTaskForRouting";
import type { CodexRouterDecision, RoutingTaskInput } from "./routerTypes";

const decisions = new Map<string, CodexRouterDecision>();
const taskDecisionIds = new Map<string, string>();
const taskInputs = new Map<string, RoutingTaskInput>();
const listeners = new Set<() => void>();
let snapshot: CodexRouterDecision[] = [];

function cloneDecision(decision: CodexRouterDecision): CodexRouterDecision {
  return { ...decision, reasons: [...decision.reasons] };
}

function publish() {
  snapshot = Array.from(decisions.values(), cloneDecision);
  for (const listener of listeners) {
    listener();
  }
}

function mergeInput(
  current: RoutingTaskInput | undefined,
  update: RoutingTaskInput,
): RoutingTaskInput {
  return {
    ...current,
    ...update,
    userMessage: [current?.userMessage, update.userMessage]
      .filter(Boolean)
      .join("\n"),
    assistantResponse: [current?.assistantResponse, update.assistantResponse]
      .filter(Boolean)
      .join("\n"),
  };
}

export function evaluateTaskRouting(
  taskId: string,
  update: RoutingTaskInput,
): CodexRouterDecision {
  const input = mergeInput(taskInputs.get(taskId), update);
  taskInputs.set(taskId, input);
  const existingId = taskDecisionIds.get(taskId);
  const previous = existingId ? decisions.get(existingId) : undefined;
  const classified = classifyTaskForRouting(
    taskId,
    input,
    existingId ?? crypto.randomUUID(),
  );
  const decision: CodexRouterDecision = {
    ...classified,
    createdAt: previous?.createdAt ?? classified.createdAt,
    status:
      previous?.status === "accepted_stub"
        ? "accepted_stub"
        : previous?.status === "dismissed" &&
            previous.recommendedWorker === classified.recommendedWorker
          ? "dismissed"
          : "suggested",
  };
  decisions.set(decision.id, decision);
  taskDecisionIds.set(taskId, decision.id);
  if (!existingId) {
    attachRouterDecision(taskId, decision.id);
  }
  publish();
  return cloneDecision(decision);
}

export function recordRouterCommandFailure(taskId: string) {
  const current = taskInputs.get(taskId);
  if (!current) {
    return undefined;
  }
  return evaluateTaskRouting(taskId, {
    commandFailureCount: (current.commandFailureCount ?? 0) + 1,
  });
}

export function dismissRouterDecision(decisionId: string) {
  const decision = decisions.get(decisionId);
  if (!decision) {
    return;
  }
  decisions.set(decisionId, {
    ...decision,
    status: "dismissed",
    updatedAt: new Date().toISOString(),
  });
  publish();
}

export function keepTaskLocal(decisionId: string) {
  dismissRouterDecision(decisionId);
}

export function getRouterDecision(decisionId: string) {
  const decision = decisions.get(decisionId);
  return decision ? cloneDecision(decision) : undefined;
}

export function getTaskRouterDecision(taskId: string) {
  const decisionId = taskDecisionIds.get(taskId);
  return decisionId ? getRouterDecision(decisionId) : undefined;
}

export function getRouterDecisionsSnapshot() {
  return snapshot;
}

export function subscribeRouterDecisions(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useRouterDecisions() {
  return useSyncExternalStore(
    subscribeRouterDecisions,
    getRouterDecisionsSnapshot,
    getRouterDecisionsSnapshot,
  );
}
