import { useMemo, useState } from "react";
import { CommandPalette } from "./components/CommandPalette";
import { chooseFolder } from "./api/fileApi";
import {
  getWorkspaceTrust,
  setWorkspaceTrust,
  workspaceTrustLevel,
} from "./workspace/workspaceTrust";
import { WorkspaceCanvas } from "./workspace/WorkspaceCanvas";
import { useFloatingPanes } from "./workspace/useFloatingPanes";

export default function App() {
  const {
    panes,
    workspace,
    gitRefreshToken,
    activeEditorPath,
    addTerminal,
    runCommandInTerminal,
    runCommandInNewTerminal,
    addBrowser,
    updateBrowserUrl,
    addEditor,
    updateEditor,
    openWorkspace,
    updateFileExplorer,
    openFileInEditor,
    openGit,
    updateGit,
    openAgent,
    updateAgent,
    openPatchPreview,
    checkPatchForApply,
    applyPatchWithApproval,
    rollbackPatchWithApproval,
    closePane,
    focusPane,
    updateBounds,
    toggleMaximize,
    centerAllPanes,
    resetLayout,
  } = useFloatingPanes();
  const [, setTrustRevision] = useState(0);
  const trustRecord = getWorkspaceTrust(workspace.rootPath);
  const trustLevel = workspaceTrustLevel(workspace.rootPath);

  const openFolder = async () => {
    const path = await chooseFolder();
    if (path) {
      openWorkspace(path);
    }
  };

  const showGit = () => {
    if (!openGit()) {
      window.alert("Open a folder first.");
    }
  };

  const showExplorer = () => {
    if (workspace.rootPath) {
      openWorkspace(workspace.rootPath);
    } else {
      void openFolder();
    }
  };

  const changeTrust = (level: "trusted" | "untrusted") => {
    if (!workspace.rootPath) {
      return;
    }
    setWorkspaceTrust(workspace.rootPath, level);
    setTrustRevision((current) => current + 1);
  };

  const paletteCommands = useMemo(
    () => [
      {
        id: "new-terminal",
        label: "New Terminal",
        run: () => {
          addTerminal();
        },
      },
      { id: "new-editor", label: "New Editor", run: addEditor },
      { id: "new-preview", label: "New Local Preview", run: addBrowser },
      { id: "open-folder", label: "Open Folder", run: openFolder },
      { id: "show-files", label: "Show File Explorer", run: showExplorer },
      { id: "show-git", label: "Show Git", run: showGit },
      { id: "show-agent", label: "Show Agent", run: openAgent },
      { id: "center", label: "Center All Panes", run: centerAllPanes },
      { id: "reset", label: "Reset Layout", run: resetLayout },
      {
        id: "search",
        label: "Search Workspace",
        run: () => {
          openAgent();
          window.setTimeout(
            () => window.dispatchEvent(new CustomEvent("arc-search-workspace")),
            0,
          );
        },
      },
      {
        id: "permissions",
        label: "Toggle Agent Permissions",
        run: () => {
          openAgent();
          window.setTimeout(
            () =>
              window.dispatchEvent(
                new CustomEvent("arc-toggle-agent-permissions"),
              ),
            0,
          );
        },
      },
      {
        id: "tool-loop",
        label: "Toggle Read-only Tool Loop",
        run: () => {
          openAgent();
          window.setTimeout(
            () =>
              window.dispatchEvent(
                new CustomEvent("arc-toggle-agent-tool-loop"),
              ),
            0,
          );
        },
      },
      {
        id: "codex-handoff",
        label: "Prepare Codex Handoff",
        run: () => {
          openAgent();
          window.setTimeout(
            () =>
              window.dispatchEvent(new CustomEvent("arc-prepare-codex-handoff")),
            0,
          );
        },
      },
    ],
    [
      addBrowser,
      addEditor,
      addTerminal,
      centerAllPanes,
      openAgent,
      openFolder,
      resetLayout,
      showExplorer,
      showGit,
    ],
  );

  return (
    <div className="app-shell">
      <header className="top-bar">
        <strong className="app-title">Arc Workbench</strong>
        <button onClick={() => addTerminal()}>New Terminal</button>
        <button onClick={addBrowser}>New Preview</button>
        <button onClick={addEditor}>New Editor</button>
        <button onClick={() => void openFolder()}>Open Folder</button>
        <button onClick={showGit}>Git</button>
        <button onClick={openAgent}>Agent</button>
        {workspace.rootPath && (
          <button
            className={`workspace-trust-pill workspace-trust-pill--${trustLevel}`}
            onClick={() =>
              changeTrust(trustLevel === "trusted" ? "untrusted" : "trusted")
            }
          >
            Workspace: {trustLevel === "trusted" ? "Trusted" : "Untrusted"}
          </button>
        )}
        <span className="toolbar-spacer" />
        <button onClick={() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true }))}>
          Commands
        </button>
        <button onClick={resetLayout}>Reset Layout</button>
      </header>
      {workspace.rootPath && !trustRecord && (
        <div className="workspace-trust-prompt">
          <strong>Trust this workspace?</strong>
          <span>
            Untrusted workspaces require more confirmations. Trusted workspaces
            allow read-only tools by default.
          </span>
          <button onClick={() => changeTrust("untrusted")}>Keep Untrusted</button>
          <button onClick={() => changeTrust("trusted")}>Trust Workspace</button>
        </div>
      )}
      <WorkspaceCanvas
        panes={panes}
        onClose={closePane}
        onFocus={focusPane}
        onBoundsChange={updateBounds}
        onToggleMaximize={toggleMaximize}
        onBrowserUrlChange={updateBrowserUrl}
        onEditorUpdate={updateEditor}
        onFileExplorerUpdate={updateFileExplorer}
        onOpenFile={openFileInEditor}
        activeEditorPath={activeEditorPath}
        onGitUpdate={updateGit}
        workspaceRoot={workspace.rootPath}
        workspaceTrust={trustLevel}
        onAgentUpdate={updateAgent}
        onPreviewPatch={openPatchPreview}
        gitRefreshToken={gitRefreshToken}
        onCheckPatch={checkPatchForApply}
        onApplyPatch={applyPatchWithApproval}
        onRollbackPatch={rollbackPatchWithApproval}
        onRunCommand={runCommandInTerminal}
        onRunCommandInNewTerminal={runCommandInNewTerminal}
        onFocusTerminal={focusPane}
      />
      <CommandPalette commands={paletteCommands} />
    </div>
  );
}
