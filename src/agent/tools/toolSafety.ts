const WINDOWS_ABSOLUTE = /^[A-Za-z]:[\\/]/;

export function resolveToolPath(
  workspaceRoot: string | undefined,
  relativePath: string,
): string {
  if (!workspaceRoot) {
    throw new Error("Open a workspace before using file tools.");
  }
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\/+/, "");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    WINDOWS_ABSOLUTE.test(normalized) ||
    normalized.split("/").includes("..")
  ) {
    throw new Error("Tool paths must be relative to the workspace root.");
  }
  const separator = workspaceRoot.includes("\\") ? "\\" : "/";
  return `${workspaceRoot.replace(/[\\/]+$/, "")}${separator}${normalized.replace(
    /\//g,
    separator,
  )}`;
}

export function relativeToolPath(
  workspaceRoot: string,
  absolutePath: string,
): string {
  const root = workspaceRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const path = absolutePath.replace(/\\/g, "/");
  if (path !== root && !path.startsWith(`${root}/`)) {
    throw new Error("Tool result escaped the workspace root.");
  }
  return path === root ? "." : path.slice(root.length + 1);
}
