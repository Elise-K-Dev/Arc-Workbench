export type CommandRisk = "low" | "medium" | "high" | "blocked";

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
};
