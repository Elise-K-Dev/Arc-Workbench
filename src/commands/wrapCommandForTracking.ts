import type { CommandRunLocation } from "./commandRiskTypes";
import type { ShellHint } from "./commandTypes";

function quotePosix(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function wrapCommandForTracking(
  runId: string,
  command: string,
  shellHint?: ShellHint,
  runLocation: CommandRunLocation = "terminal_cwd",
  workspaceRoot?: string,
): string {
  const trimmed = command.replace(/(?:\r?\n)+$/, "");
  const useWorkspace = runLocation === "workspace_root" && workspaceRoot;
  if (shellHint === "fish") {
    const tracked = [
      `printf '\\n__ARC_CMD_START:${runId}__\\n'`,
      trimmed,
      "set __arc_exit $status",
      `printf '\\n__ARC_CMD_END:${runId}:%s__\\n' "$__arc_exit"`,
    ].join("\n");
    return useWorkspace
      ? `cd ${quotePosix(workspaceRoot)}; and begin\n${tracked}\nend\n`
      : `${tracked}\n`;
  }
  if (shellHint === "powershell" || shellHint === "pwsh") {
    return [
      ...(useWorkspace
        ? [`Push-Location ${quotePowerShell(workspaceRoot)}`]
        : []),
      `Write-Output "__ARC_CMD_START:${runId}__"`,
      trimmed,
      "$arcExit = $LASTEXITCODE",
      "if ($null -eq $arcExit) { $arcExit = 0 }",
      `Write-Output "__ARC_CMD_END:${runId}:$arcExit__"`,
      ...(useWorkspace ? ["Pop-Location"] : []),
      "",
    ].join("\n");
  }
  const tracked = [
    `printf '\\n__ARC_CMD_START:${runId}__\\n'`,
    trimmed,
    "__arc_exit=$?",
    `printf '\\n__ARC_CMD_END:${runId}:%s__\\n' "$__arc_exit"`,
  ].join("\n");
  return useWorkspace
    ? `cd ${quotePosix(workspaceRoot)} && {\n${tracked}\n}\n`
    : `${tracked}\n`;
}
