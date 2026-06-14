import type { CommandRisk } from "./commandTypes";

export type CommandRiskResult = {
  risk: CommandRisk;
  reason: string;
};

const BLOCKED_PATTERNS: Array<[RegExp, string]> = [
  [/(^|[;&|]\s*)mkfs(?:\.|\s|$)/im, "Filesystem formatting commands are blocked."],
  [/(^|[;&|]\s*)dd\s+[^;\n]*\bif=/im, "Raw disk copy commands are blocked."],
  [/\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i, "Piping downloads into a shell is blocked."],
  [/:\(\)\s*\{\s*:\|:&\s*;\s*\}\s*;?\s*:/, "Fork bomb patterns are blocked."],
  [/(^|[;&|]\s*)(?:shutdown|reboot|poweroff)(?:\s|$)/im, "System power commands are blocked."],
];

const HIGH_PATTERNS: Array<[RegExp, string]> = [
  [/(^|[;&|]\s*)sudo(?:\s|$)/im, "Uses elevated privileges."],
  [/(^|[;&|]\s*)rm(?:\s|$)/im, "May delete files or directories."],
  [/(^|[;&|]\s*)mv(?:\s|$)/im, "May move or overwrite files."],
  [/(^|[;&|]\s*)cp\s+[^\n]*\s-(?:[^\s]*r|R)\b|(^|[;&|]\s*)cp\s+-(?:[^\s]*r|R)\b/im, "Recursively copies and may overwrite files."],
  [/(^|[;&|]\s*)chmod\s+-(?:[^\s]*R)\b/im, "Recursively changes permissions."],
  [/(^|[;&|]\s*)chown(?:\s|$)/im, "Changes file ownership."],
  [/\bgit\s+(?:reset|clean|checkout|switch|merge|rebase)(?:\s|$)/i, "May rewrite or replace repository state."],
  [/\bdocker\s+system\s+prune\b/i, "Deletes Docker resources."],
];

const MEDIUM_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:npm|pnpm|yarn)\s+(?:install|add|remove|uninstall)(?:\s|$)/i, "Changes project dependencies."],
  [/\bcargo\s+update(?:\s|$)/i, "Updates dependency lock state."],
  [/\bpip(?:3)?\s+install(?:\s|$)/i, "Installs Python packages."],
  [/\bgit\s+(?:add|restore)(?:\s|$)/i, "Changes Git index or working tree state."],
  [/(^|[;&|]\s*)chmod(?:\s|$)/im, "Changes file permissions."],
  [/\bdocker\s+compose\s+up(?:\s|$)/i, "Starts or changes container services."],
];

export function classifyCommandRisk(command: string): CommandRiskResult {
  const normalized = command.trim();
  for (const [pattern, reason] of BLOCKED_PATTERNS) {
    if (pattern.test(normalized)) {
      return { risk: "blocked", reason };
    }
  }
  for (const [pattern, reason] of HIGH_PATTERNS) {
    if (pattern.test(normalized)) {
      return { risk: "high", reason };
    }
  }
  for (const [pattern, reason] of MEDIUM_PATTERNS) {
    if (pattern.test(normalized)) {
      return { risk: "medium", reason };
    }
  }
  return {
    risk: "low",
    reason: "No known modifying or destructive command pattern was detected.",
  };
}
