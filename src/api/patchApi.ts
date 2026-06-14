import { invoke } from "@tauri-apps/api/core";

export type PatchCheckResult = {
  ok: boolean;
  message?: string;
};

export type PatchFileSnapshot = {
  relativePath: string;
  preContent: string;
  preSha256: string;
  postSha256?: string;
};

export type PatchRollbackRecord = {
  id: string;
  createdAt: string;
  workspaceRoot: string;
  patchSummary: {
    files: string[];
    additions: number;
    deletions: number;
  };
  files: PatchFileSnapshot[];
  status: "available" | "rolled_back" | "invalidated";
};

export type PatchApplyResult = {
  ok: boolean;
  message: string;
  snapshot?: PatchRollbackRecord;
};

export type PatchRollbackResult = {
  ok: boolean;
  message: string;
  record?: PatchRollbackRecord;
};

export function checkPatch(
  rootPath: string,
  rawPatch: string,
): Promise<PatchCheckResult> {
  return invoke<PatchCheckResult>("patch_check", { rootPath, rawPatch });
}

export function createPatchSnapshot(
  rootPath: string,
  rawPatch: string,
  additions: number,
  deletions: number,
): Promise<PatchRollbackRecord> {
  return invoke<PatchRollbackRecord>("patch_create_snapshot", {
    rootPath,
    rawPatch,
    additions,
    deletions,
  });
}

export function applyPatchWithSnapshot(
  rootPath: string,
  rawPatch: string,
  snapshotId: string,
): Promise<PatchApplyResult> {
  return invoke<PatchApplyResult>("patch_apply_with_snapshot", {
    rootPath,
    rawPatch,
    snapshotId,
  });
}

export function rollbackPatch(
  rootPath: string,
  snapshotId: string,
): Promise<PatchRollbackResult> {
  return invoke<PatchRollbackResult>("patch_rollback", {
    rootPath,
    snapshotId,
  });
}

export function invalidatePatchSnapshot(
  rootPath: string,
  snapshotId: string,
): Promise<void> {
  return invoke("patch_invalidate_snapshot", { rootPath, snapshotId });
}

export function listPatchSnapshots(
  rootPath: string,
): Promise<PatchRollbackRecord[]> {
  return invoke<PatchRollbackRecord[]>("patch_list_snapshots", { rootPath });
}
