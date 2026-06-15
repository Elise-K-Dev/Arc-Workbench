import type {
  CommandRiskAnalysis,
  CommandRiskLevel,
  CommandRunLocation,
} from "./commandRiskTypes";

export type CommandRisk = CommandRiskLevel;
export type { CommandRiskAnalysis, CommandRunLocation };

export type ShellHint =
  | "bash"
  | "sh"
  | "zsh"
  | "fish"
  | "powershell"
  | "pwsh";

export type CommandProposal = {
  id: string;
  raw: string;
  commands: string[];
  shellHint?: ShellHint;
  risk: CommandRisk;
  reason?: string;
  analysis: CommandRiskAnalysis;
};
