import { invoke } from "@tauri-apps/api/core";

export type GitRepoInfo = {
  isRepo: boolean;
  rootPath?: string;
  branch?: string;
};

export type GitFileStatus = {
  path: string;
  status: string;
  staged: boolean;
  unstaged: boolean;
  untracked: boolean;
};

export type GitStatus = GitRepoInfo & {
  files: GitFileStatus[];
};

export function getGitRepoInfo(rootPath: string): Promise<GitRepoInfo> {
  return invoke<GitRepoInfo>("git_repo_info", { rootPath });
}

export function getGitStatus(rootPath: string): Promise<GitStatus> {
  return invoke<GitStatus>("git_status", { rootPath });
}

export function getGitFileDiff(
  rootPath: string,
  filePath: string,
): Promise<string> {
  return invoke<string>("git_diff_file", { rootPath, filePath });
}
