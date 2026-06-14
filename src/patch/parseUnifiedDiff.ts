import type {
  ParsedPatch,
  PatchFile,
  PatchHunk,
  PatchLine,
} from "./patchTypes";

const HUNK_HEADER =
  /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:\s?(.*))?$/;

function cleanPath(value: string): string {
  const path = value.trim().split(/\s+/)[0];
  if (path === "/dev/null") {
    return path;
  }
  return path.replace(/^[ab]\//, "");
}

export function parseUnifiedDiff(raw: string): ParsedPatch {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const files: PatchFile[] = [];
  let currentFile: PatchFile | undefined;
  let currentHunk: PatchHunk | undefined;
  let oldLine = 0;
  let newLine = 0;

  const ensureFile = () => {
    if (!currentFile) {
      currentFile = { oldPath: "", newPath: "", hunks: [] };
      files.push(currentFile);
    }
    return currentFile;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith("diff --git ")) {
      const match = /^diff --git a\/(.+?) b\/(.+)$/.exec(line);
      currentFile = {
        oldPath: match?.[1] ?? "",
        newPath: match?.[2] ?? "",
        hunks: [],
      };
      files.push(currentFile);
      currentHunk = undefined;
      continue;
    }
    if (line.startsWith("rename from ")) {
      const file = ensureFile();
      file.oldPath = line.slice("rename from ".length);
      file.isRename = true;
      continue;
    }
    if (line.startsWith("rename to ")) {
      const file = ensureFile();
      file.newPath = line.slice("rename to ".length);
      file.isRename = true;
      continue;
    }
    if (line.startsWith("--- ")) {
      if (
        currentFile &&
        currentFile.hunks.length > 0 &&
        !lines[index - 1]?.startsWith("diff --git ")
      ) {
        currentFile = undefined;
      }
      currentHunk = undefined;
      const file = ensureFile();
      file.oldPath = cleanPath(line.slice(4));
      file.isNewFile = file.oldPath === "/dev/null";
      continue;
    }
    if (line.startsWith("+++ ")) {
      const file = ensureFile();
      file.newPath = cleanPath(line.slice(4));
      file.isDeletedFile = file.newPath === "/dev/null";
      continue;
    }
    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch) {
      const file = ensureFile();
      currentHunk = {
        oldStart: Number(hunkMatch[1]),
        oldLines: Number(hunkMatch[2] ?? 1),
        newStart: Number(hunkMatch[3]),
        newLines: Number(hunkMatch[4] ?? 1),
        header: hunkMatch[5] || undefined,
        lines: [],
      };
      file.hunks.push(currentHunk);
      oldLine = currentHunk.oldStart;
      newLine = currentHunk.newStart;
      continue;
    }
    if (!currentHunk || line === "\\ No newline at end of file") {
      continue;
    }

    let patchLine: PatchLine | undefined;
    if (line.startsWith("+") && !line.startsWith("+++")) {
      patchLine = { type: "add", content: line.slice(1), newLine };
      newLine += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      patchLine = { type: "remove", content: line.slice(1), oldLine };
      oldLine += 1;
    } else if (line.startsWith(" ")) {
      patchLine = {
        type: "context",
        content: line.slice(1),
        oldLine,
        newLine,
      };
      oldLine += 1;
      newLine += 1;
    }
    if (patchLine) {
      currentHunk.lines.push(patchLine);
    }
  }

  const validFiles = files.filter(
    (file) => file.hunks.length > 0 && (file.oldPath || file.newPath),
  );
  if (validFiles.length === 0) {
    throw new Error("No unified diff files or hunks were found.");
  }
  return { raw, files: validFiles };
}
