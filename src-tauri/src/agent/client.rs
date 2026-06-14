use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use std::time::Duration;

use futures_util::StreamExt;
use reqwest::Client;

use super::types::{
    AgentChatRequest, AgentChatResponse, OpenAiChatRequest, OpenAiChatResponse,
    OpenAiStreamResponse,
};

pub enum StreamOutcome {
    Done,
    Cancelled,
}

#[derive(Default)]
struct SseParser {
    buffer: Vec<u8>,
    done: bool,
}

impl SseParser {
    fn push(&mut self, chunk: &[u8]) -> Result<Vec<String>, String> {
        self.buffer.extend_from_slice(chunk);
        let mut deltas = Vec::new();
        while let Some(position) = self.buffer.iter().position(|byte| *byte == b'\n') {
            let mut line = self.buffer.drain(..=position).collect::<Vec<_>>();
            if line.last() == Some(&b'\n') {
                line.pop();
            }
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            self.parse_line(&line, &mut deltas)?;
            if self.done {
                self.buffer.clear();
                break;
            }
        }
        Ok(deltas)
    }

    fn finish(&mut self) -> Result<Vec<String>, String> {
        if self.buffer.is_empty() || self.done {
            return Ok(Vec::new());
        }
        let line = std::mem::take(&mut self.buffer);
        let mut deltas = Vec::new();
        self.parse_line(&line, &mut deltas)?;
        Ok(deltas)
    }

    fn parse_line(&mut self, line: &[u8], deltas: &mut Vec<String>) -> Result<(), String> {
        let line = std::str::from_utf8(line)
            .map_err(|error| format!("malformed SSE text: {error}"))?
            .trim();
        if line.is_empty() || line.starts_with(':') {
            return Ok(());
        }
        let Some(data) = line.strip_prefix("data:") else {
            return Ok(());
        };
        let data = data.trim_start();
        if data.is_empty() {
            return Ok(());
        }
        if data == "[DONE]" {
            self.done = true;
            return Ok(());
        }
        let response: OpenAiStreamResponse = serde_json::from_str(data)
            .map_err(|error| format!("malformed OpenAI SSE data: {error}"))?;
        if let Some(choice) = response.choices.into_iter().next() {
            if let Some(content) = choice
                .delta
                .content
                .or_else(|| choice.message.map(|message| message.content))
            {
                if !content.is_empty() {
                    deltas.push(content);
                }
            }
        }
        Ok(())
    }
}

pub async fn chat(request: AgentChatRequest) -> Result<AgentChatResponse, String> {
    let endpoint = validate_request(&request)?;

    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| format!("failed to create HTTP client: {error}"))?;
    let body = OpenAiChatRequest {
        model: request.model.trim(),
        messages: &request.messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: false,
    };
    let mut builder = client
        .post(format!("{endpoint}/chat/completions"))
        .json(&body);
    if let Some(api_key) = request.api_key.filter(|key| !key.trim().is_empty()) {
        builder = builder.bearer_auth(api_key.trim());
    }

    let response = builder
        .send()
        .await
        .map_err(|error| format!("failed to connect to local model: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("failed to read model response: {error}"))?;
    if !status.is_success() {
        return Err(format!("model server returned {status}: {}", text.trim()));
    }

    let parsed: OpenAiChatResponse = serde_json::from_str(&text)
        .map_err(|error| format!("invalid model response JSON: {error}"))?;
    let content = parsed
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content)
        .filter(|content| !content.trim().is_empty())
        .ok_or_else(|| "model response did not contain assistant content".to_string())?;
    Ok(AgentChatResponse { content })
}

