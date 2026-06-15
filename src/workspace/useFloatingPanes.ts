import { useCallback, useEffect, useRef, useState } from "react";
import { readTextFile } from "../api/fileApi";
import { writeTerminal } from "../api/terminalApi";
import {
  applyPatchWithSnapshot,
  checkPatch,
  createPatchSnapshot,
  invalidatePatchSnapshot,
  rollbackPatch,
  type PatchApplyResult,
  type PatchRollbackRecord,
} from "../api/patchApi";
import {
  loadAgentSettings,
  saveAgentSettings,
} from "../agent/settings";
import { detectLanguage } from "../editor/language";
import {
  getTerminalRuntime,
  recordTerminalCommandRun,
  type TerminalCommandRun,
  waitForTerminalSession,
} from "../terminal/terminalRuntime";
import type { CommandRisk, ShellHint } from "../commands/commandTypes";
import type { CommandRunLocation } from "../commands/commandRiskTypes";
import { wrapCommandForTracking } from "../commands/wrapCommandForTracking";
import {
  checkPatchEligibility,
  type PatchEligibility,
  workspacePath,
} from "../patch/patchEligibility";
import type { ParsedPatch } from "../patch/patchTypes";
import {
  clearFloatingPanes,
  loadFloatingPanes,
  saveFloatingPanes,
} from "./floatingPaneStorage";
import type {
  AgentFloatingPane,
  EditorFloatingPane,
  FileExplorerFloatingPane,
  FloatingPaneState,
  GitFloatingPane,
  PatchPreviewFloatingPane,
  PaneBounds,
} from "./floatingPaneTypes";
import {
  loadWorkspace,
  saveWorkspace,
  type WorkspaceState,
} from "./workspaceStorage";

const DEFAULT_TERMINAL_WIDTH = 720;
const DEFAULT_TERMINAL_HEIGHT = 420;
const DEFAULT_BROWSER_WIDTH = 900;
const DEFAULT_BROWSER_HEIGHT = 560;
const DEFAULT_BROWSER_URL = "http://localhost:5173";
const DEFAULT_EDITOR_WIDTH = 900;
const DEFAULT_EDITOR_HEIGHT = 620;
const DEFAULT_EXPLORER_WIDTH = 320;
const DEFAULT_EXPLORER_HEIGHT = 620;
const DEFAULT_GIT_WIDTH = 760;
const DEFAULT_GIT_HEIGHT = 620;
const DEFAULT_AGENT_WIDTH = 820;
const DEFAULT_AGENT_HEIGHT = 620;
const DEFAULT_PATCH_WIDTH = 900;
const DEFAULT_PATCH_HEIGHT = 650;
const BASE_X = 48;
const BASE_Y = 42;
const CASCADE_OFFSET = 28;
const CASCADE_STEPS = 9;

function createTerminalPane(sequence: number, zIndex: number): FloatingPaneState {
  const offset = ((sequence - 1) % CASCADE_STEPS) * CASCADE_OFFSET;
  return {
    id: crypto.randomUUID(),
    kind: "terminal",
    title: sequence === 1 ? "bash" : `terminal-${sequence}`,
    x: BASE_X + offset,
    y: BASE_Y + offset,
    width: DEFAULT_TERMINAL_WIDTH,
    height: DEFAULT_TERMINAL_HEIGHT,
    zIndex,
    minimized: false,
    maximized: false,
  };
}

function createBrowserPane(sequence: number, zIndex: number): FloatingPaneState {
  const offset = ((sequence - 1) % CASCADE_STEPS) * CASCADE_OFFSET;
  return {
    id: crypto.randomUUID(),
    kind: "browser",
    title: sequence === 1 ? "Local Preview" : `Local Preview-${sequence}`,
    x: BASE_X + 36 + offset,
    y: BASE_Y + 24 + offset,
    width: DEFAULT_BROWSER_WIDTH,
    height: DEFAULT_BROWSER_HEIGHT,
    zIndex,
    minimized: false,
    maximized: false,
    payload: {
      url: DEFAULT_BROWSER_URL,
    },
  };
}

function createEditorPane(sequence: number, zIndex: number): FloatingPaneState {
  const offset = ((sequence - 1) % CASCADE_STEPS) * CASCADE_OFFSET;
  return {
    id: crypto.randomUUID(),
    kind: "editor",
    title: sequence === 1 ? "untitled" : `untitled-${sequence}`,
    x: BASE_X + 54 + offset,
    y: BASE_Y + 36 + offset,
    width: DEFAULT_EDITOR_WIDTH,
    height: DEFAULT_EDITOR_HEIGHT,
    zIndex,
    minimized: false,
    maximized: false,
    payload: {
      content: "",
      dirty: false,
      language: "text",
    },
  };
}

