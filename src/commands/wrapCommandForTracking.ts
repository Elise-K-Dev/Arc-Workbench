import type { CommandRunLocation } from "./commandRiskTypes";
import type { ShellHint } from "./commandTypes";

export function quotePosix(value: string): string {
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
    return [
      `printf '\\n__ARC_CWD_BEFORE:${runId}:%s__\\n' (pwd -P)`,
      ...(useWorkspace
        ? [
            `if cd ${quotePosix(workspaceRoot)}`,
            tracked,
            "else",
            `printf '\\n__ARC_CMD_START:${runId}__\\n'`,
            `printf '\\n__ARC_CMD_END:${runId}:1__\\n'`,
            "end",
          ]
        : [tracked]),
      `printf '\\n__ARC_CWD_AFTER:${runId}:%s__\\n' (pwd -P)`,
      "",
    ].join("\n");
  }
  if (shellHint === "powershell" || shellHint === "pwsh") {
    return [
      `Write-Output "__ARC_CWD_BEFORE:${runId}:$((Get-Location).Path)__"`,
      ...(useWorkspace
        ? [`Push-Location ${quotePowerShell(workspaceRoot)}`]
        : []),
      `Write-Output "__ARC_CMD_START:${runId}__"`,
      trimmed,
      "$arcExit = $LASTEXITCODE",
      "if ($null -eq $arcExit) { $arcExit = 0 }",
      `Write-Output "__ARC_CMD_END:${runId}:$arcExit__"`,
      ...(useWorkspace ? ["Pop-Location"] : []),
      `Write-Output "__ARC_CWD_AFTER:${runId}:$((Get-Location).Path)__"`,
      "",
    ].join("\n");
  }
  const tracked = [
    `printf '\\n__ARC_CMD_START:${runId}__\\n'`,
    trimmed,
    "__arc_exit=$?",
    `printf '\\n__ARC_CMD_END:${runId}:%s__\\n' "$__arc_exit"`,
  ].join("\n");
  return [
    `printf '\\n__ARC_CWD_BEFORE:${runId}:%s__\\n' "$(pwd -P)"`,
    ...(useWorkspace
      ? [
          `if cd ${quotePosix(workspaceRoot)}; then`,
          tracked,
          "else",
          `printf '\\n__ARC_CMD_START:${runId}__\\n'`,
          `printf '\\n__ARC_CMD_END:${runId}:1__\\n'`,
          "fi",
        ]
      : [tracked]),
    `printf '\\n__ARC_CWD_AFTER:${runId}:%s__\\n' "$(pwd -P)"`,
    "",
  ].join("\n");
}
