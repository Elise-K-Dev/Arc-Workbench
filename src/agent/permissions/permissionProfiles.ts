import type {
  AgentPermissionProfile,
  AgentPermissionSettings,
} from "./permissionTypes";

const SHARED = {
  checkCommands: "ask",
  modifyingCommands: "strong_confirm",
  dangerousCommands: "typed_confirm",
  autoSendToolResults: false,
} as const;

export const PERMISSION_PROFILES: Record<
  Exclude<AgentPermissionProfile, "custom">,
  AgentPermissionSettings
> = {
  strict: {
    profile: "strict",
    readTools: "ask",
    inspectCommands: "ask",
    ...SHARED,
  },
  balanced: {
    profile: "balanced",
    readTools: "auto_allow",
    inspectCommands: "ask",
    ...SHARED,
  },
  fast_inspect: {
    profile: "fast_inspect",
    readTools: "auto_allow",
    inspectCommands: "auto_allow",
    ...SHARED,
  },
  expert: {
    profile: "expert",
    readTools: "auto_allow",
    inspectCommands: "auto_allow",
    ...SHARED,
  },
};

export const DEFAULT_PERMISSION_SETTINGS = PERMISSION_PROFILES.balanced;

export function permissionProfile(
  profile: Exclude<AgentPermissionProfile, "custom">,
): AgentPermissionSettings {
  return { ...PERMISSION_PROFILES[profile] };
}
