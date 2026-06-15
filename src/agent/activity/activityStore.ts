import { useSyncExternalStore } from "react";
import type {
  AgentActivityStatus,
  AgentTaskActivity,
} from "./activityTypes";

const activities = new Map<string, AgentTaskActivity>();
const artifactActivityIds = new Map<string, string>();
const listeners = new Set<() => void>();
let snapshot: AgentTaskActivity[] = [];

function clone(activity: AgentTaskActivity): AgentTaskActivity {
  return {
    ...activity,
    metadata: activity.metadata ? { ...activity.metadata } : undefined,
  };
}

function defaultCollapsed(status: AgentActivityStatus): boolean {
  return status === "completed";
}

function publish() {
  snapshot = Array.from(activities.values(), clone);
  for (const listener of listeners) {
    listener();
  }
}

export function addAgentActivity(
  input: Omit<AgentTaskActivity, "id" | "createdAt" | "updatedAt"> & {
    id?: string;
  },
): AgentTaskActivity {
  const now = new Date().toISOString();
  const id = input.id ?? crypto.randomUUID();
  const activity: AgentTaskActivity = {
    ...input,
    id,
    createdAt: now,
    updatedAt: now,
    collapsed: input.collapsed ?? defaultCollapsed(input.status),
  };
  activities.set(id, activity);
  if (activity.artifactId) {
    artifactActivityIds.set(activity.artifactId, id);
  }
  publish();
  return clone(activity);
}

export function upsertArtifactActivity(
  artifactId: string,
  input: Omit<AgentTaskActivity, "id" | "createdAt" | "updatedAt" | "artifactId">,
): AgentTaskActivity {
  const existingId = artifactActivityIds.get(artifactId);
  const existing = existingId ? activities.get(existingId) : undefined;
  if (!existing) {
    return addAgentActivity({ ...input, artifactId });
  }
  const activity: AgentTaskActivity = {
    ...existing,
    ...input,
    id: existing.id,
    artifactId,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
    collapsed:
      input.collapsed ??
      (existing.status === input.status
        ? existing.collapsed
        : defaultCollapsed(input.status)),
  };
  activities.set(activity.id, activity);
  publish();
  return clone(activity);
}

export function setActivityCollapsed(id: string, collapsed: boolean) {
  const activity = activities.get(id);
  if (!activity) {
    return;
  }
  activities.set(id, {
    ...activity,
    collapsed,
    updatedAt: new Date().toISOString(),
  });
  publish();
}

export function getTaskActivities(taskId: string) {
  return snapshot.filter((activity) => activity.taskId === taskId);
}

export function getActivitiesSnapshot() {
  return snapshot;
}

export function subscribeActivities(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAgentActivities() {
  return useSyncExternalStore(
    subscribeActivities,
    getActivitiesSnapshot,
    getActivitiesSnapshot,
  );
}
