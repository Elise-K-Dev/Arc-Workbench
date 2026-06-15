use std::fs;
use std::path::{Component, Path};
use std::process::Command;

use serde::{Deserialize, Serialize};

const MAX_TEXT_FILE_SIZE: u64 = 5 * 1024 * 1024;
const MAX_AGENT_TOOL_FILE_SIZE: u64 = 1024 * 1024;
const DEFAULT_SEARCH_LIMIT: usize = 500;
const MAX_SEARCH_LIMIT: usize = 1000;
const DEFAULT_SEARCH_OUTPUT_LIMIT: usize = 120_000;
const MAX_SEARCH_OUTPUT_LIMIT: usize = 250_000;
const IGNORED_DIRECTORIES: &[&str] = &[
    ".git",
    "node_modules",
    "target",
    "dist",
    "build",
    ".venv",
    "venv",
    "__pycache__",
];

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileTreeNode {
    name: String,
    path: String,
    kind: &'static str,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchOptions {
    pub max_results: Option<usize>,
    pub max_output_bytes: Option<usize>,
    pub context_lines: Option<usize>,
    pub path_filter: Option<String>,
    pub extensions: Option<Vec<String>>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchMatch {
    path: String,
    line: usize,
    column: Option<usize>,
    text: String,
    before: Vec<String>,
    after: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSearchResult {
    query: String,
    matches: Vec<WorkspaceSearchMatch>,
    truncated: bool,
    backend: &'static str,
    error: Option<String>,
}

#[tauri::command]
pub fn read_text_file(path: String) -> Result<String, String> {
    let metadata =
        fs::metadata(&path).map_err(|error| format!("failed to inspect {path}: {error}"))?;
    if metadata.len() > MAX_TEXT_FILE_SIZE {
        return Err("File is larger than the 5 MB editor limit.".to_string());
    }

    let bytes = fs::read(&path).map_err(|error| format!("failed to read {path}: {error}"))?;
    if bytes.contains(&0) {
        return Err("This file does not look like a text file.".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "This file does not look like a text file.".to_string())
}

#[tauri::command]
pub fn read_workspace_text_file(
    root_path: String,
    relative_path: String,
) -> Result<String, String> {
    let relative = Path::new(&relative_path);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Tool paths must stay inside the workspace root.".to_string());
    }
    let root = fs::canonicalize(&root_path)
        .map_err(|error| format!("failed to resolve workspace root: {error}"))?;
    if !root.is_dir() {
        return Err("Workspace root is not a directory.".to_string());
    }
    let target = fs::canonicalize(root.join(relative))
        .map_err(|error| format!("failed to resolve workspace file: {error}"))?;
    if !target.starts_with(&root) || !target.is_file() {
        return Err("Tool path escaped the workspace root.".to_string());
    }
    let metadata =
        fs::metadata(&target).map_err(|error| format!("failed to inspect file: {error}"))?;
    if metadata.len() > MAX_AGENT_TOOL_FILE_SIZE {
        return Err("File is larger than the 1 MB Agent tool limit.".to_string());
    }
    let bytes = fs::read(&target).map_err(|error| format!("failed to read file: {error}"))?;
    if bytes.contains(&0) {
        return Err("This file does not look like a text file.".to_string());
    }
    String::from_utf8(bytes).map_err(|_| "This file does not look like a text file.".to_string())
}

#[tauri::command]
pub fn search_workspace(
    root_path: String,
    query: String,
    options: Option<WorkspaceSearchOptions>,
) -> Result<WorkspaceSearchResult, String> {
    search_workspace_impl(&root_path, &query, options, true)
}

fn search_workspace_impl(
    root_path: &str,
    query: &str,
    options: Option<WorkspaceSearchOptions>,
    try_ripgrep: bool,
) -> Result<WorkspaceSearchResult, String> {
    if query.trim().is_empty() {
        return Err("Search query must not be empty.".to_string());
    }
    let root = fs::canonicalize(root_path)
        .map_err(|error| format!("failed to resolve workspace root: {error}"))?;
    if !root.is_dir() {
        return Err("Workspace root is not a directory.".to_string());
    }
    let options = options.unwrap_or(WorkspaceSearchOptions {
        max_results: None,
        max_output_bytes: None,
        context_lines: None,
        path_filter: None,
        extensions: None,
    });
    validate_search_filter(options.path_filter.as_deref())?;
    let limits = SearchLimits {
        max_results: options
            .max_results
            .unwrap_or(DEFAULT_SEARCH_LIMIT)
            .clamp(1, MAX_SEARCH_LIMIT),
        max_output_bytes: options
            .max_output_bytes
            .unwrap_or(DEFAULT_SEARCH_OUTPUT_LIMIT)
            .clamp(1024, MAX_SEARCH_OUTPUT_LIMIT),
        context_lines: options.context_lines.unwrap_or(0).min(10),
    };

    if try_ripgrep {
        match search_with_ripgrep(&root, query, &options, limits) {
            Ok(result) => return Ok(result),
            Err(RipgrepError::Unavailable) => {}
            Err(RipgrepError::Failed(message)) => {
                let mut result = search_fallback(&root, query, &options, limits)?;
                result.error = Some(message);
                return Ok(result);
            }
        }
    }
    search_fallback(&root, query, &options, limits)
}

#[derive(Clone, Copy)]
struct SearchLimits {
    max_results: usize,
    max_output_bytes: usize,
    context_lines: usize,
}

enum RipgrepError {
    Unavailable,
    Failed(String),
}

fn search_with_ripgrep(
    root: &Path,
    query: &str,
    options: &WorkspaceSearchOptions,
    limits: SearchLimits,
) -> Result<WorkspaceSearchResult, RipgrepError> {
    let mut command = Command::new("rg");
    command
        .current_dir(root)
        .args(["--json", "--line-number", "--column", "--color", "never"])
        .args(["--glob", "!.git/**"])
        .args(["--glob", "!node_modules/**"])
        .args(["--glob", "!target/**"])
        .args(["--glob", "!dist/**"])
        .args(["--glob", "!build/**"])
        .args(["--glob", "!.venv/**"])
        .args(["--glob", "!venv/**"])
        .args(["--glob", "!**/__pycache__/**"]);
    if limits.context_lines > 0 {
        command.args(["--context", &limits.context_lines.to_string()]);
    }
    if let Some(filter) = options.path_filter.as_deref() {
        command.args(["--glob", filter]);
    }
    for extension in options.extensions.as_deref().unwrap_or_default() {
        let clean = extension.trim().trim_start_matches('.');
        if !clean.is_empty()
            && clean
                .chars()
                .all(|character| character.is_ascii_alphanumeric())
        {
            command.args(["--glob", &format!("*.{clean}")]);
        }
    }
    command.arg("--").arg(query).arg(".");
    let output = command.output().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            RipgrepError::Unavailable
        } else {
            RipgrepError::Failed(format!("ripgrep could not start: {error}"))
        }
    })?;
    if !output.status.success() && output.status.code() != Some(1) {
        return Err(RipgrepError::Failed(format!(
            "ripgrep failed: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )));
    }

    let mut matches: Vec<WorkspaceSearchMatch> = Vec::new();
    let mut output_bytes = 0;
    let mut truncated = false;
    let mut recent_context: Vec<(String, usize, String)> = Vec::new();
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let Ok(value) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        if value["type"] == "context" {
            let data = &value["data"];
            let Some(path) = data["path"]["text"].as_str() else {
                continue;
            };
            let Some(line_number) = data["line_number"].as_u64() else {
                continue;
            };
            let text = data["lines"]["text"]
                .as_str()
                .unwrap_or_default()
                .trim_end_matches(['\r', '\n'])
                .to_string();
            if let Some(last) = matches.last_mut() {
                if last.path == path.trim_start_matches("./").replace('\\', "/")
                    && line_number as usize > last.line
                    && line_number as usize <= last.line + limits.context_lines
                {
                    last.after.push(text);
                    continue;
                }
            }
            recent_context.push((
                path.trim_start_matches("./").replace('\\', "/"),
                line_number as usize,
                text,
            ));
            if recent_context.len() > limits.context_lines {
                recent_context.remove(0);
            }
            continue;
        }
        if value["type"] != "match" {
            continue;
        }
        let data = &value["data"];
        let Some(path) = data["path"]["text"].as_str() else {
            continue;
        };
        let Some(line_number) = data["line_number"].as_u64() else {
            continue;
        };
        let text = data["lines"]["text"]
            .as_str()
            .unwrap_or_default()
            .trim_end_matches(['\r', '\n'])
            .to_string();
        let column = data["submatches"]
            .as_array()
            .and_then(|items| items.first())
            .and_then(|item| item["start"].as_u64())
            .map(|value| value as usize + 1);
        output_bytes += path.len() + text.len();
        if matches.len() >= limits.max_results || output_bytes > limits.max_output_bytes {
            truncated = true;
            break;
        }
        let normalized_path = path.trim_start_matches("./").replace('\\', "/");
        let line_number = line_number as usize;
        let before = recent_context
            .iter()
            .filter(|(context_path, context_line, _)| {
                context_path == &normalized_path
                    && *context_line < line_number
                    && *context_line + limits.context_lines >= line_number
            })
            .map(|(_, _, text)| text.clone())
            .collect();
        recent_context.clear();
        matches.push(WorkspaceSearchMatch {
            path: normalized_path,
            line: line_number,
            column,
            text,
            before,
            after: Vec::new(),
        });
    }
    Ok(WorkspaceSearchResult {
        query: query.to_string(),
        matches,
        truncated,
        backend: "ripgrep",
        error: None,
    })
}

fn search_fallback(
    root: &Path,
    query: &str,
    options: &WorkspaceSearchOptions,
    limits: SearchLimits,
) -> Result<WorkspaceSearchResult, String> {
    let mut files = Vec::new();
    collect_search_files(root, root, options, &mut files, 5000)?;
    let mut matches = Vec::new();
    let mut output_bytes = 0;
    let mut truncated = files.len() >= 5000;
    for path in files {
        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        if metadata.len() > MAX_AGENT_TOOL_FILE_SIZE {
            continue;
        }
        let Ok(bytes) = fs::read(&path) else { continue };
        if bytes.contains(&0) {
            continue;
        }
        let Ok(content) = String::from_utf8(bytes) else {
            continue;
        };
        let lines: Vec<&str> = content.lines().collect();
        for (index, line) in lines.iter().enumerate() {
            let Some(column) = line.find(query) else {
                continue;
            };
            let relative = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            output_bytes += relative.len() + line.len();
            if matches.len() >= limits.max_results || output_bytes > limits.max_output_bytes {
                truncated = true;
                break;
            }
            let before_start = index.saturating_sub(limits.context_lines);
            let after_end = (index + limits.context_lines + 1).min(lines.len());
            matches.push(WorkspaceSearchMatch {
                path: relative,
                line: index + 1,
                column: Some(column + 1),
                text: (*line).to_string(),
                before: lines[before_start..index]
                    .iter()
                    .map(|value| (*value).to_string())
                    .collect(),
                after: lines[index + 1..after_end]
                    .iter()
                    .map(|value| (*value).to_string())
                    .collect(),
            });
        }
        if truncated {
            break;
        }
    }
    Ok(WorkspaceSearchResult {
        query: query.to_string(),
        matches,
        truncated,
        backend: "fallback",
        error: None,
    })
}

fn collect_search_files(
    root: &Path,
    directory: &Path,
    options: &WorkspaceSearchOptions,
    files: &mut Vec<std::path::PathBuf>,
    limit: usize,
) -> Result<(), String> {
    if files.len() >= limit {
        return Ok(());
    }
    let entries = fs::read_dir(directory)
        .map_err(|error| format!("failed to read search directory: {error}"))?;
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() {
            if !IGNORED_DIRECTORIES.contains(&name.as_str()) {
                collect_search_files(root, &path, options, files, limit)?;
            }
        } else if file_type.is_file() && search_path_allowed(root, &path, options) {
            files.push(path);
        }
        if files.len() >= limit {
            break;
        }
    }
    Ok(())
}

