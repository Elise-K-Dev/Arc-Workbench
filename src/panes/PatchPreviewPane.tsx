import { useMemo, useState } from "react";
import {
  getStoredPatch,
  getStoredPatchTaskId,
} from "../patch/patchStore";
import { setAgentTaskStatus } from "../agent/tasks/taskStore";
import { upsertArtifactActivity } from "../agent/activity/activityStore";
import {
  checkPatchEligibility,
  type PatchEligibility,
} from "../patch/patchEligibility";
import type { PatchFile } from "../patch/patchTypes";
import type {
  PatchApplyResult,
  PatchRollbackRecord,
  PatchRollbackResult,
} from "../api/patchApi";
import type {
  FloatingPaneState,
  PatchPreviewFloatingPane,
} from "../workspace/floatingPaneTypes";

type Props = {
  pane: PatchPreviewFloatingPane;
  rootPath?: string;
  onOpenFile: (path: string) => Promise<void>;
  panes: FloatingPaneState[];
  onCheckPatch: (
    raw: string,
    parsed?: import("../patch/patchTypes").ParsedPatch,
  ) => Promise<PatchEligibility>;
  onApplyPatch: (
    raw: string,
    parsed?: import("../patch/patchTypes").ParsedPatch,
  ) => Promise<PatchApplyResult>;
  onRollbackPatch: (
    record: PatchRollbackRecord,
  ) => Promise<PatchRollbackResult>;
};

function patchPath(file: PatchFile): string | undefined {
  const path = file.isDeletedFile ? file.oldPath : file.newPath || file.oldPath;
  return path && path !== "/dev/null" ? path : undefined;
}

function resolveWorkspacePath(
  rootPath: string | undefined,
  relativePath: string,
): string | undefined {
  if (!rootPath || relativePath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(relativePath)) {
    return undefined;
  }
  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.split("/").includes("..")) {
    return undefined;
  }
  const separator = rootPath.includes("\\") ? "\\" : "/";
  return `${rootPath.replace(/[\\/]+$/, "")}${separator}${normalized.replace(
    /\//g,
    separator,
  )}`;
}

