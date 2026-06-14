use std::fs;
use std::path::Path;

use serde::Serialize;

const MAX_TEXT_FILE_SIZE: u64 = 5 * 1024 * 1024;
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
    use super::read_dir;
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
}
