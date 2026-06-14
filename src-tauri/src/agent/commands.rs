use std::sync::atomic::Ordering;

use tauri::{Emitter, State};

use crate::state::AppState;

use super::client;
use super::client::StreamOutcome;
use super::types::{
    AgentChatRequest, AgentChatResponse, AgentChatStreamResponse, AgentStreamCancelled,
    AgentStreamDelta, AgentStreamDone, AgentStreamError,
};

#[tauri::command]
pub async fn agent_chat(request: AgentChatRequest) -> Result<AgentChatResponse, String> {
    client::chat(request).await
}

#[tauri::command]
pub async fn agent_chat_stream(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: AgentChatRequest,
) -> Result<AgentChatStreamResponse, String> {
    let stream_id = uuid::Uuid::new_v4().to_string();
    let cancelled = state.agent_streams.insert(stream_id.clone());
    let manager = state.agent_streams.clone();
    let task_stream_id = stream_id.clone();
    tauri::async_runtime::spawn(async move {
        let delta_app = app.clone();
        let delta_stream_id = task_stream_id.clone();
        let result = client::chat_stream(request, cancelled.clone(), move |delta| {
            delta_app
                .emit(
                    "agent_stream_delta",
                    AgentStreamDelta {
                        stream_id: delta_stream_id.clone(),
                        delta,
                    },
                )
                .map_err(|error| format!("failed to emit agent stream delta: {error}"))
        })
        .await;

        manager.remove(&task_stream_id);
        match result {
            Ok(StreamOutcome::Done) if !cancelled.load(Ordering::Acquire) => {
                let _ = app.emit(
                    "agent_stream_done",
                    AgentStreamDone {
                        stream_id: task_stream_id,
                    },
                );
            }
            Ok(StreamOutcome::Cancelled) => {}
            Ok(StreamOutcome::Done) => {}
            Err(message) if !cancelled.load(Ordering::Acquire) => {
                let _ = app.emit(
                    "agent_stream_error",
                    AgentStreamError {
                        stream_id: task_stream_id,
                        message,
                    },
                );
            }
            Err(_) => {}
        }
    });
    Ok(AgentChatStreamResponse { stream_id })
}

#[tauri::command]
pub fn agent_cancel_stream(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    stream_id: String,
) -> Result<(), String> {
    if !state.agent_streams.cancel(&stream_id) {
        return Err("Agent stream is no longer active.".to_string());
    }
    app.emit("agent_stream_cancelled", AgentStreamCancelled { stream_id })
        .map_err(|error| format!("failed to emit agent cancellation: {error}"))
}
