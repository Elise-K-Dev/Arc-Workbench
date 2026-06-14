use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};
use tauri::Manager;

use super::types::{
    PatchApplyResult, PatchCheckResult, PatchFileSnapshot, PatchRollbackRecord,
    PatchRollbackResult, PatchRollbackStatus, PatchSummary,
};

const MAX_SNAPSHOT_FILE_SIZE: u64 = 5 * 1024 * 1024;
const MAX_SNAPSHOT_TOTAL_SIZE: u64 = 20 * 1024 * 1024;

#[tauri::command]
pub fn patch_check(root_path: String, raw_patch: String) -> Result<PatchCheckResult, String> {
    validate_patch(&root_path, &raw_patch)?;
    let output = run_git_apply(&root_path, &raw_patch, true)?;
    Ok(if output.status.success() {
        PatchCheckResult {
            ok: true,
            message: Some("Patch is ready to apply.".to_string()),
        }
    } else {
        PatchCheckResult {
            ok: false,
            message: Some(output_error(output, "git apply --check failed")),
        }
    })
}

#[tauri::command]
pub fn patch_create_snapshot(
    app: tauri::AppHandle,
    root_path: String,
    raw_patch: String,
    additions: usize,
    deletions: usize,
) -> Result<PatchRollbackRecord, String> {
    let paths = validate_patch(&root_path, &raw_patch)?;
    let root = canonical_root(&root_path)?;
    let directory = snapshot_directory(&app)?;
    create_snapshot_record(&directory, &root, &paths, additions, deletions)
}

#[tauri::command]
pub fn patch_apply_with_snapshot(
    app: tauri::AppHandle,
    root_path: String,
    raw_patch: String,
    snapshot_id: String,
) -> Result<PatchApplyResult, String> {
    let paths = validate_patch(&root_path, &raw_patch)?;
    let root = canonical_root(&root_path)?;
    let directory = snapshot_directory(&app)?;
    let mut snapshot = load_snapshot(&directory, &snapshot_id)?;
    validate_snapshot_root(&snapshot, &root)?;
    if snapshot.patch_summary.files != paths
        || snapshot
            .files
            .iter()
            .map(|file| &file.relative_path)
            .ne(paths.iter())
    {
        let _ = invalidate_record(&directory, &mut snapshot);
        return Ok(PatchApplyResult {
            ok: false,
            message: "Rollback snapshot does not match the patch file list.".to_string(),
            snapshot: None,
        });
    }
    if let Err(error) = validate_pre_apply_snapshot(&root, &snapshot) {
        let _ = invalidate_record(&directory, &mut snapshot);
        return Ok(PatchApplyResult {
            ok: false,
            message: error,
            snapshot: None,
        });
    }
    let check = run_git_apply(&root_path, &raw_patch, true)?;
    if !check.status.success() {
        let message = output_error(check, "git apply --check failed");
        let _ = invalidate_record(&directory, &mut snapshot);
        return Ok(PatchApplyResult {
            ok: false,
            message,
            snapshot: None,
        });
    }
    let output = run_git_apply(&root_path, &raw_patch, false)?;
    if !output.status.success() {
        let message = output_error(output, "git apply failed");
        let _ = invalidate_record(&directory, &mut snapshot);
        return Ok(PatchApplyResult {
            ok: false,
            message,
            snapshot: None,
        });
    }
    if let Err(error) = finalize_snapshot_record(&directory, &root, &mut snapshot) {
        let _ = invalidate_record(&directory, &mut snapshot);
        return Ok(PatchApplyResult {
            ok: true,
            message: format!(
                "Patch applied, but no rollback is available because the snapshot could not be finalized: {error}"
            ),
            snapshot: None,
        });
    }
    Ok(PatchApplyResult {
        ok: true,
        message: "Patch applied successfully. Rollback snapshot: available.".to_string(),
        snapshot: Some(snapshot),
    })
}

