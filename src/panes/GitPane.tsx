import { useCallback, useEffect, useMemo, useState } from "react";
import {
  getGitFileDiff,
  getGitStatus,
  type GitFileStatus,
  type GitStatus,
} from "../api/gitApi";
import type { GitFloatingPane } from "../workspace/floatingPaneTypes";

type Props = {
  pane: GitFloatingPane;
  onUpdate: (
    id: string,
    update: Partial<GitFloatingPane["payload"]>,
  ) => void;
  onOpenFile: (path: string) => Promise<void>;
  refreshToken: number;
};

function joinPath(rootPath: string, relativePath: string): string {
  const separator = rootPath.includes("\\") ? "\\" : "/";
  return `${rootPath.replace(/[\\/]+$/, "")}${separator}${relativePath.replace(
    /^[\\/]+/,
    "",
  )}`;
}

function DiffLine({ line }: { line: string }) {
  const className = line.startsWith("+++") || line.startsWith("---")
    ? "git-diff-line git-diff-line--meta"
    : line.startsWith("+")
      ? "git-diff-line git-diff-line--added"
      : line.startsWith("-")
        ? "git-diff-line git-diff-line--removed"
        : line.startsWith("@@")
          ? "git-diff-line git-diff-line--hunk"
          : "git-diff-line";
  return <span className={className}>{line || " "}</span>;
}

export function GitPane({ pane, onUpdate, onOpenFile, refreshToken }: Props) {
  const rootPath = pane.payload.rootPath;
  const [status, setStatus] = useState<GitStatus>();
  const [diff, setDiff] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const selected = useMemo(
    () => status?.files.find((file) => file.path === pane.payload.selectedFile),
    [pane.payload.selectedFile, status?.files],
  );

  const loadDiff = useCallback(
    async (file: GitFileStatus) => {
      if (!rootPath) {
        return;
      }
      setError(undefined);
      try {
        setDiff(await getGitFileDiff(rootPath, file.path));
      } catch (reason) {
        setDiff("");
        setError(String(reason));
      }
    },
    [rootPath],
  );

  const refresh = useCallback(async () => {
    if (!rootPath) {
      setStatus(undefined);
      setDiff("");
      return;
    }
    setLoading(true);
    setError(undefined);
    try {
      const next = await getGitStatus(rootPath);
      setStatus(next);
      const selectedFile = next.files.find(
        (file) => file.path === pane.payload.selectedFile,
      );
      if (selectedFile) {
        await loadDiff(selectedFile);
      } else {
        setDiff("");
        if (pane.payload.selectedFile) {
          onUpdate(pane.id, { selectedFile: undefined });
        }
      }
    } catch (reason) {
      setStatus(undefined);
      setDiff("");
      setError(String(reason));
    } finally {
      setLoading(false);
    }
  }, [
    loadDiff,
    onUpdate,
    pane.id,
    pane.payload.selectedFile,
    rootPath,
  ]);

  useEffect(() => {
    void refresh();
  }, [rootPath, refreshToken]);

  const selectFile = (file: GitFileStatus) => {
    onUpdate(pane.id, { selectedFile: file.path });
    void loadDiff(file);
  };

  const openSelected = async () => {
    const repositoryRoot = status?.rootPath;
    if (!repositoryRoot || !selected || selected.status === "D") {
      return;
    }
    setError(undefined);
    try {
      await onOpenFile(joinPath(repositoryRoot, selected.path));
    } catch (reason) {
      setError(String(reason));
    }
  };

  if (!rootPath) {
    return <div className="git-pane-message">Open a folder first.</div>;
  }

  return (
    <div className="git-pane">
      <div className="git-toolbar">
        <span className="git-branch">
          {status?.isRepo ? status.branch || "detached HEAD" : "Git"}
        </span>
        <button type="button" onClick={() => void refresh()}>
          Refresh
        </button>
        <button type="button" disabled={!selected || selected.status === "D"} onClick={() => void openSelected()}>
          Open
        </button>
      </div>
      {!loading && status && !status.isRepo ? (
        <div className="git-pane-message">
          This folder is not a Git repository.
        </div>
      ) : (
        <div className="git-body">
          <div className="git-file-list">
            {status?.files.map((file) => (
              <button
                type="button"
                key={file.path}
                className={`git-file${
                  file.path === pane.payload.selectedFile
                    ? " git-file--selected"
                    : ""
                }`}
                title={file.path}
                onClick={() => selectFile(file)}
                onDoubleClick={() => {
                  selectFile(file);
                  if (file.status !== "D" && status.rootPath) {
                    void onOpenFile(joinPath(status.rootPath, file.path));
                  }
                }}
              >
                <span className="git-file-status">{file.status}</span>
                <span>{file.path}</span>
              </button>
            ))}
            {status?.isRepo && status.files.length === 0 && (
              <div className="git-empty">Working tree clean.</div>
            )}
          </div>
          <pre className="git-diff" aria-label="Git diff">
            {diff
              ? diff.split("\n").map((line, index) => (
                  <DiffLine key={`${index}-${line}`} line={line} />
                ))
              : "Select a changed file."}
          </pre>
        </div>
      )}
      {loading && <div className="git-status-message">Loading...</div>}
      {error && <div className="git-status-message git-status-message--error">{error}</div>}
    </div>
  );
}
