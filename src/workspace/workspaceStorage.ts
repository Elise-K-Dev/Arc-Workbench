export type WorkspaceState = {
  rootPath?: string;
};

const STORAGE_KEY = "arc-workbench.workspace.v1";

export function loadWorkspace(): WorkspaceState {
  const serialized = localStorage.getItem(STORAGE_KEY);
  if (!serialized) {
    return {};
  }

  try {
    const value = JSON.parse(serialized) as Record<string, unknown>;
    return typeof value.rootPath === "string"
      ? { rootPath: value.rootPath }
      : {};
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return {};
  }
}

export function saveWorkspace(workspace: WorkspaceState): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
}
