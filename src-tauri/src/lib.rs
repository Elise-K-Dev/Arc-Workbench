mod agent;
mod files;
mod git;
mod patch;
mod state;
mod terminal;

use agent::commands::{agent_cancel_stream, agent_chat, agent_chat_stream};
use files::commands::{
    read_dir, read_text_file, read_workspace_text_file, search_workspace, write_text_file,
};
use git::commands::{git_diff_file, git_repo_info, git_status};
use patch::commands::{
    patch_apply_with_snapshot, patch_check, patch_create_snapshot, patch_invalidate_snapshot,
    patch_list_snapshots, patch_rollback,
};
use state::AppState;
use terminal::commands::{terminal_create, terminal_kill, terminal_resize, terminal_write};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            terminal_create,
            terminal_write,
            terminal_resize,
            terminal_kill,
            read_text_file,
            read_workspace_text_file,
            search_workspace,
            write_text_file,
            read_dir,
            git_repo_info,
            git_status,
            git_diff_file,
            agent_chat,
            agent_chat_stream,
            agent_cancel_stream,
            patch_check,
            patch_create_snapshot,
            patch_apply_with_snapshot,
            patch_list_snapshots,
            patch_rollback,
            patch_invalidate_snapshot
        ])
        .run(tauri::generate_context!())
        .expect("error while running Arc Workbench");
}
