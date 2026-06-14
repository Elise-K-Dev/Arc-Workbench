import type {
  EditorFloatingPane,
  FloatingPaneState,
} from "../workspace/floatingPaneTypes";
import type { ParsedPatch, PatchFile } from "./patchTypes";

export type PatchEligibility = {
  ok: boolean;
  message?: string;
  relativePaths: string[];
  absolutePaths: string[];
};

export function normalizePatchPath(file: PatchFile): string | undefined {
  const path = file.newPath || file.oldPath;
  if (
    !path ||
    path === "/dev/null" ||
    path.includes("\0") ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/.test(path)
  ) {
    return undefined;
  }
  const normalized = path.replace(/\\/g, "/").replace(/^\.\//, "");
  if (
    !normalized ||
    normalized
      .split("/")
      .some(
        (segment) => segment === ".." || segment === "." || segment === "",
      )
  ) {
    return undefined;
  }
  return normalized;
}

export function workspacePath(
  rootPath: string,
  relativePath: string,
): string {
  const separator = rootPath.includes("\\") ? "\\" : "/";
  return `${rootPath.replace(/[\\/]+$/, "")}${separator}${relativePath.replace(
    /\//g,
    separator,
  )}`;
}

export function checkPatchEligibility(
  parsed: ParsedPatch | undefined,
  raw: string,
  rootPath: string | undefined,
  panes: FloatingPaneState[],
): PatchEligibility {
  const failure = (message: string): PatchEligibility => ({
    ok: false,
    message,
    relativePaths: [],
    absolutePaths: [],
  });
  if (!rootPath) {
    return failure("Open a folder before applying patches.");
  }
  if (!parsed || parsed.files.length === 0) {
    return failure("Cannot apply: patch has no parsed files.");
  }
  if (
    raw.includes("GIT binary patch") ||
    raw.includes("Binary files ") ||
    raw.includes("diff --cc ") ||
    raw.includes("diff --combined ") ||
    /^@@@ /m.test(raw)
  ) {
    return failure("Cannot apply: binary or combined diffs are unsupported.");
  }

  const relativePaths: string[] = [];
  for (const file of parsed.files) {
    if (file.isNewFile) {
      return failure("Cannot apply: patch creates new files.");
    }
    if (file.isDeletedFile) {
      return failure("Cannot apply: patch deletes files.");
    }
    if (file.isRename || file.oldPath !== file.newPath) {
      return failure("Cannot apply: patch renames files.");
    }
    if (file.hunks.length === 0) {
      return failure("Cannot apply: patch contains a file with no hunks.");
    }
    const path = normalizePatchPath(file);
    if (!path) {
      return failure("Cannot apply: patch contains an unsafe path.");
    }
    relativePaths.push(path);
  }

  const absolutePaths = relativePaths.map((path) => workspacePath(rootPath, path));
  const dirty = panes.find(
    (pane): pane is EditorFloatingPane =>
      pane.kind === "editor" &&
      pane.payload.dirty &&
      !!pane.payload.filePath &&
      absolutePaths.includes(pane.payload.filePath),
  );
  if (dirty?.payload.filePath) {
    const relativePath =
      relativePaths[absolutePaths.indexOf(dirty.payload.filePath)];
    return failure(
      `Cannot apply patch because this file has unsaved editor changes: ${relativePath}. Save or discard changes before applying.`,
    );
  }
  return { ok: true, relativePaths, absolutePaths };
}
