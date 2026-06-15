const MISSING_PATH =
  /(?:no such file or directory|cannot find|file not found|could not find)/i;
const WORKSPACE_RELATIVE =
  /(?:^|[\s"'`])(?:src\/|tests?\/|package\.json\b|Cargo\.toml\b|README\.md\b)/i;

export function detectCwdMismatch(
  command: string,
  output: string,
  runLocation: "workspace_root" | "terminal_cwd",
): boolean {
  return (
    runLocation === "terminal_cwd" &&
    MISSING_PATH.test(output) &&
    WORKSPACE_RELATIVE.test(command)
  );
}