function createFileExplorerPane(
  rootPath: string,
  zIndex: number,
): FileExplorerFloatingPane {
  return {
    id: crypto.randomUUID(),
    kind: "file-explorer",
    title: fileName(rootPath),
    x: 24,
    y: 28,
    width: DEFAULT_EXPLORER_WIDTH,
    height: DEFAULT_EXPLORER_HEIGHT,
    zIndex,
    minimized: false,
    maximized: false,
    payload: {
      rootPath,
      expandedDirs: [],
    },
  };
}

function createGitPane(rootPath: string, zIndex: number): GitFloatingPane {
  return {
    id: crypto.randomUUID(),
    kind: "git",
    title: "git",
    x: BASE_X + 84,
    y: BASE_Y + 48,
    width: DEFAULT_GIT_WIDTH,
    height: DEFAULT_GIT_HEIGHT,
    zIndex,
    minimized: false,
    maximized: false,
    payload: { rootPath },
  };
}

function createAgentPane(zIndex: number): AgentFloatingPane {
  return {
    id: crypto.randomUUID(),
    kind: "agent",
    title: "agent",
    x: BASE_X + 108,
    y: BASE_Y + 60,
    width: DEFAULT_AGENT_WIDTH,
    height: DEFAULT_AGENT_HEIGHT,
    zIndex,
    minimized: false,
    maximized: false,
    payload: loadAgentSettings(),
  };
}

function createPatchPreviewPane(
  patchId: string,
  zIndex: number,
): PatchPreviewFloatingPane {
  return {
    id: crypto.randomUUID(),
    kind: "patch-preview",
    title: "patch preview",
    x: BASE_X + 126,
    y: BASE_Y + 72,
    width: DEFAULT_PATCH_WIDTH,
    height: DEFAULT_PATCH_HEIGHT,
    zIndex,
    minimized: false,
    maximized: false,
    payload: { patchId },
  };
}

function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function createDefaultPanes(): FloatingPaneState[] {
  return [createTerminalPane(1, 1)];
}

function highestZIndex(panes: FloatingPaneState[]): number {
  return panes.reduce((highest, pane) => Math.max(highest, pane.zIndex), 0);
}

function highestTerminalSequence(panes: FloatingPaneState[]): number {
  return panes.reduce((highest, pane) => {
    if (pane.kind !== "terminal") {
      return highest;
    }
    const match = /^terminal-(\d+)$/.exec(pane.title);
    return Math.max(highest, match ? Number(match[1]) : 1);
  }, 0);
}

function highestBrowserSequence(panes: FloatingPaneState[]): number {
  return panes.reduce((highest, pane) => {
    if (pane.kind !== "browser") {
      return highest;
    }
    const match = /^(?:browser|local preview)-(\d+)$/i.exec(pane.title);
    return Math.max(highest, match ? Number(match[1]) : 1);
  }, 0);
}

function highestEditorSequence(panes: FloatingPaneState[]): number {
  return panes.reduce((highest, pane) => {
    if (pane.kind !== "editor") {
      return highest;
    }
    const match = /^untitled-(\d+)$/.exec(pane.title);
    return Math.max(highest, match ? Number(match[1]) : 1);
  }, 0);
}

