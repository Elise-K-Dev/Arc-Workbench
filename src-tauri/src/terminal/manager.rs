use std::collections::HashMap;
use std::io::Write;
use std::sync::Mutex;
use std::thread;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

use super::shell::resolve_shell;

struct TerminalSession {
    child: Box<dyn Child + Send + Sync>,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
}

#[derive(Default)]
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    session_id: String,
    data: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalExit {
    session_id: String,
}

impl TerminalManager {
    pub fn create(
        &self,
        app: AppHandle,
        cwd: Option<String>,
        requested_shell: Option<String>,
    ) -> Result<String, String> {
        let shell = resolve_shell(requested_shell)?;
        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("failed to open PTY: {error}"))?;

        let mut command = CommandBuilder::new(shell);
        command.env("TERM", "xterm-256color");
        if let Some(cwd) = cwd {
            command.cwd(cwd);
        }

        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|error| format!("failed to spawn shell: {error}"))?;
        drop(pair.slave);

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|error| format!("failed to open PTY reader: {error}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|error| format!("failed to open PTY writer: {error}"))?;

        let session_id = Uuid::new_v4().to_string();
        self.sessions
            .lock()
            .map_err(|_| "terminal manager lock is poisoned".to_string())?
            .insert(
                session_id.clone(),
                TerminalSession {
                    child,
                    master: pair.master,
                    writer,
                },
            );

        spawn_output_reader(app, session_id.clone(), reader);
        Ok(session_id)
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| "terminal manager lock is poisoned".to_string())?;
        let session = sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("terminal session not found: {session_id}"))?;

        session
            .writer
            .write_all(data.as_bytes())
            .and_then(|_| session.writer.flush())
            .map_err(|error| format!("failed to write to terminal: {error}"))
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        if cols == 0 || rows == 0 {
            return Ok(());
        }

        let sessions = self
            .sessions
            .lock()
            .map_err(|_| "terminal manager lock is poisoned".to_string())?;
        let session = sessions
            .get(session_id)
            .ok_or_else(|| format!("terminal session not found: {session_id}"))?;

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| format!("failed to resize terminal: {error}"))
    }

    pub fn kill(&self, session_id: &str) -> Result<(), String> {
        let mut session = self
            .sessions
            .lock()
            .map_err(|_| "terminal manager lock is poisoned".to_string())?
            .remove(session_id)
            .ok_or_else(|| format!("terminal session not found: {session_id}"))?;

        session
            .child
            .kill()
            .map_err(|error| format!("failed to kill terminal: {error}"))
    }
}

fn spawn_output_reader(
    app: AppHandle,
    session_id: String,
    mut reader: Box<dyn std::io::Read + Send>,
) {
    thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(bytes_read) => {
                    let data = String::from_utf8_lossy(&buffer[..bytes_read]).into_owned();
                    let _ = app.emit(
                        "terminal_output",
                        TerminalOutput {
                            session_id: session_id.clone(),
                            data,
                        },
                    );
                }
            }
        }

        let _ = app.emit("terminal_exit", TerminalExit { session_id });
    });
}
