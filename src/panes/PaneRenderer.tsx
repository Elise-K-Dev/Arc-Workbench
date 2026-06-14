import type { FloatingPaneState } from "../workspace/floatingPaneTypes";
import { AgentPane } from "./AgentPane";
import { BrowserPane } from "./BrowserPane";
import { EditorPane } from "./EditorPane";
import { FileExplorerPane } from "./FileExplorerPane";
import { GitPane } from "./GitPane";
import { PatchPreviewPane } from "./PatchPreviewPane";
import { TerminalPane } from "./TerminalPane";

type Props = {
  pane: FloatingPaneState;
  onBrowserUrlChange: (id: string, url: string) => void;
  onEditorUpdate: (
    id: string,
    update: {
      title?: string;
      filePath?: string;
      content?: string;
      dirty?: boolean;
      language?: string;
    },
  ) => void;
  onFileExplorerUpdate: (
    id: string,
    update: {
      rootPath?: string;
      expandedDirs?: string[];
      selectedPath?: string;
    },
  ) => void;
  onOpenFile: (path: string) => Promise<void>;
  activeEditorPath?: string;
  onGitUpdate: (
    id: string,
    update: { rootPath?: string; selectedFile?: string },
  ) => void;
  panes: FloatingPaneState[];
  workspaceRoot?: string;
  onAgentUpdate: (
    id: string,
    update: {
      endpoint?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
      streaming?: boolean;
    },
  ) => void;
  onPreviewPatch: (patchId: string) => void;
  gitRefreshToken: number;
  onCheckPatch: (
    raw: string,
    parsed?: import("../patch/patchTypes").ParsedPatch,
  ) => Promise<import("../patch/patchEligibility").PatchEligibility>;
  onApplyPatch: (
    raw: string,
    parsed?: import("../patch/patchTypes").ParsedPatch,
  ) => Promise<import("../api/patchApi").PatchApplyResult>;
  onRollbackPatch: (
    record: import("../api/patchApi").PatchRollbackRecord,
  ) => Promise<import("../api/patchApi").PatchRollbackResult>;
  onRunCommand: (
    paneId: string,
    command: string,
    risk: import("../commands/commandTypes").CommandRisk,
    source?: import("../terminal/terminalRuntime").TerminalCommandRun["source"],
    shellHint?: import("../commands/commandTypes").ShellHint,
  ) => Promise<import("../terminal/terminalRuntime").TerminalCommandRun>;
  onRunCommandInNewTerminal: (
    command: string,
    risk: import("../commands/commandTypes").CommandRisk,
    source?: import("../terminal/terminalRuntime").TerminalCommandRun["source"],
    shellHint?: import("../commands/commandTypes").ShellHint,
  ) => Promise<import("../terminal/terminalRuntime").TerminalCommandRun>;
  onFocusTerminal: (paneId: string) => void;
};

export function PaneRenderer({
  pane,
  onBrowserUrlChange,
  onEditorUpdate,
  onFileExplorerUpdate,
  onOpenFile,
  activeEditorPath,
  onGitUpdate,
  panes,
  workspaceRoot,
  onAgentUpdate,
  onPreviewPatch,
  gitRefreshToken,
  onCheckPatch,
  onApplyPatch,
  onRollbackPatch,
  onRunCommand,
  onRunCommandInNewTerminal,
  onFocusTerminal,
}: Props) {
  if (pane.kind === "terminal") {
    return <TerminalPane pane={pane} />;
  }

  if (pane.kind === "browser") {
    return <BrowserPane pane={pane} onUrlChange={onBrowserUrlChange} />;
  }

  if (pane.kind === "editor") {
    return <EditorPane pane={pane} onUpdate={onEditorUpdate} />;
  }

  if (pane.kind === "file-explorer") {
    return (
      <FileExplorerPane
        pane={pane}
        onUpdate={onFileExplorerUpdate}
        onOpenFile={onOpenFile}
        activeEditorPath={activeEditorPath}
      />
    );
  }

  if (pane.kind === "git") {
    return (
      <GitPane
        pane={pane}
        onUpdate={onGitUpdate}
        onOpenFile={onOpenFile}
        refreshToken={gitRefreshToken}
      />
    );
  }

  if (pane.kind === "agent") {
    return (
      <AgentPane
        pane={pane}
        panes={panes}
        rootPath={workspaceRoot}
        onUpdate={onAgentUpdate}
        onPreviewPatch={onPreviewPatch}
        onOpenFile={onOpenFile}
        onRunCommand={onRunCommand}
        onRunCommandInNewTerminal={onRunCommandInNewTerminal}
        onFocusTerminal={onFocusTerminal}
      />
    );
  }

  if (pane.kind === "patch-preview") {
    return (
      <PatchPreviewPane
        pane={pane}
        rootPath={workspaceRoot}
        onOpenFile={onOpenFile}
        panes={panes}
        onCheckPatch={onCheckPatch}
        onApplyPatch={onApplyPatch}
        onRollbackPatch={onRollbackPatch}
      />
    );
  }

  return <div className="pane-placeholder">{pane.title} is not implemented.</div>;
}
