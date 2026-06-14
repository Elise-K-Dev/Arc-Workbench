use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentMessage {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChatRequest {
    pub endpoint: String,
    pub api_key: Option<String>,
    pub model: String,
    pub messages: Vec<AgentMessage>,
    pub temperature: f32,
    pub max_tokens: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChatResponse {
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChatStreamResponse {
    pub stream_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStreamDelta {
    pub stream_id: String,
    pub delta: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStreamDone {
    pub stream_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentStreamError {
    pub stream_id: String,
    pub message: String,
}

pub type AgentStreamCancelled = AgentStreamDone;

#[derive(Serialize)]
pub struct OpenAiChatRequest<'a> {
    pub model: &'a str,
    pub messages: &'a [AgentMessage],
    pub temperature: f32,
    pub max_tokens: u32,
    pub stream: bool,
}

#[derive(Deserialize)]
pub struct OpenAiChatResponse {
    pub choices: Vec<OpenAiChoice>,
}

#[derive(Deserialize)]
pub struct OpenAiChoice {
    pub message: AgentMessage,
}

#[derive(Deserialize)]
pub struct OpenAiStreamResponse {
    pub choices: Vec<OpenAiStreamChoice>,
}

#[derive(Deserialize)]
pub struct OpenAiStreamChoice {
    #[serde(default)]
    pub delta: OpenAiStreamContent,
    pub message: Option<AgentMessage>,
}

#[derive(Default, Deserialize)]
pub struct OpenAiStreamContent {
    pub content: Option<String>,
}
