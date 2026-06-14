import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type AgentMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type AgentChatRequest = {
  endpoint: string;
  apiKey?: string;
  model: string;
  messages: AgentMessage[];
  temperature: number;
  maxTokens: number;
};

export type AgentChatResponse = {
  content: string;
};

export type AgentStreamDelta = {
  streamId: string;
  delta: string;
};

export type AgentStreamDone = {
  streamId: string;
};

export type AgentStreamError = {
  streamId: string;
  message: string;
};

export type AgentStreamCancelled = {
  streamId: string;
};

export type AgentStreamListeners = {
  onDelta: (payload: AgentStreamDelta) => void;
  onDone: (payload: AgentStreamDone) => void;
  onError: (payload: AgentStreamError) => void;
  onCancelled: (payload: AgentStreamCancelled) => void;
};

export function agentChat(
  request: AgentChatRequest,
): Promise<AgentChatResponse> {
  return invoke<AgentChatResponse>("agent_chat", { request });
}

export async function agentChatStream(
  request: AgentChatRequest,
): Promise<{ streamId: string }> {
  return invoke("agent_chat_stream", { request });
}

export function cancelAgentStream(streamId: string): Promise<void> {
  return invoke("agent_cancel_stream", { streamId });
}

export async function listenToAgentStream(
  listeners: AgentStreamListeners,
): Promise<UnlistenFn> {
  const unlisteners = await Promise.all([
    listen<AgentStreamDelta>("agent_stream_delta", (event) =>
      listeners.onDelta(event.payload),
    ),
    listen<AgentStreamDone>("agent_stream_done", (event) =>
      listeners.onDone(event.payload),
    ),
    listen<AgentStreamError>("agent_stream_error", (event) =>
      listeners.onError(event.payload),
    ),
    listen<AgentStreamCancelled>("agent_stream_cancelled", (event) =>
      listeners.onCancelled(event.payload),
    ),
  ]);
  return () => {
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };
}
