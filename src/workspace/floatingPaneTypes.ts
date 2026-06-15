export type PaneKind =
  | "terminal"
  | "editor"
  | "browser"
  | "file-explorer"
  | "git"
  | "agent"
  | "patch-preview"
  | "ssh"
  | "problems"
  | "logs";

export type BaseFloatingPane = {
  id: string;
  kind: PaneKind;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  zIndex: number;
  minimized: boolean;
  maximized: boolean;
};

export type TerminalFloatingPane = BaseFloatingPane & {
  kind: "terminal";
  payload?: {
    terminalSessionId?: string;
  };
};

export type BrowserFloatingPane = BaseFloatingPane & {
  kind: "browser";
  payload: {
    url: string;
  };
};

export type EditorFloatingPane = BaseFloatingPane & {
  kind: "editor";
  payload: {
    filePath?: string;
    content?: string;
    dirty: boolean;
    language?: string;
  };
};

export type FileExplorerFloatingPane = BaseFloatingPane & {
  kind: "file-explorer";
  payload: {
    rootPath?: string;
    expandedDirs: string[];
    selectedPath?: string;
  };
};

export type GitFloatingPane = BaseFloatingPane & {
  kind: "git";
  payload: {
    rootPath?: string;
    selectedFile?: string;
  };
};

export type AgentFloatingPane = BaseFloatingPane & {
  kind: "agent";
  payload: {
    endpoint: string;
    model: string;
    temperature: number;
    maxTokens: number;
    streaming: boolean;
    showCodexRouterSuggestions: boolean;
    toolLoop: import("../agent/tools/toolLoop").AgentToolLoopSettings;
  };
};

export type PatchPreviewFloatingPane = BaseFloatingPane & {
  kind: "patch-preview";
  payload: {
    patchId: string;
  };
};

export type PlaceholderFloatingPane = BaseFloatingPane & {
  kind: Exclude<
    PaneKind,
    | "terminal"
    | "browser"
    | "editor"
    | "file-explorer"
    | "git"
    | "agent"
    | "patch-preview"
  >;
  payload?: {
    filePath?: string;
    url?: string;
  };
};

export type FloatingPaneState =
  | TerminalFloatingPane
  | BrowserFloatingPane
  | EditorFloatingPane
  | FileExplorerFloatingPane
  | GitFloatingPane
  | AgentFloatingPane
  | PatchPreviewFloatingPane
  | PlaceholderFloatingPane;

export type PaneBounds = Pick<
  FloatingPaneState,
  "x" | "y" | "width" | "height"
>;
