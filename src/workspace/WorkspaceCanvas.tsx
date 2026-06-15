import { useEffect, useMemo, useRef, useState } from "react";
import { PaneRenderer } from "../panes/PaneRenderer";
import { FloatingPane } from "./FloatingPane";
import type { FloatingPaneState, PaneBounds } from "./floatingPaneTypes";

type Props = {
  panes: FloatingPaneState[];
  onClose: (id: string) => void;
  onFocus: (id: string) => void;
  onBoundsChange: (id: string, bounds: PaneBounds) => void;
  onToggleMaximize: (id: string) => void;
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
  workspaceRoot?: string;
  onAgentUpdate: (
    id: string,
    update: {
      endpoint?: string;
      model?: string;
      temperature?: number;
      maxTokens?: number;
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
    runLocation?: import("../commands/commandRiskTypes").CommandRunLocation,
  ) => Promise<import("../terminal/terminalRuntime").TerminalCommandRun>;
  onRunCommandInNewTerminal: (
    command: string,
    risk: import("../commands/commandTypes").CommandRisk,
    source?: import("../terminal/terminalRuntime").TerminalCommandRun["source"],
    shellHint?: import("../commands/commandTypes").ShellHint,
    runLocation?: import("../commands/commandRiskTypes").CommandRunLocation,
  ) => Promise<import("../terminal/terminalRuntime").TerminalCommandRun>;
  onFocusTerminal: (paneId: string) => void;
};

type CanvasSize = {
  width: number;
  height: number;
};

export function WorkspaceCanvas({
  panes,
  onClose,
  onFocus,
  onBoundsChange,
  onToggleMaximize,
  onBrowserUrlChange,
  onEditorUpdate,
  onFileExplorerUpdate,
  onOpenFile,
  activeEditorPath,
  onGitUpdate,
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
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasSize, setCanvasSize] = useState<CanvasSize>({
    width: 0,
    height: 0,
  });
  const activePaneId = useMemo(() => {
    return panes.reduce<FloatingPaneState | undefined>(
      (active, pane) =>
        !active || pane.zIndex > active.zIndex ? pane : active,
      undefined,
    )?.id;
  }, [panes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const updateSize = () => {
      setCanvasSize({
        width: canvas.clientWidth,
        height: canvas.clientHeight,
      });
    };
    const observer = new ResizeObserver(updateSize);
    observer.observe(canvas);
    updateSize();
    return () => observer.disconnect();
  }, []);

  return (
    <main className="workspace-canvas" ref={canvasRef}>
      {panes.length === 0 && (
        <div className="workspace-canvas__empty">
          Create a terminal to begin.
        </div>
      )}
      {canvasSize.width > 0 &&
        panes.map((pane) => (
          <FloatingPane
            key={pane.id}
            pane={pane}
            active={pane.id === activePaneId}
            canvasWidth={canvasSize.width}
            canvasHeight={canvasSize.height}
            onClose={onClose}
            onFocus={onFocus}
            onBoundsChange={onBoundsChange}
            onToggleMaximize={onToggleMaximize}
          >
            <PaneRenderer
              pane={pane}
              onBrowserUrlChange={onBrowserUrlChange}
              onEditorUpdate={onEditorUpdate}
              onFileExplorerUpdate={onFileExplorerUpdate}
              onOpenFile={onOpenFile}
              activeEditorPath={activeEditorPath}
              onGitUpdate={onGitUpdate}
              panes={panes}
              workspaceRoot={workspaceRoot}
              onAgentUpdate={onAgentUpdate}
              onPreviewPatch={onPreviewPatch}
              gitRefreshToken={gitRefreshToken}
              onCheckPatch={onCheckPatch}
              onApplyPatch={onApplyPatch}
              onRollbackPatch={onRollbackPatch}
              onRunCommand={onRunCommand}
              onRunCommandInNewTerminal={onRunCommandInNewTerminal}
              onFocusTerminal={onFocusTerminal}
            />
          </FloatingPane>
        ))}
    </main>
  );
}
