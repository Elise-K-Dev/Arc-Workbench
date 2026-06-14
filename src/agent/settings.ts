export type AgentSettings = {
  endpoint: string;
  model: string;
  temperature: number;
  maxTokens: number;
  streaming: boolean;
};

export const DEFAULT_AGENT_SETTINGS: AgentSettings = {
  endpoint: "http://127.0.0.1:8000/v1",
  model: "gemma4-26b-a4b",
  temperature: 0.2,
  maxTokens: 4096,
  streaming: true,
};

const STORAGE_KEY = "arc-workbench.agent.settings.v1";

export function loadAgentSettings(): AgentSettings {
  const serialized = localStorage.getItem(STORAGE_KEY);
  if (!serialized) {
    return DEFAULT_AGENT_SETTINGS;
  }
  try {
    const value = JSON.parse(serialized) as Partial<AgentSettings>;
    return {
      endpoint:
        typeof value.endpoint === "string"
          ? value.endpoint
          : DEFAULT_AGENT_SETTINGS.endpoint,
      model:
        typeof value.model === "string"
          ? value.model
          : DEFAULT_AGENT_SETTINGS.model,
      temperature:
        typeof value.temperature === "number"
          ? value.temperature
          : DEFAULT_AGENT_SETTINGS.temperature,
      maxTokens:
        typeof value.maxTokens === "number"
          ? value.maxTokens
          : DEFAULT_AGENT_SETTINGS.maxTokens,
      streaming:
        typeof value.streaming === "boolean"
          ? value.streaming
          : DEFAULT_AGENT_SETTINGS.streaming,
    };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return DEFAULT_AGENT_SETTINGS;
  }
}

export function saveAgentSettings(settings: AgentSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}
