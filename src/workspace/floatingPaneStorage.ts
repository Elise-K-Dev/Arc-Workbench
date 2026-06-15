import type { FloatingPaneState } from "./floatingPaneTypes";

const STORAGE_KEY = "arc-workbench.floating-panes.v1";
const LEGACY_STORAGE_KEY = "arc-workbench.layout.v1";

function isFloatingPane(value: unknown): value is FloatingPaneState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const pane = value as Record<string, unknown>;
  const baseValid =
    typeof pane.id === "string" &&
    typeof pane.kind === "string" &&
    typeof pane.title === "string" &&
    typeof pane.x === "number" &&
    typeof pane.y === "number" &&
    typeof pane.width === "number" &&
    typeof pane.height === "number" &&
    typeof pane.zIndex === "number" &&
    typeof pane.minimized === "boolean" &&
    typeof pane.maximized === "boolean";
  if (!baseValid) {
    return false;
  }

  if (pane.kind === "browser") {
    const payload = pane.payload;
    return (
      !!payload &&
      typeof payload === "object" &&
      typeof (payload as Record<string, unknown>).url === "string"
    );
  }

  if (pane.kind === "editor") {
    const payload = pane.payload;
    return (
      !!payload &&
      typeof payload === "object" &&
      typeof (payload as Record<string, unknown>).dirty === "boolean"
    );
  }

  if (pane.kind === "file-explorer") {
    const payload = pane.payload as Record<string, unknown> | undefined;
    return (
      !!payload &&
      (payload.rootPath === undefined || typeof payload.rootPath === "string") &&
      Array.isArray(payload.expandedDirs) &&
      payload.expandedDirs.every((path) => typeof path === "string") &&
      (payload.selectedPath === undefined ||
        typeof payload.selectedPath === "string")
    );
  }

  if (pane.kind === "git") {
    const payload = pane.payload as Record<string, unknown> | undefined;
    return (
      !!payload &&
      (payload.rootPath === undefined || typeof payload.rootPath === "string") &&
      (payload.selectedFile === undefined ||
        typeof payload.selectedFile === "string")
    );
  }

  if (pane.kind === "agent") {
    const payload = pane.payload as Record<string, unknown> | undefined;
    return (
      !!payload &&
      typeof payload.endpoint === "string" &&
      typeof payload.model === "string" &&
      typeof payload.temperature === "number" &&
      typeof payload.maxTokens === "number" &&
      (payload.streaming === undefined ||
        typeof payload.streaming === "boolean") &&
      (payload.showCodexRouterSuggestions === undefined ||
        typeof payload.showCodexRouterSuggestions === "boolean") &&
      (payload.toolLoop === undefined ||
        (typeof payload.toolLoop === "object" &&
          payload.toolLoop !== null))
    );
  }

  if (pane.kind === "patch-preview") {
    const payload = pane.payload as Record<string, unknown> | undefined;
    return !!payload && typeof payload.patchId === "string";
  }

  return true;
}

export function loadFloatingPanes(): FloatingPaneState[] | undefined {
  const serialized = localStorage.getItem(STORAGE_KEY);
  if (!serialized) {
    return undefined;
  }

  try {
    const value = JSON.parse(serialized) as unknown;
    if (!Array.isArray(value) || !value.every(isFloatingPane)) {
      throw new Error("invalid floating pane layout");
    }
    return value.map((pane) => {
      if (pane.kind === "agent") {
        return {
          ...pane,
          payload: {
            ...pane.payload,
            streaming: pane.payload.streaming ?? true,
            showCodexRouterSuggestions:
              pane.payload.showCodexRouterSuggestions ?? true,
            toolLoop: pane.payload.toolLoop ?? {
              enabled: false,
              maxTurns: 3,
            },
          },
        };
      }
      if (pane.kind === "browser" && /^browser(?:-\d+)?$/i.test(pane.title)) {
        return {
          ...pane,
          title: pane.title.replace(/^browser/i, "Local Preview"),
        };
      }
      return pane;
    });
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return undefined;
  }
}

export function saveFloatingPanes(panes: FloatingPaneState[]): void {
  const serializedPanes = panes
    .filter((pane) => pane.kind !== "patch-preview")
    .map((pane) => {
    if (
      pane.kind !== "editor" ||
      !pane.payload.filePath ||
      pane.payload.dirty
    ) {
      return pane;
    }

    const { content: _, ...payload } = pane.payload;
    return { ...pane, payload };
    });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(serializedPanes));
}

export function clearFloatingPanes(): void {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(LEGACY_STORAGE_KEY);
}
