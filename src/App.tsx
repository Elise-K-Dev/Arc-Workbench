import { chooseFolder } from "./api/fileApi";
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
    resetLayout,
  } = useFloatingPanes();

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
        <span className="toolbar-spacer" />
        <button onClick={resetLayout}>Reset Layout</button>
      </header>
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
    </div>
  );
}