export function PatchPreviewPane({
  pane,
  rootPath,
  onOpenFile,
  panes,
  onCheckPatch,
  onApplyPatch,
  onRollbackPatch,
}: Props) {
  const patch = getStoredPatch(pane.payload.patchId);
  const taskId = getStoredPatchTaskId(pane.payload.patchId);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [message, setMessage] = useState<string>();
  const [applyState, setApplyState] = useState<
    "not-checked" | "checking" | "ready" | "applying" | "applied" | "failed"
  >("not-checked");
  const [rollbackState, setRollbackState] = useState<
    "unavailable" | "available" | "rolling-back" | "rolled-back" | "failed"
  >("unavailable");
  const [snapshot, setSnapshot] = useState<PatchRollbackRecord>();
  const file = patch?.parsed?.files[selectedIndex];
  const summary = useMemo(() => {
    const lines = patch?.parsed?.files.flatMap((item) =>
      item.hunks.flatMap((hunk) => hunk.lines),
    );
    return {
      additions: lines?.filter((line) => line.type === "add").length ?? 0,
      deletions: lines?.filter((line) => line.type === "remove").length ?? 0,
    };
  }, [patch]);

  if (!patch) {
    return (
      <div className="patch-preview-message">
        Patch content is no longer available.
      </div>
    );
  }
  if (!patch.parsed) {
    return (
      <div className="patch-preview-pane patch-preview-pane--raw">
        <div className="patch-preview-error">{patch.error}</div>
        <pre>{patch.raw}</pre>
      </div>
    );
  }
  const parsedPatch = patch.parsed;

  const eligibility = checkPatchEligibility(
    parsedPatch,
    patch.raw,
    rootPath,
    panes,
  );

  const openFile = async (target: PatchFile) => {
    const relativePath = patchPath(target);
    const absolutePath = relativePath
      ? resolveWorkspacePath(rootPath, relativePath)
      : undefined;
    if (!absolutePath || target.isNewFile || target.isDeletedFile) {
      setMessage("File does not exist in the current workspace.");
      return;
    }
    try {
      await onOpenFile(absolutePath);
      setMessage(undefined);
    } catch (reason) {
      setMessage(String(reason));
    }
  };

  const openFiles = async () => {
    let opened = 0;
    let skipped = 0;
    for (const target of patch.parsed!.files) {
      const relativePath = patchPath(target);
      const absolutePath = relativePath
        ? resolveWorkspacePath(rootPath, relativePath)
        : undefined;
      if (!absolutePath || target.isNewFile || target.isDeletedFile) {
        skipped += 1;
        continue;
      }
      try {
        await onOpenFile(absolutePath);
        opened += 1;
      } catch {
        skipped += 1;
      }
    }
    setMessage(
      skipped > 0
        ? `Opened ${opened} file(s); skipped ${skipped} unavailable file(s).`
        : `Opened ${opened} file(s).`,
    );
  };

  const copyPatch = async () => {
    try {
      await navigator.clipboard.writeText(patch.raw);
      setMessage("Patch copied.");
    } catch (reason) {
      setMessage(`Could not copy patch. ${String(reason)}`);
    }
  };

  const check = async () => {
    setApplyState("checking");
    setMessage("Checking patch...");
    const result = await onCheckPatch(patch.raw, patch.parsed);
    if (result.ok) {
      setApplyState("ready");
      setMessage("Ready to apply.");
    } else {
      setApplyState("failed");
      setMessage(result.message ?? "Cannot apply patch.");
    }
  };

  const apply = async () => {
    setApplyState("applying");
    setMessage("Applying patch...");
    try {
      const result = await onApplyPatch(patch.raw, patch.parsed);
      setApplyState(result.ok ? "applied" : "failed");
      setMessage(result.message);
      if (result.ok && taskId) {
        setAgentTaskStatus(taskId, "patch_applied");
        upsertArtifactActivity(pane.payload.patchId, {
          taskId,
          kind: "patch_apply",
          status: "completed",
          title: "Patch applied",
          summary: `${parsedPatch.files.length} files · +${summary.additions} -${summary.deletions}`,
        });
      }
      if (result.ok && result.snapshot) {
        setSnapshot(result.snapshot);
        setRollbackState(
          result.snapshot.status === "available" ? "available" : "unavailable",
        );
      }
    } catch (reason) {
      setApplyState("failed");
      setMessage(String(reason));
      if (taskId) {
        upsertArtifactActivity(pane.payload.patchId, {
          taskId,
          kind: "patch_apply",
          status: "failed",
          title: "Patch apply failed",
          summary: String(reason),
        });
      }
    }
  };

  const rollback = async () => {
    if (!snapshot || snapshot.status !== "available") {
      return;
    }
    setRollbackState("rolling-back");
    setMessage("Checking rollback safety...");
    try {
      const result = await onRollbackPatch(snapshot);
      if (result.record) {
        setSnapshot(result.record);
      }
      setRollbackState(result.ok ? "rolled-back" : "failed");
      if (result.ok && taskId) {
        setAgentTaskStatus(taskId, "rolled_back");
        upsertArtifactActivity(pane.payload.patchId, {
          taskId,
          kind: "rollback",
          status: "completed",
          title: "Patch rolled back",
          summary: `${parsedPatch.files.length} files restored`,
        });
      }
      setMessage(result.message);
    } catch (reason) {
      setRollbackState("failed");
      setMessage(String(reason));
      if (taskId) {
        upsertArtifactActivity(pane.payload.patchId, {
          taskId,
          kind: "rollback",
          status: "failed",
          title: "Rollback failed",
          summary: String(reason),
        });
      }
    }
  };

  return (
    <div className="patch-preview-pane">
      <div className="patch-preview-toolbar">
        <span>
          {patch.parsed.files.length} files, +{summary.additions} / -
          {summary.deletions}
        </span>
        <button type="button" onClick={() => void copyPatch()}>
          Copy Patch
        </button>
        <button type="button" onClick={() => void openFiles()}>
          Open Files
        </button>
        <button
          type="button"
          disabled={
            !eligibility.ok ||
            applyState === "checking" ||
            applyState === "applying" ||
            applyState === "applied"
          }
          title={eligibility.ok ? "Validate patch against disk" : eligibility.message}
          onClick={() => void check()}
        >
          Check Patch
        </button>
        <button
          type="button"
          disabled={
            !eligibility.ok ||
            applyState === "checking" ||
            applyState === "applying" ||
            applyState === "applied"
          }
          title={eligibility.ok ? "Apply after confirmation" : eligibility.message}
          onClick={() => void apply()}
        >
          Apply Patch
        </button>
        {snapshot?.status === "available" && (
          <button
            type="button"
            disabled={rollbackState === "rolling-back"}
            title="Restore exact pre-apply file contents after safety checks"
            onClick={() => void rollback()}
          >
            Rollback Patch
          </button>
        )}
        <button
          type="button"
          disabled={!file}
          onClick={() => file && void openFile(file)}
        >
          Open File
        </button>
      </div>
      <div
        className={`patch-rollback-state patch-rollback-state--${rollbackState}`}
      >
        Rollback snapshot:{" "}
        {rollbackState === "rolling-back"
          ? "checking"
          : rollbackState === "rolled-back"
            ? "rolled back"
            : snapshot?.status === "available"
              ? "available"
              : snapshot?.status ?? "unavailable"}
      </div>
      <div
        className={`patch-apply-state patch-apply-state--${applyState}`}
        title={!eligibility.ok ? eligibility.message : undefined}
      >
        {!eligibility.ok
          ? eligibility.message
          : applyState === "not-checked"
            ? "Not checked"
            : applyState === "checking"
              ? "Checking"
              : applyState === "ready"
                ? "Ready to apply"
                : applyState === "applying"
                  ? "Applying"
                  : applyState === "applied"
                    ? "Applied"
                    : "Failed"}
      </div>
      <div className="patch-preview-body">
        <div className="patch-file-list">
          {patch.parsed.files.map((item, index) => (
            <button
              type="button"
              key={`${item.oldPath}-${item.newPath}-${index}`}
              className={index === selectedIndex ? "patch-file patch-file--selected" : "patch-file"}
              onClick={() => setSelectedIndex(index)}
            >
              {patchPath(item) ?? "unknown file"}
            </button>
          ))}
        </div>
        <div className="patch-file-diff">
          {file?.hunks.map((hunk, hunkIndex) => (
            <section key={`${hunk.oldStart}-${hunk.newStart}-${hunkIndex}`}>
              <div className="patch-hunk-header">
                @@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},
                {hunk.newLines} @@ {hunk.header}
              </div>
              {hunk.lines.map((line, lineIndex) => (
                <div
                  key={`${lineIndex}-${line.oldLine}-${line.newLine}`}
                  className={`patch-line patch-line--${line.type}`}
                >
                  <span>{line.oldLine ?? ""}</span>
                  <span>{line.newLine ?? ""}</span>
                  <code>
                    {line.type === "add"
                      ? "+"
                      : line.type === "remove"
                        ? "-"
                        : " "}
                    {line.content}
                  </code>
                </div>
              ))}
            </section>
          ))}
        </div>
      </div>
      {message && <div className="patch-preview-status">{message}</div>}
    </div>
  );
}