pub async fn chat_stream<F>(
    request: AgentChatRequest,
    cancelled: Arc<AtomicBool>,
    mut on_delta: F,
) -> Result<StreamOutcome, String>
where
    F: FnMut(String) -> Result<(), String>,
{
    let endpoint = validate_request(&request)?;
    let client = Client::builder()
        .timeout(Duration::from_secs(300))
        .build()
        .map_err(|error| format!("failed to create streaming HTTP client: {error}"))?;
    let body = OpenAiChatRequest {
        model: request.model.trim(),
        messages: &request.messages,
        temperature: request.temperature,
        max_tokens: request.max_tokens,
        stream: true,
    };
    let mut builder = client
        .post(format!("{endpoint}/chat/completions"))
        .json(&body);
    if let Some(api_key) = request.api_key.filter(|key| !key.trim().is_empty()) {
        builder = builder.bearer_auth(api_key.trim());
    }
    let response = tokio::select! {
        response = builder.send() => {
            response.map_err(|error| format!("failed to connect to local model: {error}"))?
        }
        _ = wait_until_cancelled(Arc::clone(&cancelled)) => {
            return Ok(StreamOutcome::Cancelled);
        }
    };
    let status = response.status();
    if !status.is_success() {
        let text = response
            .text()
            .await
            .map_err(|error| format!("failed to read model error response: {error}"))?;
        return Err(format!("model server returned {status}: {}", text.trim()));
    }

    let mut parser = SseParser::default();
    let mut stream = response.bytes_stream();
    loop {
        let next = tokio::select! {
            next = stream.next() => next,
            _ = wait_until_cancelled(Arc::clone(&cancelled)) => {
                return Ok(StreamOutcome::Cancelled);
            }
        };
        let Some(chunk) = next else {
            break;
        };
        let chunk = chunk.map_err(|error| format!("failed to read model stream: {error}"))?;
        for delta in parser.push(&chunk)? {
            on_delta(delta)?;
        }
        if parser.done {
            return Ok(StreamOutcome::Done);
        }
    }
    for delta in parser.finish()? {
        on_delta(delta)?;
    }
    if cancelled.load(Ordering::Acquire) {
        Ok(StreamOutcome::Cancelled)
    } else if parser.done {
        Ok(StreamOutcome::Done)
    } else {
        Err("model stream ended before [DONE]".to_string())
    }
}

async fn wait_until_cancelled(cancelled: Arc<AtomicBool>) {
    while !cancelled.load(Ordering::Acquire) {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
}

fn validate_request(request: &AgentChatRequest) -> Result<&str, String> {
    let endpoint = request.endpoint.trim().trim_end_matches('/');
    if endpoint.is_empty() {
        return Err("Agent endpoint is required.".to_string());
    }
    if request.model.trim().is_empty() {
        return Err("Agent model is required.".to_string());
    }
    Ok(endpoint)
}

#[cfg(test)]
mod tests {
    use super::super::types::{AgentMessage, OpenAiChatRequest};
    use super::SseParser;

    #[test]
    fn serializes_openai_compatible_request() {
        let messages = vec![AgentMessage {
            role: "user".to_string(),
            content: "hello".to_string(),
        }];
        let request = OpenAiChatRequest {
            model: "local-model",
            messages: &messages,
            temperature: 0.2,
            max_tokens: 4096,
            stream: false,
        };
        let value = serde_json::to_value(request).unwrap();
        assert_eq!(value["model"], "local-model");
        assert_eq!(value["messages"][0]["role"], "user");
        assert_eq!(value["max_tokens"], 4096);
        assert_eq!(value["stream"], false);
    }

    #[test]
    fn parses_sse_deltas_across_network_boundaries() {
        let mut parser = SseParser::default();
        let first = parser
            .push(b"data: {\"choices\":[{\"delta\":{\"content\":\"hel")
            .unwrap();
        assert!(first.is_empty());
        let second = parser
            .push(b"lo\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\" world\"}}]}\n")
            .unwrap();
        assert_eq!(second, vec!["hello", " world"]);
    }

    #[test]
    fn handles_done_and_ignores_empty_lines() {
        let mut parser = SseParser::default();
        let deltas = parser
            .push(b"\n\r\n:data comment\ndata: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\ndata: [DONE]\n")
            .unwrap();
        assert_eq!(deltas, vec!["ok"]);
        assert!(parser.done);
    }

    #[test]
    fn handles_multiple_data_lines_and_message_fallback() {
        let mut parser = SseParser::default();
        let deltas = parser
            .push(
                b"data: {\"choices\":[{\"delta\":{\"content\":\"one\"}}]}\ndata: {\"choices\":[{\"delta\":{},\"message\":{\"role\":\"assistant\",\"content\":\"two\"}}]}\n",
            )
            .unwrap();
        assert_eq!(deltas, vec!["one", "two"]);
    }
}
