import type {
  CommandCategory,
  CommandRiskAnalysis,
  CommandRiskLevel,
} from "./commandRiskTypes";

type Pattern = {
  pattern: RegExp;
  label: string;
  reason: string;
  scope?: string;
  saferAlternative?: string;
};

const DANGEROUS: Pattern[] = [
  {
    pattern: /\brm\s+(?:-[^\s]*r[^\s]*f|-[^\s]*f[^\s]*r)\b/i,
    label: "rm -rf",
    reason: "Recursively and forcibly deletes files or directories.",
    scope: "The supplied paths and all descendants.",
    saferAlternative: "Inspect the target first, then remove specific paths without -f.",
  },
  {
    pattern: /(^|[;&|]\s*)sudo(?:\s|$)/im,
    label: "sudo",
    reason: "Runs with elevated system privileges.",
    scope: "Potentially system-wide.",
  },
  {
    pattern: /\bgit\s+reset\s+--hard\b/i,
    label: "git reset --hard",
    reason: "Discards working-tree and index changes.",
    scope: "Current Git worktree.",
    saferAlternative: "Use git status and git diff, then restore specific files.",
  },
  {
    pattern: /\bgit\s+clean\s+-[a-z]*f/i,
    label: "git clean",
    reason: "Permanently deletes untracked files.",
    scope: "Untracked files in the repository.",
    saferAlternative: "Run git clean -nd first to preview affected paths.",
  },
  {
    pattern: /\b(?:curl|wget)\b[^\n|]*\|\s*(?:sudo\s+)?(?:ba)?sh\b/i,
    label: "download pipe to shell",
    reason: "Executes downloaded content without local review.",
    scope: "User or system environment depending on the script.",
    saferAlternative: "Download the script, inspect it, then run the reviewed file.",
  },
  {
    pattern: /(^|[;&|]\s*)(?:dd|mkfs(?:\.[^\s]+)?)(?:\s|$)/im,
    label: "raw disk operation",
    reason: "Can overwrite or format storage devices.",
    scope: "Selected block device or filesystem.",
  },
  {
    pattern: /(^|[;&|]\s*)(?:shutdown|reboot|poweroff)(?:\s|$)/im,
    label: "system power command",
    reason: "Stops or restarts the operating system.",
    scope: "Entire system.",
  },
  {
    pattern: /(^|[;&|]\s*)(?:chown|chmod)\s+-[^\s]*R\b/im,
    label: "recursive permission change",
    reason: "Recursively changes ownership or permissions.",
    scope: "The supplied directory tree.",
  },
];

const MODIFYING: Pattern[] = [
  {
    pattern: /\b(?:npm|pnpm|yarn)\s+(?:install|add|remove|uninstall)(?:\s|$)/i,
    label: "package dependency change",
    reason: "Changes installed dependencies or lock files.",
    scope: "Project dependency state.",
  },
  {
    pattern: /\bpip(?:3)?\s+install(?:\s|$)/i,
    label: "Python package install",
    reason: "Installs Python packages into the active environment.",
    scope: "Active Python environment.",
  },
  {
    pattern: /\bcargo\s+update(?:\s|$)/i,
    label: "Cargo dependency update",
    reason: "Updates Cargo.lock dependency resolution.",
    scope: "Rust project dependency state.",
  },
  {
    pattern: /\bgit\s+(?:add|restore|checkout|switch|merge|rebase)(?:\s|$)/i,
    label: "Git state modification",
    reason: "Changes the Git index, working tree, or branch state.",
    scope: "Current Git repository.",
  },
  {
    pattern: /(^|[;&|]\s*)(?:mv|cp|chmod|chown)(?:\s|$)/im,
    label: "filesystem modification",
    reason: "May move, copy, overwrite, or change file metadata.",
    scope: "The supplied filesystem paths.",
  },
  {
    pattern: /\bdocker\s+compose\s+up(?:\s|$)/i,
    label: "container state change",
    reason: "Starts or modifies container services.",
    scope: "Docker Compose project.",
  },
];

const CHECKS: Pattern[] = [
  {
    pattern:
      /\b(?:cargo\s+(?:check|test|clippy)|npm\s+(?:test|run\s+build)|pnpm\s+(?:test|run\s+build)|yarn\s+(?:test|build)|python\s+-m\s+pytest|pytest)\b/i,
    label: "build or test command",
    reason: "Runs project code or a potentially expensive validation process.",
    scope: "Project build/test outputs.",
  },
];

const INSPECT: Pattern[] = [
  {
    pattern:
      /^\s*(?:ls|pwd|cat|head|tail|rg|grep|find|git\s+(?:status|diff|log))\b/i,
    label: "read-only inspection",
    reason: "Reads files or repository metadata without an expected write.",
    scope: "Displayed files or repository metadata.",
  },
];

function analyze(
  command: string,
  patterns: Pattern[],
  risk: CommandRiskLevel,
  category: CommandCategory,
): CommandRiskAnalysis | undefined {
  const matches = patterns.filter(({ pattern }) => pattern.test(command));
  if (matches.length === 0) {
    return undefined;
  }
  return {
    risk,
    category,
    reasons: matches.map(({ reason }) => reason),
    detectedPatterns: matches.map(({ label }) => label),
    affectedScope: matches.flatMap(({ scope }) => (scope ? [scope] : [])),
    saferAlternative: matches.find(({ saferAlternative }) => saferAlternative)
      ?.saferAlternative,
  };
}

export function classifyCommandRisk(command: string): CommandRiskAnalysis {
  const normalized = command.trim();
  return (
    analyze(normalized, DANGEROUS, "critical", "dangerous") ??
    analyze(normalized, MODIFYING, "high", "modifying") ??
    analyze(normalized, CHECKS, "medium", "check") ??
    analyze(normalized, INSPECT, "low", "inspect") ?? {
      risk: "medium",
      category: "check",
      reasons: [
        "The command is not recognized as a known read-only inspection.",
      ],
      detectedPatterns: ["unclassified command"],
      affectedScope: ["Depends on the command arguments and current directory."],
    }
  );
}
