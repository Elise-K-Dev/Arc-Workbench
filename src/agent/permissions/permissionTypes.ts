export type AgentPermissionProfile =
  | "strict"
  | "balanced"
  | "fast_inspect"
  | "expert"
  | "custom";

export type PermissionAction =
  | "auto_allow"
  | "ask"
  | "strong_confirm"
  | "typed_confirm"
  | "copy_only";

export type AgentPermissionSettings = {
  profile: AgentPermissionProfile;
  readTools: PermissionAction;
  inspectCommands: PermissionAction;
  checkCommands: PermissionAction;
  modifyingCommands: PermissionAction;
  dangerousCommands: PermissionAction;
  autoSendToolResults: boolean;
};
