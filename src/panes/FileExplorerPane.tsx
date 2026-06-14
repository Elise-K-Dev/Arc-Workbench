import { useCallback, useEffect, useRef, useState } from "react";
import { readDirectory, type FileTreeNode } from "../api/fileApi";
import type { FileExplorerFloatingPane } from "../workspace/floatingPaneTypes";

type Props = {
  pane: FileExplorerFloatingPane;
  onUpdate: (
    id: string,
    update: Partial<FileExplorerFloatingPane["payload"]>,
  ) => void;
  onOpenFile: (path: string) => Promise<void>;
  activeEditorPath?: string;
};

type TreeRowProps = {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  selectedPath?: string;
  childrenByPath: Record<string, FileTreeNode[]>;
  loadingPaths: Set<string>;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
};

function TreeRow({
  node,
  depth,
  expanded,
  selectedPath,
  childrenByPath,
  loadingPaths,
  onToggle,
  onSelect,
}: TreeRowProps) {
  const isDirectory = node.kind === "directory";
  const isExpanded = expanded.has(node.path);
  return (
    <>
      <button
        type="button"
        className={`file-tree-row${
          selectedPath === node.path ? " file-tree-row--selected" : ""
        }`}
        style={{ paddingLeft: 5 + depth * 12 }}
        title={node.path}
        data-file-path={node.path}
        onClick={() =>
          isDirectory ? onToggle(node.path) : onSelect(node.path)
        }
      >
        <span className="file-tree-arrow">
          {isDirectory ? (isExpanded ? "v" : ">") : ""}
        </span>
        <span className="file-tree-kind">{isDirectory ? "D" : "-"}</span>
        <span className="file-tree-name">{node.name}</span>
        {loadingPaths.has(node.path) && (
          <span className="file-tree-loading">...</span>
        )}
      </button>
      {isDirectory &&
        isExpanded &&
        (childrenByPath[node.path] ?? []).map((child) => (
          <TreeRow
            key={child.path}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            selectedPath={selectedPath}
            childrenByPath={childrenByPath}
            loadingPaths={loadingPaths}
            onToggle={onToggle}
            onSelect={onSelect}
          />
        ))}
    </>
  );
}

function folderName(path?: string): string {
  return path?.split(/[\\/]/).pop() || "No folder";
}

export function FileExplorerPane({
  pane,
  onUpdate,
  onOpenFile,
  activeEditorPath,
}: Props) {
  const rootPath = pane.payload.rootPath;
  const expanded = new Set(pane.payload.expandedDirs);
  const [childrenByPath, setChildrenByPath] = useState<
    Record<string, FileTreeNode[]>
  >({});
  const [loadingPaths, setLoadingPaths] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string>();
  const treeRef = useRef<HTMLDivElement>(null);

  const loadDirectory = useCallback(async (path: string, force = false) => {
    setLoadingPaths((current) => new Set(current).add(path));
    setError(undefined);
    try {
      const children = await readDirectory(path);
      setChildrenByPath((current) =>
        force || !current[path] ? { ...current, [path]: children } : current,
      );
    } catch (reason) {
      setChildrenByPath((current) => ({ ...current, [path]: [] }));
      setError(String(reason));
    } finally {
      setLoadingPaths((current) => {
        const next = new Set(current);
        next.delete(path);
        return next;
      });
    }
  }, []);

  useEffect(() => {
    setChildrenByPath({});
    if (rootPath) {
      void loadDirectory(rootPath);
    }
  }, [loadDirectory, rootPath]);

  useEffect(() => {
    for (const path of pane.payload.expandedDirs) {
      if (!childrenByPath[path] && !loadingPaths.has(path)) {
        void loadDirectory(path);
      }
    }
  }, [
    childrenByPath,
    loadDirectory,
    loadingPaths,
    pane.payload.expandedDirs,
  ]);

  useEffect(() => {
    const selectedPath = pane.payload.selectedPath;
    if (!selectedPath) {
      return;
    }
    const rows = treeRef.current?.querySelectorAll<HTMLElement>(
      "[data-file-path]",
    );
    const row = [...(rows ?? [])].find(
      (candidate) => candidate.dataset.filePath === selectedPath,
    );
    row?.scrollIntoView({ block: "nearest" });
  }, [childrenByPath, pane.payload.selectedPath]);

  const toggleDirectory = (path: string) => {
    const next = new Set(pane.payload.expandedDirs);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
      if (!childrenByPath[path]) {
        void loadDirectory(path);
      }
    }
    onUpdate(pane.id, { expandedDirs: [...next] });
  };

  const openFile = async (path: string) => {
    onUpdate(pane.id, { selectedPath: path });
    setError(undefined);
    try {
      await onOpenFile(path);
    } catch (reason) {
      setError(String(reason));
    }
  };

  const revealActiveEditor = () => {
    if (!rootPath || !activeEditorPath) {
      setError("Active editor is not inside this workspace.");
      return;
    }
    const normalize = (path: string) =>
      path.replace(/\\/g, "/").replace(/\/+$/, "");
    const root = normalize(rootPath);
    const active = normalize(activeEditorPath);
    if (!active.startsWith(`${root}/`)) {
      setError("Active editor is not inside this workspace.");
      return;
    }

    const expandedDirs = new Set(pane.payload.expandedDirs.map(normalize));
    let current = active.slice(0, active.lastIndexOf("/"));
    while (current.length > root.length) {
      expandedDirs.add(current);
      current = current.slice(0, current.lastIndexOf("/"));
    }
    setError(undefined);
    onUpdate(pane.id, {
      expandedDirs: [...expandedDirs],
      selectedPath: activeEditorPath,
    });
  };

  return (
    <div className="file-explorer-pane">
      <div className="file-explorer-toolbar">
        <span title={rootPath}>{folderName(rootPath)}</span>
        <button type="button" onClick={revealActiveEditor}>
          Reveal
        </button>
        <button
          type="button"
          disabled={!rootPath}
          onClick={() => rootPath && void loadDirectory(rootPath, true)}
        >
          Refresh
        </button>
      </div>
      <div
        className="file-tree"
        role="tree"
        aria-label="Workspace files"
        ref={treeRef}
      >
        {!rootPath && <div className="file-tree-message">Open a folder.</div>}
        {rootPath &&
          (childrenByPath[rootPath] ?? []).map((node) => (
            <TreeRow
              key={node.path}
              node={node}
              depth={0}
              expanded={expanded}
              selectedPath={pane.payload.selectedPath}
              childrenByPath={childrenByPath}
              loadingPaths={loadingPaths}
              onToggle={toggleDirectory}
              onSelect={(path) => void openFile(path)}
            />
          ))}
        {rootPath &&
          loadingPaths.has(rootPath) &&
          !childrenByPath[rootPath] && (
            <div className="file-tree-message">Loading...</div>
          )}
        {error && <div className="file-tree-error">{error}</div>}
      </div>
    </div>
  );
}