export function useFloatingPanes() {
  const [workspace, setWorkspace] = useState<WorkspaceState>(loadWorkspace);
  const [gitRefreshToken, setGitRefreshToken] = useState(0);
  const [panes, setPanes] = useState<FloatingPaneState[]>(() => {
    const restored = loadFloatingPanes();
    if (!restored) {
      return createDefaultPanes();
    }
    const restoredWorkspace = loadWorkspace();
    return restored.map((pane) => {
      if (!restoredWorkspace.rootPath) {
        return pane;
      }
      if (pane.kind === "file-explorer" && !pane.payload.rootPath) {
        return {
          ...pane,
          title: fileName(restoredWorkspace.rootPath),
          payload: { ...pane.payload, rootPath: restoredWorkspace.rootPath },
        };
      }
      if (pane.kind === "git" && !pane.payload.rootPath) {
        return {
          ...pane,
          payload: { ...pane.payload, rootPath: restoredWorkspace.rootPath },
        };
      }
      return pane;
    });
  });
  const sequence = useRef(Math.max(1, highestTerminalSequence(panes)));
  const browserSequence = useRef(highestBrowserSequence(panes));
  const editorSequence = useRef(highestEditorSequence(panes));
  const nextZIndex = useRef(highestZIndex(panes) + 1);
  const panesRef = useRef(panes);
  panesRef.current = panes;
  const activeEditorPath = panes.reduce<EditorFloatingPane | undefined>(
    (active, pane) =>
      pane.kind === "editor" &&
      (!active || pane.zIndex > active.zIndex)
        ? pane
        : active,
    undefined,
  )?.payload.filePath;

  useEffect(() => {
    saveFloatingPanes(panes);
  }, [panes]);

  useEffect(() => {
    saveWorkspace(workspace);
  }, [workspace]);

  const addTerminal = useCallback(() => {
    sequence.current += 1;
    const pane = createTerminalPane(sequence.current, nextZIndex.current++);
    setPanes((current) => [...current, pane]);
    return pane.id;
  }, []);

  const centerAllPanes = useCallback(() => {
    setPanes((current) =>
      current.map((pane, index) => ({
        ...pane,
        x: BASE_X + (index % CASCADE_STEPS) * 18,
        y: BASE_Y + (index % CASCADE_STEPS) * 18,
        maximized: false,
      })),
    );
  }, []);

  const runCommandInTerminal = useCallback(
    async (
      paneId: string,
      command: string,
      risk: CommandRisk,
      source?: TerminalCommandRun["source"],
      shellHint?: ShellHint,
      runLocation: CommandRunLocation = "terminal_cwd",
    ) => {
      const sessionId = getTerminalRuntime(paneId)?.sessionId;
      if (!sessionId) {
        throw new Error("Selected terminal session is not ready.");
      }
      const run = recordTerminalCommandRun({
        paneId,
        command,
        risk,
        source,
        shellHint,
        runLocation,
        workspaceRoot: workspace.rootPath,
      });
      await writeTerminal(
        sessionId,
        wrapCommandForTracking(
          run.id,
          command,
          shellHint,
          runLocation,
          workspace.rootPath,
        ),
      );
      focusPane(paneId);
      return run;
    },
    [workspace.rootPath],
  );

  const runCommandInNewTerminal = useCallback(
    async (
      command: string,
      risk: CommandRisk,
      source?: TerminalCommandRun["source"],
      shellHint?: ShellHint,
      runLocation: CommandRunLocation = "terminal_cwd",
    ) => {
      const paneId = addTerminal();
      const sessionId = await waitForTerminalSession(paneId);
      const run = recordTerminalCommandRun({
        paneId,
        command,
        risk,
        source,
        shellHint,
        runLocation,
        workspaceRoot: workspace.rootPath,
      });
      await writeTerminal(
        sessionId,
        wrapCommandForTracking(
          run.id,
          command,
          shellHint,
          runLocation,
          workspace.rootPath,
        ),
      );
      focusPane(paneId);
      return run;
    },
    [addTerminal, workspace.rootPath],
  );

  const addBrowser = useCallback(() => {
    browserSequence.current += 1;
    const pane = createBrowserPane(
      browserSequence.current,
      nextZIndex.current++,
    );
    setPanes((current) => [...current, pane]);
  }, []);

  const updateBrowserUrl = useCallback((id: string, url: string) => {
    setPanes((current) =>
      current.map((pane) =>
        pane.id === id && pane.kind === "browser"
          ? { ...pane, payload: { ...pane.payload, url } }
          : pane,
      ),
    );
  }, []);

  const addEditor = useCallback(() => {
    editorSequence.current += 1;
    const pane = createEditorPane(editorSequence.current, nextZIndex.current++);
    setPanes((current) => [...current, pane]);
  }, []);

  const updateEditor = useCallback(
    (
      id: string,
      update: Partial<EditorFloatingPane["payload"]> & { title?: string },
    ) => {
      setPanes((current) =>
        current.map((pane) => {
          if (pane.id !== id || pane.kind !== "editor") {
            return pane;
          }
          const { title, ...payloadUpdate } = update;
          return {
            ...pane,
            title: title ?? pane.title,
            payload: { ...pane.payload, ...payloadUpdate },
          };
        }),
      );
    },
    [],
  );

  const openWorkspace = useCallback((rootPath: string) => {
    setWorkspace({ rootPath });
    setPanes((current) => {
      const existing = current.find((pane) => pane.kind === "file-explorer");
      const zIndex = nextZIndex.current++;
      if (!existing) {
        return [...current, createFileExplorerPane(rootPath, zIndex)];
      }
      return current.map((pane) =>
        pane.kind === "file-explorer"
          ? {
              ...pane,
              title: fileName(rootPath),
              zIndex: pane.id === existing.id ? zIndex : pane.zIndex,
              payload: {
                rootPath,
                expandedDirs: [],
              },
            }
          : pane.kind === "git"
            ? {
                ...pane,
                payload: { rootPath },
              }
          : pane,
      );
    });
  }, []);

  const updateFileExplorer = useCallback(
    (id: string, update: Partial<FileExplorerFloatingPane["payload"]>) => {
      setPanes((current) =>
        current.map((pane) =>
          pane.id === id && pane.kind === "file-explorer"
            ? { ...pane, payload: { ...pane.payload, ...update } }
            : pane,
        ),
      );
    },
    [],
  );

  const openFileInEditor = useCallback(async (path: string) => {
    const focusExisting = (current: FloatingPaneState[]) => {
      const existing = current.find(
        (pane) => pane.kind === "editor" && pane.payload.filePath === path,
      );
      if (!existing) {
        return undefined;
      }
      const zIndex = nextZIndex.current++;
      return current.map((pane) =>
        pane.id === existing.id ? { ...pane, zIndex } : pane,
      );
    };

    if (
      panesRef.current.some(
        (pane) => pane.kind === "editor" && pane.payload.filePath === path,
      )
    ) {
      setPanes((current) => focusExisting(current) ?? current);
      return;
    }

    const content = await readTextFile(path);
    setPanes((current) => {
      const next = focusExisting(current);
      if (next) {
        return next;
      }
      editorSequence.current += 1;
      const pane = createEditorPane(
        editorSequence.current,
        nextZIndex.current++,
      ) as EditorFloatingPane;
      return [
        ...current,
        {
          ...pane,
          title: fileName(path),
          payload: {
            filePath: path,
            content,
            dirty: false,
            language: detectLanguage(path),
          },
        },
      ];
    });
  }, []);

  const openGit = useCallback(() => {
    const rootPath = workspace.rootPath;
    if (!rootPath) {
      return false;
    }
    setPanes((current) => {
      const existing = current.find((pane) => pane.kind === "git");
      const zIndex = nextZIndex.current++;
      if (!existing) {
        return [...current, createGitPane(rootPath, zIndex)];
      }
      return current.map((pane) =>
        pane.id === existing.id && pane.kind === "git"
          ? { ...pane, zIndex, payload: { ...pane.payload, rootPath } }
          : pane,
      );
    });
    return true;
  }, [workspace.rootPath]);

  const updateGit = useCallback(
    (id: string, update: Partial<GitFloatingPane["payload"]>) => {
      setPanes((current) =>
        current.map((pane) =>
          pane.id === id && pane.kind === "git"
            ? { ...pane, payload: { ...pane.payload, ...update } }
            : pane,
        ),
      );
    },
    [],
  );

  const openAgent = useCallback(() => {
    setPanes((current) => {
      const existing = current.find((pane) => pane.kind === "agent");
      const zIndex = nextZIndex.current++;
      if (!existing) {
        return [...current, createAgentPane(zIndex)];
      }
      return current.map((pane) =>
        pane.id === existing.id ? { ...pane, zIndex } : pane,
      );
    });
  }, []);

  const updateAgent = useCallback(
    (id: string, update: Partial<AgentFloatingPane["payload"]>) => {
      setPanes((current) =>
        current.map((pane) => {
          if (pane.id !== id || pane.kind !== "agent") {
            return pane;
          }
          const payload = { ...pane.payload, ...update };
          saveAgentSettings(payload);
          return { ...pane, payload };
        }),
      );
    },
    [],
  );

  const openPatchPreview = useCallback((patchId: string) => {
    setPanes((current) => {
      const existing = current.find(
        (pane) =>
          pane.kind === "patch-preview" && pane.payload.patchId === patchId,
      );
      const zIndex = nextZIndex.current++;
      if (existing) {
        return current.map((pane) =>
          pane.id === existing.id ? { ...pane, zIndex } : pane,
        );
      }
      return [...current, createPatchPreviewPane(patchId, zIndex)];
    });
  }, []);

  const checkPatchForApply = useCallback(
    async (raw: string, parsed?: ParsedPatch): Promise<PatchEligibility> => {
      const eligibility = checkPatchEligibility(
        parsed,
        raw,
        workspace.rootPath,
        panesRef.current,
      );
      if (!eligibility.ok || !workspace.rootPath) {
        return eligibility;
      }
      try {
        const result = await checkPatch(workspace.rootPath, raw);
        return result.ok
          ? eligibility
          : { ...eligibility, ok: false, message: result.message };
      } catch (reason) {
        return { ...eligibility, ok: false, message: String(reason) };
      }
    },
    [workspace.rootPath],
  );

  const refreshEditorsForPaths = useCallback(async (paths: string[]) => {
    const refreshed = await Promise.allSettled(
      paths.map(async (path) => ({
        path,
        content: await readTextFile(path),
      })),
    );
    const refreshedFiles = refreshed.flatMap((item) =>
      item.status === "fulfilled" ? [item.value] : [],
    );
    setPanes((current) =>
      current.map((pane) => {
        if (
          pane.kind !== "editor" ||
          pane.payload.dirty ||
          !pane.payload.filePath
        ) {
          return pane;
        }
        const file = refreshedFiles.find(
          (candidate) => candidate.path === pane.payload.filePath,
        );
        return file
          ? {
              ...pane,
              payload: { ...pane.payload, content: file.content, dirty: false },
            }
          : pane;
      }),
    );
    setGitRefreshToken((current) => current + 1);
    return refreshedFiles.length === paths.length;
  }, []);

  const applyPatchWithApproval = useCallback(
    async (
      raw: string,
      parsed?: ParsedPatch,
    ): Promise<PatchApplyResult> => {
      const rootPath = workspace.rootPath;
      let eligibility = checkPatchEligibility(
        parsed,
        raw,
        rootPath,
        panesRef.current,
      );
      if (!eligibility.ok || !rootPath) {
        return { ok: false, message: eligibility.message ?? "Patch is unsafe." };
      }

      const checked = await checkPatch(rootPath, raw);
      if (!checked.ok) {
        return {
          ok: false,
          message: checked.message ?? "Patch check failed.",
        };
      }
      eligibility = checkPatchEligibility(
        parsed,
        raw,
        rootPath,
        panesRef.current,
      );
      if (!eligibility.ok) {
        return { ok: false, message: eligibility.message ?? "Patch is unsafe." };
      }

      const additions =
        parsed?.files
          .flatMap((file) => file.hunks.flatMap((hunk) => hunk.lines))
          .filter((line) => line.type === "add").length ?? 0;
      const deletions =
        parsed?.files
          .flatMap((file) => file.hunks.flatMap((hunk) => hunk.lines))
          .filter((line) => line.type === "remove").length ?? 0;
      let snapshot: PatchRollbackRecord;
      try {
        snapshot = await createPatchSnapshot(
          rootPath,
          raw,
          additions,
          deletions,
        );
      } catch (reason) {
        return { ok: false, message: String(reason) };
      }
      const confirmed = window.confirm(
        `Apply this patch?\n\nFiles:\n${eligibility.relativePaths
          .map((path) => `- ${path}`)
          .join("\n")}\n\nAdditions: +${additions}\nDeletions: -${deletions}\n\nThis will modify files on disk. Arc will retain a rollback snapshot. Unsaved editor changes are blocked.`,
      );
      if (!confirmed) {
        await invalidatePatchSnapshot(rootPath, snapshot.id).catch(() => {});
        return { ok: false, message: "Patch application cancelled." };
      }

      eligibility = checkPatchEligibility(
        parsed,
        raw,
        rootPath,
        panesRef.current,
      );
      if (!eligibility.ok) {
        await invalidatePatchSnapshot(rootPath, snapshot.id).catch(() => {});
        return { ok: false, message: eligibility.message ?? "Patch is unsafe." };
      }
      let result: PatchApplyResult;
      try {
        result = await applyPatchWithSnapshot(rootPath, raw, snapshot.id);
      } catch (reason) {
        await invalidatePatchSnapshot(rootPath, snapshot.id).catch(() => {});
        return { ok: false, message: String(reason) };
      }
      if (!result.ok) {
        return result;
      }

      const refreshedAll = await refreshEditorsForPaths(
        eligibility.absolutePaths,
      );
      return refreshedAll
        ? result
        : {
            ...result,
            message:
              "Patch applied successfully, but one or more open editors could not be refreshed.",
          };
    },
    [refreshEditorsForPaths, workspace.rootPath],
  );

  const rollbackPatchWithApproval = useCallback(
    async (
      record: PatchRollbackRecord,
    ): Promise<{ ok: boolean; message: string; record?: PatchRollbackRecord }> => {
      const rootPath = workspace.rootPath;
      if (!rootPath) {
        return { ok: false, message: "Open a folder before rolling back." };
      }
      const absolutePaths = record.files.map((file) =>
        workspacePath(rootPath, file.relativePath),
      );
      const dirty = panesRef.current.find(
        (pane) =>
          pane.kind === "editor" &&
          pane.payload.dirty &&
          !!pane.payload.filePath &&
          absolutePaths.includes(pane.payload.filePath),
      );
      if (dirty?.kind === "editor" && dirty.payload.filePath) {
        const relative =
          record.files[absolutePaths.indexOf(dirty.payload.filePath)]
            ?.relativePath ?? dirty.payload.filePath;
        return {
          ok: false,
          message: `Cannot rollback because this file has unsaved editor changes: ${relative}. Save or discard changes before rollback.`,
        };
      }

      const confirmed = window.confirm(
        `Rollback this patch?\n\nThis will restore affected files to their exact contents from before Arc applied this patch.\n\nFiles:\n${record.files
          .map((file) => `- ${file.relativePath}`)
          .join(
            "\n",
          )}\n\nRollback will be blocked if files changed after patch apply or if open editors have unsaved changes.`,
      );
      if (!confirmed) {
        return { ok: false, message: "Rollback cancelled." };
      }

      const dirtyAfterConfirm = panesRef.current.some(
        (pane) =>
          pane.kind === "editor" &&
          pane.payload.dirty &&
          !!pane.payload.filePath &&
          absolutePaths.includes(pane.payload.filePath),
      );
      if (dirtyAfterConfirm) {
        return {
          ok: false,
          message: "Rollback blocked because an affected editor became dirty.",
        };
      }
      const result = await rollbackPatch(rootPath, record.id);
      if (!result.ok) {
        return result;
      }
      const refreshedAll = await refreshEditorsForPaths(absolutePaths);
      return refreshedAll
        ? result
        : {
            ...result,
            message:
              "Patch rolled back, but one or more open editors could not be refreshed.",
          };
    },
    [refreshEditorsForPaths, workspace.rootPath],
  );

  const closePane = useCallback((id: string) => {
    setPanes((current) => {
      const pane = current.find((candidate) => candidate.id === id);
      if (
        pane?.kind === "editor" &&
        pane.payload.dirty &&
        !window.confirm("Discard unsaved changes?")
      ) {
        return current;
      }
      return current.filter((candidate) => candidate.id !== id);
    });
  }, []);

  const focusPane = useCallback((id: string) => {
    setPanes((current) => {
      const target = current.find((pane) => pane.id === id);
      if (!target || target.zIndex === highestZIndex(current)) {
        return current;
      }

      const zIndex = nextZIndex.current++;
      return current.map((pane) =>
        pane.id === id ? { ...pane, zIndex } : pane,
      );
    });
  }, []);

  const updateBounds = useCallback((id: string, bounds: PaneBounds) => {
    setPanes((current) =>
      current.map((pane) =>
        pane.id === id && !pane.maximized ? { ...pane, ...bounds } : pane,
      ),
    );
  }, []);

  const toggleMaximize = useCallback((id: string) => {
    setPanes((current) => {
      const zIndex = nextZIndex.current++;
      return current.map((pane) =>
        pane.id === id
          ? {
              ...pane,
              maximized: !pane.maximized,
              minimized: false,
              zIndex,
            }
          : pane,
      );
    });
  }, []);

  const resetLayout = useCallback(() => {
    setPanes((current) => {
      const hasDirtyEditor = current.some(
        (pane) => pane.kind === "editor" && pane.payload.dirty,
      );
      if (
        hasDirtyEditor &&
        !window.confirm("Discard unsaved changes and reset the layout?")
      ) {
        return current;
      }

      clearFloatingPanes();
      sequence.current = 1;
      browserSequence.current = 0;
      editorSequence.current = 0;
      nextZIndex.current = 2;
      return createDefaultPanes();
    });
  }, []);

  return {
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
  };
}