fn search_path_allowed(root: &Path, path: &Path, options: &WorkspaceSearchOptions) -> bool {
    let relative = path
        .strip_prefix(root)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");
    if let Some(filter) = options.path_filter.as_deref() {
        let plain = filter.trim_matches('*').trim_matches('/');
        if !plain.is_empty() && !relative.contains(plain) {
            return false;
        }
    }
    let extensions = options.extensions.as_deref().unwrap_or_default();
    extensions.is_empty()
        || path.extension().is_some_and(|extension| {
            extensions.iter().any(|candidate| {
                extension.eq_ignore_ascii_case(candidate.trim().trim_start_matches('.'))
            })
        })
}

fn validate_search_filter(filter: Option<&str>) -> Result<(), String> {
    if let Some(filter) = filter {
        let path = Path::new(filter);
        if path.is_absolute()
            || path.components().any(|component| {
                matches!(
                    component,
                    Component::ParentDir | Component::RootDir | Component::Prefix(_)
                )
            })
        {
            return Err("Search path filters must stay inside the workspace root.".to_string());
        }
    }
    Ok(())
}

#[tauri::command]
pub fn write_text_file(path: String, content: String) -> Result<(), String> {
    fs::write(&path, content).map_err(|error| format!("failed to write {path}: {error}"))
}

