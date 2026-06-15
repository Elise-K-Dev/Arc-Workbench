export type CommandRiskLevel = "low" | "medium" | "high" | "critical";

export type CommandCategory =
  | "inspect"
  | "check"
  | "modifying"
  | "dangerous";

export type CommandRiskAnalysis = {
  risk: CommandRiskLevel;
  category: CommandCategory;
  reasons: string[];
  detectedPatterns: string[];
  affectedScope?: string[];
  saferAlternative?: string;
};

export type CommandRunLocation = "workspace_root" | "terminal_cwd";
