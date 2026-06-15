import { classifyCommandRisk } from "./classifyCommandRisk";
import type { CommandProposal, ShellHint } from "./commandTypes";

const SHELL_LANGUAGES: Record<string, ShellHint> = {
  bash: "bash",
  sh: "sh",
  shell: "sh",
  zsh: "zsh",
  fish: "fish",
  powershell: "powershell",
  pwsh: "pwsh",
};

function proposal(raw: string, shellHint?: ShellHint): CommandProposal {
  const commands = raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
  const classified = classifyCommandRisk(raw);
  return {
    id: crypto.randomUUID(),
    raw,
    commands,
    shellHint,
    risk: classified.risk,
    reason: classified.reasons.join(" "),
    analysis: classified,
  };
}

export function extractCommandProposals(text: string): CommandProposal[] {
  const proposals: CommandProposal[] = [];
  const covered: Array<[number, number]> = [];
  const fencePattern = /```([A-Za-z0-9_-]+)[^\n]*\r?\n([\s\S]*?)```/g;
  for (const match of text.matchAll(fencePattern)) {
    const language = SHELL_LANGUAGES[match[1].toLowerCase()];
    const raw = match[2].trim();
    if (!language || !raw) {
      continue;
    }
    proposals.push(proposal(raw, language));
    covered.push([match.index ?? 0, (match.index ?? 0) + match[0].length]);
  }

  const inlinePattern = /(?:^|\n)Command:\s*[ \t]*([^\r\n`]+)(?=\r?\n|$)/gi;
  for (const match of text.matchAll(inlinePattern)) {
    const index = match.index ?? 0;
    if (covered.some(([start, end]) => index >= start && index < end)) {
      continue;
    }
    const raw = match[1].trim();
    if (raw) {
      proposals.push(proposal(raw));
    }
  }
  return proposals;
}
