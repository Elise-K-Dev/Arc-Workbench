import {
  DEFAULT_PERMISSION_SETTINGS,
  PERMISSION_PROFILES,
} from "./permissionProfiles";
import type {
  AgentPermissionProfile,
  AgentPermissionSettings,
  PermissionAction,
} from "./permissionTypes";

const STORAGE_KEY = "arc-workbench.agent.permissions.v1";
const ACTIONS = new Set<PermissionAction>([
  "auto_allow",
  "ask",
  "strong_confirm",
  "typed_confirm",
  "copy_only",
]);

export function loadPermissionSettings(): AgentPermissionSettings {
  const serialized = localStorage.getItem(STORAGE_KEY);
  if (!serialized) {
    return { ...DEFAULT_PERMISSION_SETTINGS };
  }
  try {
    const value = JSON.parse(serialized) as Partial<AgentPermissionSettings>;
    const profile = value.profile;
    if (
      profile &&
      profile !== "custom" &&
      Object.hasOwn(PERMISSION_PROFILES, profile)
    ) {
      return { ...PERMISSION_PROFILES[profile] };
    }
    if (
      profile === "custom" &&
      ACTIONS.has(value.readTools as PermissionAction) &&
      ACTIONS.has(value.inspectCommands as PermissionAction) &&
      ACTIONS.has(value.checkCommands as PermissionAction) &&
      ACTIONS.has(value.modifyingCommands as PermissionAction) &&
      ACTIONS.has(value.dangerousCommands as PermissionAction)
    ) {
      return {
        profile,
        readTools: value.readTools!,
        inspectCommands: value.inspectCommands!,
        checkCommands: value.checkCommands!,
        modifyingCommands: value.modifyingCommands!,
        dangerousCommands: value.dangerousCommands!,
        autoSendToolResults: value.autoSendToolResults === true,
      };
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  return { ...DEFAULT_PERMISSION_SETTINGS };
}

export function savePermissionSettings(
  settings: AgentPermissionSettings,
): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function selectPermissionProfile(
  profile: AgentPermissionProfile,
  current: AgentPermissionSettings,
): AgentPermissionSettings {
  return profile === "custom"
    ? { ...current, profile: "custom" }
    : { ...PERMISSION_PROFILES[profile] };
}
