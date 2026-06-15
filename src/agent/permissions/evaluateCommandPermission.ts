import type { CommandRiskAnalysis } from "../../commands/commandRiskTypes";
import type {
  AgentPermissionSettings,
  PermissionAction,
} from "./permissionTypes";

export function evaluateCommandPermission(
  analysis: CommandRiskAnalysis,
  settings: AgentPermissionSettings,
): PermissionAction {
  if (analysis.category === "dangerous") {
    return settings.dangerousCommands === "auto_allow"
      ? "typed_confirm"
      : settings.dangerousCommands;
  }
  if (analysis.category === "modifying") {
    return settings.modifyingCommands === "auto_allow"
      ? "strong_confirm"
      : settings.modifyingCommands;
  }
  if (analysis.category === "check") {
    return settings.checkCommands;
  }
  return settings.inspectCommands;
}
