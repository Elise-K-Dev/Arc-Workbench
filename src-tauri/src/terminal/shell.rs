use std::env;
use std::path::Path;

pub fn resolve_shell(requested: Option<String>) -> Result<String, String> {
    if let Some(shell) = requested {
        if shell.trim().is_empty() {
            return Err("shell path cannot be empty".to_string());
        }
        return Ok(shell);
    }

    default_shell()
}

#[cfg(not(target_os = "windows"))]
fn default_shell() -> Result<String, String> {
    if let Ok(shell) = env::var("SHELL") {
        if Path::new(&shell).is_file() {
            return Ok(shell);
        }
    }

    for candidate in ["/bin/bash", "/bin/sh"] {
        if Path::new(candidate).is_file() {
            return Ok(candidate.to_string());
        }
    }

    Err("no supported shell was found".to_string())
}

#[cfg(target_os = "windows")]
fn default_shell() -> Result<String, String> {
    if let Ok(shell) = env::var("COMSPEC") {
        if !shell.trim().is_empty() {
            return Ok(shell);
        }
    }

    Ok("powershell.exe".to_string())
}