#[tauri::command]
pub fn patch_list_snapshots(
    app: tauri::AppHandle,
    root_path: String,
) -> Result<Vec<PatchRollbackRecord>, String> {
    let root = canonical_root(&root_path)?;
    let directory = snapshot_directory(&app)?;
    let mut records = Vec::new();
    for entry in fs::read_dir(directory).map_err(|error| error.to_string())? {
        let Ok(entry) = entry else {
            continue;
        };
        if entry.path().extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(record) = load_snapshot_path(&entry.path()) else {
            continue;
        };
        if Path::new(&record.workspace_root) == root {
            records.push(record);
        }
    }
    records.sort_by(|left, right| right.created_at.cmp(&left.created_at));
    Ok(records)
}

#[tauri::command]
pub fn patch_invalidate_snapshot(
    app: tauri::AppHandle,
    root_path: String,
    snapshot_id: String,
) -> Result<(), String> {
    let root = canonical_root(&root_path)?;
    let directory = snapshot_directory(&app)?;
    let mut record = load_snapshot(&directory, &snapshot_id)?;
    validate_snapshot_root(&record, &root)?;
    invalidate_record(&directory, &mut record)
}

#[tauri::command]
pub fn patch_rollback(
    app: tauri::AppHandle,
    root_path: String,
    snapshot_id: String,
) -> Result<PatchRollbackResult, String> {
    let root = canonical_root(&root_path)?;
    let directory = snapshot_directory(&app)?;
    rollback_snapshot_record(&directory, &root, &snapshot_id)
}

fn rollback_snapshot_record(
    directory: &Path,
    root: &Path,
    snapshot_id: &str,
) -> Result<PatchRollbackResult, String> {
    let mut record = load_snapshot(directory, snapshot_id)?;
    validate_snapshot_root(&record, &root)?;
    if !matches!(record.status, PatchRollbackStatus::Available) {
        return Ok(PatchRollbackResult {
            ok: false,
            message: "Rollback snapshot is not available.".to_string(),
            record: Some(record),
        });
    }

    for file in &record.files {
        let relative = safe_relative_path(&file.relative_path)?;
        let target = fs::canonicalize(root.join(relative))
            .map_err(|_| format!("Rollback target is missing: {}", file.relative_path))?;
        if !target.starts_with(&root) || !target.is_file() {
            return Err(format!(
                "Rollback target is outside the workspace: {}",
                file.relative_path
            ));
        }
        let content = fs::read(&target)
            .map_err(|error| format!("failed to read {}: {error}", file.relative_path))?;
        let expected = file
            .post_sha256
            .as_deref()
            .ok_or_else(|| "Rollback snapshot has no post-apply hash.".to_string())?;
        if sha256(&content) != expected {
            return Ok(PatchRollbackResult {
                ok: false,
                message: format!(
                    "Cannot rollback because file changed after patch apply: {}",
                    file.relative_path
                ),
                record: Some(record),
            });
        }
    }

    for file in &record.files {
        let target = root.join(safe_relative_path(&file.relative_path)?);
        fs::write(&target, file.pre_content.as_bytes())
            .map_err(|error| format!("failed to restore {}: {error}", file.relative_path))?;
    }
    record.status = PatchRollbackStatus::RolledBack;
    write_snapshot(directory, &record)?;
    Ok(PatchRollbackResult {
        ok: true,
        message: "Patch rolled back successfully.".to_string(),
        record: Some(record),
    })
}

fn snapshot_directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let directory = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("failed to resolve app data directory: {error}"))?
        .join("arc-workbench")
        .join("patch-snapshots");
    fs::create_dir_all(&directory)
        .map_err(|error| format!("failed to create snapshot directory: {error}"))?;
    Ok(directory)
}

fn canonical_root(root_path: &str) -> Result<PathBuf, String> {
    let root =
        fs::canonicalize(root_path).map_err(|_| "Workspace root is not accessible.".to_string())?;
    if !root.is_dir() {
        return Err("Workspace root is not accessible.".to_string());
    }
    Ok(root)
}

