import type { ExtractedPatch } from "./patchTypes";

const patches = new Map<string, ExtractedPatch>();
const patchTasks = new Map<string, string>();

export function storePatch(patch: ExtractedPatch, taskId?: string): string {
  const id = crypto.randomUUID();
  patches.set(id, patch);
  if (taskId) {
    patchTasks.set(id, taskId);
  }
  return id;
}

export function getStoredPatch(id: string): ExtractedPatch | undefined {
  return patches.get(id);
}

export function getStoredPatchTaskId(id: string): string | undefined {
  return patchTasks.get(id);
}
