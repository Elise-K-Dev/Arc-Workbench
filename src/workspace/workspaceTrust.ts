import type { AgentPermissionSettings } from "../agent/permissions/permissionTypes";

export type WorkspaceTrustLevel = "untrusted" | "trusted";

export type WorkspaceTrustState = {
  workspaceRoot: string;
  trustLevel: WorkspaceTrustLevel;
  updatedAt: string;
};

const STORAGE_KEY = "arc-workbench.workspace.trust.v1";

function loadRecords(): Record<string, WorkspaceTrustState> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return {};
  }
}

export function getWorkspaceTrust(
  workspaceRoot: string | undefined,
): WorkspaceTrustState | undefined {
  if (!workspaceRoot) {
    return undefined;
  }
  return loadRecords()[workspaceRoot];
}

export function workspaceTrustLevel(
  workspaceRoot: string | undefined,
): WorkspaceTrustLevel {
  return getWorkspaceTrust(workspaceRoot)?.trustLevel ?? "untrusted";
}

export function setWorkspaceTrust(
  workspaceRoot: string,
  trustLevel: WorkspaceTrustLevel,
): WorkspaceTrustState {
  const state = {
    workspaceRoot,
    trustLevel,
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...loadRecords(), [workspaceRoot]: state }),
  );
  return state;
}

export function applyWorkspaceTrust(
  settings: AgentPermissionSettings,
  trustLevel: WorkspaceTrustLevel,
): AgentPermissionSettings {
  if (trustLevel === "trusted") {
    return settings;
  }
  return {
    ...settings,
    readTools: "ask",
    inspectCommands: "ask",
    checkCommands: "ask",
    modifyingCommands: "strong_confirm",
    dangerousCommands: "typed_confirm",
    autoSendToolResults: false,
  };
}
