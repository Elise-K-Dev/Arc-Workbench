use tauri::{AppHandle, State};

use crate::state::AppState;

#[tauri::command]
pub fn terminal_create(
    app: AppHandle,
    state: State<'_, AppState>,
    cwd: Option<String>,
    shell: Option<String>,
) -> Result<String, String> {
    state.terminals.create(app, cwd, shell)
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    state.terminals.write(&session_id, &data)
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    state.terminals.resize(&session_id, cols, rows)
}

#[tauri::command]
pub fn terminal_kill(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    state.terminals.kill(&session_id)
}
