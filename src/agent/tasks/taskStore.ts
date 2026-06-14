import type { AgentTask, AgentTaskStatus } from "./agentTaskTypes";

const tasks = new Map<string, AgentTask>();
const listeners = new Set<() => void>();
let snapshot: AgentTask[] = [];

function cloneTask(task: AgentTask): AgentTask {
  return {
    ...task,
    userMessageIds: [...task.userMessageIds],
    assistantMessageIds: [...task.assistantMessageIds],
    patchIds: [...task.patchIds],
    commandProposalIds: [...task.commandProposalIds],
    commandRunIds: [...task.commandRunIds],
  };
}

function nextStatus(task: AgentTask, status: AgentTaskStatus) {
  return task.status === "closed" ? "closed" : status;
}

function publish() {
  snapshot = Array.from(tasks.values(), cloneTask);
  for (const listener of listeners) {
    listener();
  }
}

function updateTask(
  taskId: string,
  update: (task: AgentTask) => AgentTask,
): AgentTask | undefined {
  const task = tasks.get(taskId);
  if (!task) {
    return undefined;
  }
  const updated = update(task);
  tasks.set(taskId, updated);
  publish();
  return cloneTask(updated);
}

function appendUnique(values: string[], value: string): string[] {
  return values.includes(value) ? values : [...values, value];
}

function taskTitle(prompt: string): string {
  const firstLine = prompt.trim().split(/\r?\n/, 1)[0] || "Agent task";
  return firstLine.length > 72 ? `${firstLine.slice(0, 69)}...` : firstLine;
}

export function createAgentTask(
  prompt: string,
  userMessageId: string,
): AgentTask {
  const now = new Date().toISOString();
  const task: AgentTask = {
    id: crypto.randomUUID(),
    title: taskTitle(prompt),
    createdAt: now,
    updatedAt: now,
    status: "open",
    userMessageIds: [userMessageId],
    assistantMessageIds: [],
    patchIds: [],
    commandProposalIds: [],
    commandRunIds: [],
  };
  tasks.set(task.id, task);
  publish();
  return cloneTask(task);
}

export function attachUserMessage(taskId: string, messageId: string) {
  return updateTask(taskId, (task) => ({
    ...task,
    userMessageIds: appendUnique(task.userMessageIds, messageId),
    status: nextStatus(task, "open"),
    updatedAt: new Date().toISOString(),
  }));
}

export function attachAssistantMessage(taskId: string, messageId: string) {
  return updateTask(taskId, (task) => ({
    ...task,
    assistantMessageIds: appendUnique(task.assistantMessageIds, messageId),
    status: task.status === "open" ? "waiting_for_user" : task.status,
    updatedAt: new Date().toISOString(),
  }));
}

export function attachPatch(taskId: string, patchId: string) {
  return updateTask(taskId, (task) => ({
    ...task,
    patchIds: appendUnique(task.patchIds, patchId),
    status: nextStatus(task, "patch_available"),
    updatedAt: new Date().toISOString(),
  }));
}

export function attachCommandProposal(taskId: string, proposalId: string) {
  return updateTask(taskId, (task) => ({
    ...task,
    commandProposalIds: appendUnique(task.commandProposalIds, proposalId),
    status: nextStatus(task, "command_available"),
    updatedAt: new Date().toISOString(),
  }));
}

export function attachCommandRun(taskId: string, runId: string) {
  return updateTask(taskId, (task) => ({
    ...task,
    commandRunIds: appendUnique(task.commandRunIds, runId),
    status: nextStatus(task, "command_running"),
    updatedAt: new Date().toISOString(),
  }));
}

export function setAgentTaskStatus(
  taskId: string,
  status: AgentTaskStatus,
) {
  return updateTask(taskId, (task) => ({
    ...task,
    status: nextStatus(task, status),
    updatedAt: new Date().toISOString(),
  }));
}

export function closeAgentTask(taskId: string) {
  return setAgentTaskStatus(taskId, "closed");
}

export function getAgentTask(taskId: string) {
  const task = tasks.get(taskId);
  return task ? cloneTask(task) : undefined;
}

export function getAgentTasksSnapshot() {
  return snapshot;
}

export function subscribeAgentTasks(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
