import { redactSecrets } from "../redaction";

export type CodexHandoffContext = {
  taskTitle: string;
  userRequest: string;
  workspaceRoot?: string;
  gitStatusSummary?: string;
  selectedDiffSummary?: string;
  recentCommandResults?: string[];
  localAgentConclusion?: string;
};

function section(label: string, value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? `${label}:\n${trimmed}` : undefined;
}

function truncate(value: string, limit: number): string {
  return value.length > limit ? `${value.slice(0, limit)}\n[truncated]` : value;
}

export function buildCodexHandoffPrompt(
  context: CodexHandoffContext,
): string {
  const commandSummary = context.recentCommandResults
    ?.slice(-3)
    .map((result) => truncate(result, 2_000))
    .join("\n\n");
  const sections = [
    "You are working on this Arc Workbench task.",
    section("Task", context.taskTitle),
    section("User request", truncate(context.userRequest, 6_000)),
    section("Workspace", context.workspaceRoot),
    section("Git status", truncate(context.gitStatusSummary ?? "", 4_000)),
    section(
      "Selected diff summary",
      truncate(context.selectedDiffSummary ?? "", 4_000),
    ),
    section("Recent command result", commandSummary),
    section(
      "Local Agent notes",
      truncate(context.localAgentConclusion ?? "", 6_000),
    ),
    `Please inspect the repository, make the minimal necessary changes, run appropriate checks, and report:
1. files changed
2. rationale
3. commands run
4. test/check results
5. remaining risks

Keep the patch safe. Do not run destructive commands without explicit approval.`,
  ].filter((value): value is string => Boolean(value));

  return redactSecrets(sections.join("\n\n"));
}