fn create_snapshot_record(
    directory: &Path,
    root: &Path,
    paths: &[String],
    additions: usize,
    deletions: usize,
) -> Result<PatchRollbackRecord, String> {
    let mut total_size = 0_u64;
    let mut files = Vec::new();
    for path in paths {
        let target = root.join(safe_relative_path(path)?);
        let metadata = fs::metadata(&target)
            .map_err(|error| format!("failed to inspect snapshot file {path}: {error}"))?;
        if metadata.len() > MAX_SNAPSHOT_FILE_SIZE {
            return Err(
                "Cannot create rollback snapshot because affected files are too large.".to_string(),
            );
        }
        total_size = total_size.saturating_add(metadata.len());
        if total_size > MAX_SNAPSHOT_TOTAL_SIZE {
            return Err(
                "Cannot create rollback snapshot because affected files are too large.".to_string(),
            );
        }
        let content = fs::read(&target)
            .map_err(|error| format!("failed to read snapshot file {path}: {error}"))?;
        let pre_content = String::from_utf8(content.clone())
            .map_err(|_| format!("Snapshot file is not UTF-8 text: {path}"))?;
        files.push(PatchFileSnapshot {
            relative_path: path.clone(),
            pre_content,
            pre_sha256: sha256(&content),
            post_sha256: None,
        });
    }
    let record = PatchRollbackRecord {
        id: uuid::Uuid::new_v4().to_string(),
        created_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_millis()
            .to_string(),
        workspace_root: root.to_string_lossy().into_owned(),
        patch_summary: PatchSummary {
            files: paths.to_vec(),
            additions,
            deletions,
        },
        files,
        status: PatchRollbackStatus::Invalidated,
    };
    write_snapshot(directory, &record)?;
    Ok(record)
}

fn finalize_snapshot_record(
    directory: &Path,
    root: &Path,
    record: &mut PatchRollbackRecord,
) -> Result<(), String> {
    for file in &mut record.files {
        let target = root.join(safe_relative_path(&file.relative_path)?);
        let content = fs::read(&target)
            .map_err(|error| format!("failed to finalize {}: {error}", file.relative_path))?;
        file.post_sha256 = Some(sha256(&content));
    }
    record.status = PatchRollbackStatus::Available;
    write_snapshot(directory, record)
}

fn validate_pre_apply_snapshot(root: &Path, record: &PatchRollbackRecord) -> Result<(), String> {
    for file in &record.files {
        let target = fs::canonicalize(root.join(safe_relative_path(&file.relative_path)?))
            .map_err(|_| format!("Patch target is missing: {}", file.relative_path))?;
        if !target.starts_with(root) || !target.is_file() {
            return Err(format!(
                "Patch target is outside the workspace: {}",
                file.relative_path
            ));
        }
        let content = fs::read(&target)
            .map_err(|error| format!("failed to read {}: {error}", file.relative_path))?;
        if sha256(&content) != file.pre_sha256 {
            return Err(format!(
                "Cannot apply because file changed after rollback snapshot creation: {}",
                file.relative_path
            ));
        }
    }
    Ok(())
}

fn validate_snapshot_root(record: &PatchRollbackRecord, root: &Path) -> Result<(), String> {
    let stored = fs::canonicalize(&record.workspace_root)
        .map_err(|_| "Snapshot workspace root is not accessible.".to_string())?;
    if stored != root {
        return Err("Snapshot does not belong to this workspace root.".to_string());
    }
    Ok(())
}

fn invalidate_record(directory: &Path, record: &mut PatchRollbackRecord) -> Result<(), String> {
    record.status = PatchRollbackStatus::Invalidated;
    write_snapshot(directory, record)
}

fn snapshot_path(directory: &Path, id: &str) -> Result<PathBuf, String> {
    if id.is_empty()
        || !id
            .bytes()
            .all(|value| value.is_ascii_alphanumeric() || value == b'-')
    {
        return Err("Invalid snapshot ID.".to_string());
    }
    Ok(directory.join(format!("{id}.json")))
}

fn load_snapshot(directory: &Path, id: &str) -> Result<PatchRollbackRecord, String> {
    load_snapshot_path(&snapshot_path(directory, id)?)
}