#[tauri::command]
pub fn read_dir(path: String) -> Result<Vec<FileTreeNode>, String> {
    let entries =
        fs::read_dir(&path).map_err(|error| format!("failed to read directory {path}: {error}"))?;
    let mut nodes = Vec::new();

    for entry in entries.flatten() {
        let entry_path = entry.path();
        let name = entry.file_name().to_string_lossy().into_owned();
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() && IGNORED_DIRECTORIES.contains(&name.as_str()) {
            continue;
        }
        if !file_type.is_dir() && !file_type.is_file() {
            continue;
        }

        nodes.push(FileTreeNode {
            name,
            path: path_string(&entry_path),
            kind: if file_type.is_dir() {
                "directory"
            } else {
                "file"
            },
        });
    }

    nodes.sort_by(|left, right| {
        let left_rank = if left.kind == "directory" { 0 } else { 1 };
        let right_rank = if right.kind == "directory" { 0 } else { 1 };
        left_rank
            .cmp(&right_rank)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });
    Ok(nodes)
}

fn path_string(path: &Path) -> String {
    path.to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::{
        read_dir, read_workspace_text_file, search_workspace_impl, WorkspaceSearchOptions,
    };
    use std::fs;

    #[test]
    fn read_dir_sorts_directories_first_and_skips_heavy_directories() {
        let root =
            std::env::temp_dir().join(format!("arc-workbench-read-dir-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::create_dir_all(root.join("node_modules")).unwrap();
        fs::write(root.join("z.txt"), "z").unwrap();
        fs::write(root.join("a.txt"), "a").unwrap();

        let nodes = read_dir(root.to_string_lossy().into_owned()).unwrap();
        let names: Vec<_> = nodes.iter().map(|node| node.name.as_str()).collect();
        assert_eq!(names, vec!["src", "a.txt", "z.txt"]);

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn workspace_tool_read_rejects_traversal_and_reads_text() {
        let root =
            std::env::temp_dir().join(format!("arc-workbench-tool-read-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/main.ts"), "export const value = 42;").unwrap();

        assert_eq!(
            read_workspace_text_file(
                root.to_string_lossy().into_owned(),
                "src/main.ts".to_string()
            )
            .unwrap(),
            "export const value = 42;"
        );
        assert!(read_workspace_text_file(
            root.to_string_lossy().into_owned(),
            "../secret.txt".to_string()
        )
        .is_err());

        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn workspace_search_fallback_is_structured_bounded_and_rejects_escape() {
        let root =
            std::env::temp_dir().join(format!("arc-workbench-search-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(root.join("src")).unwrap();
        fs::write(root.join("src/main.ts"), "needle one\ncontext\nneedle two").unwrap();
        let result = search_workspace_impl(
            &root.to_string_lossy(),
            "needle",
            Some(WorkspaceSearchOptions {
                max_results: Some(1),
                max_output_bytes: Some(4096),
                context_lines: Some(1),
                path_filter: Some("src".to_string()),
                extensions: Some(vec!["ts".to_string()]),
            }),
            false,
        )
        .unwrap();
        assert_eq!(result.backend, "fallback");
        assert_eq!(result.matches.len(), 1);
        assert!(result.truncated);
        assert_eq!(result.matches[0].path, "src/main.ts");
        assert!(search_workspace_impl(
            &root.to_string_lossy(),
            "needle",
            Some(WorkspaceSearchOptions {
                max_results: None,
                max_output_bytes: None,
                context_lines: None,
                path_filter: Some("../outside".to_string()),
                extensions: None,
            }),
            false,
        )
        .is_err());
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(unix)]
    #[test]
    fn workspace_tool_read_rejects_symlink_escape() {
        use std::os::unix::fs::symlink;

        let root = std::env::temp_dir().join(format!(
            "arc-workbench-tool-symlink-{}",
            uuid::Uuid::new_v4()
        ));
        let outside = std::env::temp_dir().join(format!(
            "arc-workbench-tool-outside-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        fs::write(&outside, "secret").unwrap();
        symlink(&outside, root.join("linked.txt")).unwrap();

        assert!(read_workspace_text_file(
            root.to_string_lossy().into_owned(),
            "linked.txt".to_string()
        )
        .is_err());

        fs::remove_dir_all(root).unwrap();
        fs::remove_file(outside).unwrap();
    }
}
