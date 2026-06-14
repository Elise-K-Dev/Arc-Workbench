import type { ShellHint } from "./commandTypes";

export function wrapCommandForTracking(
  runId: string,
  command: string,
  shellHint?: ShellHint,
): string {
  const trimmed = command.replace(/(?:\r?\n)+$/, "");
  if (shellHint === "powershell" || shellHint === "pwsh") {
    return [
      `Write-Output "__ARC_CMD_START:${runId}__"`,
      trimmed,
      "$arcExit = $LASTEXITCODE",
      "if ($null -eq $arcExit) { $arcExit = 0 }",
      `Write-Output "__ARC_CMD_END:${runId}:$arcExit__"`,
      "",
    ].join("\n");
  }
  return [
    `printf '\\n__ARC_CMD_START:${runId}__\\n'`,
    trimmed,
    "__arc_exit=$?",
    `printf '\\n__ARC_CMD_END:${runId}:%s__\\n' "$__arc_exit"`,
    "",
  ].join("\n");
}