fn load_snapshot_path(path: &Path) -> Result<PatchRollbackRecord, String> {
    let data = fs::read(path).map_err(|error| format!("failed to read snapshot: {error}"))?;
    serde_json::from_slice(&data).map_err(|error| format!("malformed rollback snapshot: {error}"))
}

fn write_snapshot(directory: &Path, record: &PatchRollbackRecord) -> Result<(), String> {
    fs::create_dir_all(directory)
        .map_err(|error| format!("failed to create snapshot directory: {error}"))?;
    let path = snapshot_path(directory, &record.id)?;
    let temporary = directory.join(format!("{}.tmp", record.id));
    let data = serde_json::to_vec_pretty(record)
        .map_err(|error| format!("failed to serialize snapshot: {error}"))?;
    fs::write(&temporary, data).map_err(|error| format!("failed to write snapshot: {error}"))?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("failed to replace snapshot file: {error}"))?;
    }
    fs::rename(&temporary, &path)
        .map_err(|error| format!("failed to finalize snapshot file: {error}"))
}

fn sha256(content: &[u8]) -> String {
    format!("{:x}", Sha256::digest(content))
}

fn validate_patch(root_path: &str, raw_patch: &str) -> Result<Vec<String>, String> {
    if raw_patch.trim().is_empty() {
        return Err("Patch is empty.".to_string());
    }
    if raw_patch.contains('\0') {
        return Err("Patch contains a NUL byte.".to_string());
    }
    if raw_patch.contains("GIT binary patch")
        || raw_patch.contains("Binary files ")
        || raw_patch.contains("diff --cc ")
        || raw_patch.contains("diff --combined ")
        || raw_patch.lines().any(|line| line.starts_with("@@@ "))
    {
        return Err("Binary and combined patches are unsupported.".to_string());
    }
    if raw_patch.lines().any(|line| {
        line.starts_with("new file mode ")
            || line.starts_with("deleted file mode ")
            || line.starts_with("rename from ")
            || line.starts_with("rename to ")
    }) {
        return Err("New, deleted, and renamed file patches are unsupported.".to_string());
    }

    let root = canonical_root(root_path)?;
    let paths = patch_paths(raw_patch)?;
    if paths.is_empty() {
        return Err("Patch contains no files.".to_string());
    }
    for path in &paths {
        let relative = safe_relative_path(path)?;
        let target = fs::canonicalize(root.join(&relative))
            .map_err(|_| format!("Patch target does not exist: {path}"))?;
        if !target.starts_with(&root) || !target.is_file() {
            return Err(format!("Patch target is outside the workspace: {path}"));
        }
    }
    Ok(paths)
}

fn patch_paths(raw_patch: &str) -> Result<Vec<String>, String> {
    let mut old_path: Option<String> = None;
    let mut paths = Vec::new();
    let mut hunk_remaining: Option<(usize, usize)> = None;
    let mut hunk_count = 0;
    for line in raw_patch.lines() {
        if let Some((old_remaining, new_remaining)) = hunk_remaining.as_mut() {
            if line == "\\ No newline at end of file" {
                continue;
            }
            match line.as_bytes().first() {
                Some(b' ') => {
                    *old_remaining = old_remaining.saturating_sub(1);
                    *new_remaining = new_remaining.saturating_sub(1);
                }
                Some(b'-') => *old_remaining = old_remaining.saturating_sub(1),
                Some(b'+') => *new_remaining = new_remaining.saturating_sub(1),
                _ => return Err("Patch contains a malformed hunk.".to_string()),
            }
            if *old_remaining == 0 && *new_remaining == 0 {
                hunk_remaining = None;
            }
            continue;
        }
        if line.starts_with("diff --git ") {
            continue;
        }
        if line.starts_with("@@ ") {
            hunk_remaining = Some(parse_hunk_counts(line)?);
            hunk_count += 1;
            continue;
        }
        if line.starts_with("rename from ") || line.starts_with("rename to ") {
            return Err("Rename patches are unsupported.".to_string());
        }
        if let Some(value) = line.strip_prefix("--- ") {
            old_path = Some(clean_header_path(value)?);
        } else if let Some(value) = line.strip_prefix("+++ ") {
            let new_path = clean_header_path(value)?;
            let old_path = old_path
                .take()
                .ok_or_else(|| "Patch has a new path without an old path.".to_string())?;
            if old_path == "/dev/null" {
                return Err("New file patches are unsupported.".to_string());
            }
            if new_path == "/dev/null" {
                return Err("Deleted file patches are unsupported.".to_string());
            }
            if old_path != new_path {
                return Err("Rename patches are unsupported.".to_string());
            }
            paths.push(new_path);
        }
    }
    if hunk_remaining.is_some() {
        return Err("Patch contains an incomplete hunk.".to_string());
    }
    if hunk_count == 0 {
        return Err("Patch contains no hunks.".to_string());
    }
    Ok(paths)
}

