use std::path::Path;
use std::process::{Command, Output};

use super::types::{GitFileStatus, GitRepoInfo, GitStatus};

#[tauri::command]
pub fn git_repo_info(root_path: String) -> Result<GitRepoInfo, String> {
    let Some(repo_root) = repository_root(&root_path)? else {
        return Ok(GitRepoInfo {
            is_repo: false,
            root_path: None,
            branch: None,
        });
    };
    let branch = current_branch(&repo_root)?;
    Ok(GitRepoInfo {
        is_repo: true,
        root_path: Some(repo_root),
        branch,
    })
}

#[tauri::command]
pub fn git_status(root_path: String) -> Result<GitStatus, String> {
    let Some(repo_root) = repository_root(&root_path)? else {
        return Ok(GitStatus {
            is_repo: false,
            root_path: None,
            branch: None,
            files: Vec::new(),
        });
    };
    let output = run_git(&repo_root, &["status", "--porcelain=v1", "-b"])?;
    let stdout = output_text(output, "git status")?;
    let (branch, files) = parse_status(&stdout);
    Ok(GitStatus {
        is_repo: true,
        root_path: Some(repo_root),
        branch,
        files,
    })
}

#[tauri::command]
pub fn git_diff_file(root_path: String, file_path: String) -> Result<String, String> {
    let status = git_status(root_path.clone())?;
    if !status.is_repo {
        return Err("This folder is not a Git repository.".to_string());
    }
    let Some(file) = status.files.iter().find(|file| file.path == file_path) else {
        return Err("The selected file is not in Git status.".to_string());
    };
    if file.untracked {
        return Ok("Untracked file. No diff available yet.".to_string());
    }

    let args = if file.staged && !file.unstaged {
        vec!["diff", "--cached", "--", file_path.as_str()]
    } else {
        vec!["diff", "--", file_path.as_str()]
    };
    let repo_root = status
        .root_path
        .ok_or_else(|| "Git repository root is unavailable.".to_string())?;
    output_text(run_git(&repo_root, &args)?, "git diff")
}

fn repository_root(root_path: &str) -> Result<Option<String>, String> {
    let output = run_git(root_path, &["rev-parse", "--show-toplevel"])?;
    if !output.status.success() {
        return Ok(None);
    }
    Ok(Some(
        String::from_utf8_lossy(&output.stdout).trim().to_string(),
    ))
}

fn current_branch(root_path: &str) -> Result<Option<String>, String> {
    let output = run_git(root_path, &["branch", "--show-current"])?;
    let branch = output_text(output, "git branch")?;
    Ok((!branch.trim().is_empty()).then(|| branch.trim().to_string()))
}

fn run_git(root_path: &str, args: &[&str]) -> Result<Output, String> {
    if !Path::new(root_path).is_dir() {
        return Err("Workspace folder does not exist.".to_string());
    }
    Command::new("git")
        .args(args)
        .current_dir(root_path)
        .output()
        .map_err(|error| format!("failed to run git: {error}"))
}

fn output_text(output: Output, operation: &str) -> Result<String, String> {
    if output.status.success() {
        return String::from_utf8(output.stdout)
            .map_err(|_| format!("{operation} returned non-UTF-8 output"));
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(if message.is_empty() {
        format!("{operation} failed")
    } else {
        message
    })
}

fn parse_status(output: &str) -> (Option<String>, Vec<GitFileStatus>) {
    let mut branch = None;
    let mut files = Vec::new();
    for line in output.lines() {
        if let Some(header) = line.strip_prefix("## ") {
            let name = header
                .split_once("...")
                .map(|(name, _)| name)
                .unwrap_or(header);
            branch = Some(name.trim().to_string());
            continue;
        }
        if line.len() < 3 {
            continue;
        }
        let bytes = line.as_bytes();
        let index = bytes[0] as char;
        let worktree = bytes[1] as char;
        let untracked = index == '?' && worktree == '?';
        let raw_path = line[3..].trim();
        let path = raw_path
            .rsplit_once(" -> ")
            .map(|(_, destination)| destination)
            .unwrap_or(raw_path)
            .trim_matches('"')
            .to_string();
        files.push(GitFileStatus {
            path,
            status: if untracked {
                "??".to_string()
            } else if worktree != ' ' {
                worktree.to_string()
            } else {
                index.to_string()
            },
            staged: !untracked && index != ' ',
            unstaged: !untracked && worktree != ' ',
            untracked,
        });
    }
    (branch, files)
}

#[cfg(test)]
mod tests {
    use super::parse_status;

    #[test]
    fn parses_porcelain_branch_and_file_states() {
        let (branch, files) = parse_status(
            "## main...origin/main\n M src/main.ts\nA  src/new.ts\n?? notes.txt\nR  old.ts -> new.ts\n",
        );
        assert_eq!(branch.as_deref(), Some("main"));
        assert_eq!(files.len(), 4);
        assert!(files[0].unstaged);
        assert!(files[1].staged);
        assert!(files[2].untracked);
        assert_eq!(files[3].path, "new.ts");
    }
}