fn parse_hunk_counts(header: &str) -> Result<(usize, usize), String> {
    let mut parts = header.split_whitespace();
    if parts.next() != Some("@@") {
        return Err("Patch contains a malformed hunk header.".to_string());
    }
    let old = parts
        .next()
        .and_then(|value| value.strip_prefix('-'))
        .ok_or_else(|| "Patch contains a malformed hunk header.".to_string())?;
    let new = parts
        .next()
        .and_then(|value| value.strip_prefix('+'))
        .ok_or_else(|| "Patch contains a malformed hunk header.".to_string())?;
    if parts.next() != Some("@@") {
        return Err("Patch contains a malformed hunk header.".to_string());
    }
    Ok((range_count(old)?, range_count(new)?))
}

fn range_count(value: &str) -> Result<usize, String> {
    let count = value.split_once(',').map(|(_, count)| count).unwrap_or("1");
    count
        .parse()
        .map_err(|_| "Patch contains an invalid hunk range.".to_string())
}

fn clean_header_path(value: &str) -> Result<String, String> {
    let path = value
        .split_whitespace()
        .next()
        .ok_or_else(|| "Patch contains an empty path.".to_string())?;
    if path == "/dev/null" {
        return Ok(path.to_string());
    }
    Ok(path
        .strip_prefix("a/")
        .or_else(|| path.strip_prefix("b/"))
        .unwrap_or(path)
        .to_string())
}

fn safe_relative_path(path: &str) -> Result<PathBuf, String> {
    let normalized = path.replace('\\', "/");
    let candidate = Path::new(&normalized);
    if candidate.is_absolute()
        || path.starts_with('\\')
        || path.as_bytes().get(1) == Some(&b':')
        || normalized
            .split('/')
            .any(|segment| segment.is_empty() || segment == "." || segment == "..")
        || candidate.components().any(|component| {
            matches!(
                component,
                Component::ParentDir | Component::RootDir | Component::Prefix(_)
            )
        })
    {
        return Err(format!("Patch contains an unsafe path: {path}"));
    }
    Ok(PathBuf::from(normalized))
}

fn run_git_apply(root_path: &str, raw_patch: &str, check: bool) -> Result<Output, String> {
    let mut command = Command::new("git");
    command
        .arg("apply")
        .arg("--whitespace=nowarn")
        .current_dir(root_path)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if check {
        command.arg("--check");
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("failed to run git apply: {error}"))?;
    child
        .stdin
        .take()
        .ok_or_else(|| "failed to open git apply stdin".to_string())?
        .write_all(raw_patch.as_bytes())
        .map_err(|error| format!("failed to send patch to git apply: {error}"))?;
    child
        .wait_with_output()
        .map_err(|error| format!("failed to wait for git apply: {error}"))
}

fn output_error(output: Output, fallback: &str) -> String {
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    if stderr.is_empty() {
        fallback.to_string()
    } else {
        stderr
    }
}

#[cfg(test)]
mod tests {
    use super::{
        create_snapshot_record, finalize_snapshot_record, load_snapshot, patch_check, patch_paths,
        rollback_snapshot_record, safe_relative_path, sha256, validate_patch,
        validate_pre_apply_snapshot, MAX_SNAPSHOT_FILE_SIZE, MAX_SNAPSHOT_TOTAL_SIZE,
    };
    use crate::patch::types::PatchRollbackStatus;
    use std::fs;
    use std::process::Command;

    fn temp_dir(label: &str) -> std::path::PathBuf {
        let path =
            std::env::temp_dir().join(format!("arc-workbench-{label}-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn rejects_empty_patch() {
        assert_eq!(validate_patch("/tmp", "").unwrap_err(), "Patch is empty.");
    }

    #[test]
    fn rejects_unsafe_paths() {
        assert!(safe_relative_path("/etc/passwd").is_err());
        assert!(safe_relative_path("../outside.txt").is_err());
        assert!(safe_relative_path("..\\outside.txt").is_err());
        assert!(safe_relative_path("C:\\outside.txt").is_err());
        assert!(safe_relative_path("src/main.rs").is_ok());
    }

    #[test]
    fn rejects_new_deleted_and_renamed_files() {
        assert!(patch_paths("--- /dev/null\n+++ b/new.txt\n").is_err());
        assert!(patch_paths("--- a/old.txt\n+++ /dev/null\n").is_err());
        assert!(patch_paths("--- a/old.txt\n+++ b/new.txt\n").is_err());
    }

    #[test]
    fn rejects_inaccessible_root_and_later_unsafe_file_path() {
        let patch = "--- safe.txt\n+++ safe.txt\n@@ -1 +1 @@\n-old\n+new\n";
        assert_eq!(
            validate_patch("/definitely/missing/arc-workbench", patch).unwrap_err(),
            "Workspace root is not accessible."
        );

        let root =
            std::env::temp_dir().join(format!("arc-workbench-paths-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("safe.txt"), "old\n").unwrap();
        let multiple = "--- safe.txt\n+++ safe.txt\n@@ -1 +1 @@\n-old\n+new\n--- ../outside.txt\n+++ ../outside.txt\n@@ -1 +1 @@\n-old\n+new\n";
        assert!(validate_patch(&root.to_string_lossy(), multiple)
            .unwrap_err()
            .contains("unsafe path"));
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn checks_without_writing_then_applies_and_finalizes_snapshot() {
        let root = temp_dir("patch");
        let snapshots = temp_dir("snapshots");
        Command::new("git")
            .arg("init")
            .current_dir(&root)
            .output()
            .unwrap();
        fs::write(root.join("sample.txt"), "old\n").unwrap();
        let patch = "--- a/sample.txt\n+++ b/sample.txt\n@@ -1 +1 @@\n-old\n+new\n".to_string();

        let checked = patch_check(root.to_string_lossy().into_owned(), patch.clone()).unwrap();
        assert!(checked.ok);
        assert_eq!(
            fs::read_to_string(root.join("sample.txt")).unwrap(),
            "old\n"
        );

        let paths = vec!["sample.txt".to_string()];
        let mut snapshot = create_snapshot_record(&snapshots, &root, &paths, 1, 1).unwrap();
        assert_eq!(snapshot.files[0].pre_content, "old\n");
        assert_eq!(snapshot.files[0].pre_sha256, sha256(b"old\n"));
        assert_eq!(snapshot.status, PatchRollbackStatus::Invalidated);

        let output = super::run_git_apply(&root.to_string_lossy(), &patch, false).unwrap();
        assert!(output.status.success());
        finalize_snapshot_record(&snapshots, &root, &mut snapshot).unwrap();
        assert_eq!(snapshot.status, PatchRollbackStatus::Available);
        assert_eq!(
            snapshot.files[0].post_sha256.as_deref(),
            Some(sha256(b"new\n").as_str())
        );
        assert_eq!(
            fs::read_to_string(root.join("sample.txt")).unwrap(),
            "new\n"
        );
        let rolled_back = rollback_snapshot_record(&snapshots, &root, &snapshot.id).unwrap();
        assert!(rolled_back.ok);
        assert_eq!(
            rolled_back.record.unwrap().status,
            PatchRollbackStatus::RolledBack
        );
        assert_eq!(
            fs::read_to_string(root.join("sample.txt")).unwrap(),
            "old\n"
        );
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(snapshots).unwrap();
    }

    #[test]
    fn rollback_rejects_hash_mismatch_and_missing_target() {
        let root = temp_dir("rollback-guards");
        let snapshots = temp_dir("rollback-guard-snapshots");
        fs::write(root.join("sample.txt"), "old\n").unwrap();
        let paths = vec!["sample.txt".to_string()];
        let mut snapshot = create_snapshot_record(&snapshots, &root, &paths, 1, 1).unwrap();
        fs::write(root.join("sample.txt"), "new\n").unwrap();
        finalize_snapshot_record(&snapshots, &root, &mut snapshot).unwrap();

        fs::write(root.join("sample.txt"), "changed later\n").unwrap();
        let mismatch = rollback_snapshot_record(&snapshots, &root, &snapshot.id).unwrap();
        assert!(!mismatch.ok);
        assert!(mismatch.message.contains("changed after patch apply"));

        fs::remove_file(root.join("sample.txt")).unwrap();
        let missing = rollback_snapshot_record(&snapshots, &root, &snapshot.id).unwrap_err();
        assert!(missing.contains("target is missing"));
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(snapshots).unwrap();
    }

    #[test]
    fn apply_rejects_files_changed_after_snapshot_creation() {
        let root = temp_dir("pre-apply-hash");
        let snapshots = temp_dir("pre-apply-hash-snapshots");
        fs::write(root.join("sample.txt"), "old\n").unwrap();
        let snapshot =
            create_snapshot_record(&snapshots, &root, &["sample.txt".to_string()], 1, 1).unwrap();
        fs::write(root.join("sample.txt"), "changed before apply\n").unwrap();
        let error = validate_pre_apply_snapshot(&root, &snapshot).unwrap_err();
        assert!(error.contains("changed after rollback snapshot creation"));
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(snapshots).unwrap();
    }

    #[test]
    fn rejects_wrong_root_missing_and_malformed_snapshot() {
        let root = temp_dir("snapshot-root");
        let other_root = temp_dir("snapshot-other-root");
        let snapshots = temp_dir("snapshot-files");
        fs::write(root.join("sample.txt"), "old\n").unwrap();
        let record =
            create_snapshot_record(&snapshots, &root, &["sample.txt".to_string()], 1, 1).unwrap();

        let wrong_root = rollback_snapshot_record(&snapshots, &other_root, &record.id).unwrap_err();
        assert!(wrong_root.contains("does not belong"));
        assert!(load_snapshot(&snapshots, "missing")
            .unwrap_err()
            .contains("read snapshot"));

        fs::write(snapshots.join("malformed.json"), b"{not-json").unwrap();
        assert!(load_snapshot(&snapshots, "malformed")
            .unwrap_err()
            .contains("malformed rollback snapshot"));
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(other_root).unwrap();
        fs::remove_dir_all(snapshots).unwrap();
    }

    #[test]
    fn enforces_snapshot_file_and_total_size_limits() {
        let root = temp_dir("snapshot-size");
        let snapshots = temp_dir("snapshot-size-files");
        let oversized = root.join("oversized.txt");
        let file = fs::File::create(&oversized).unwrap();
        file.set_len(MAX_SNAPSHOT_FILE_SIZE + 1).unwrap();
        let error = create_snapshot_record(&snapshots, &root, &["oversized.txt".to_string()], 0, 0)
            .unwrap_err();
        assert!(error.contains("affected files are too large"));

        let each_size = MAX_SNAPSHOT_TOTAL_SIZE / 5;
        let mut paths = Vec::new();
        for index in 0..6 {
            let name = format!("total-{index}.txt");
            let file = fs::File::create(root.join(&name)).unwrap();
            file.set_len(each_size).unwrap();
            paths.push(name);
        }
        let error = create_snapshot_record(&snapshots, &root, &paths, 0, 0).unwrap_err();
        assert!(error.contains("affected files are too large"));
        fs::remove_dir_all(root).unwrap();
        fs::remove_dir_all(snapshots).unwrap();
    }
}
