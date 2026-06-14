import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type TerminalOutput = {
  sessionId: string;
  data: string;
};

export type TerminalExit = {
  sessionId: string;
};

export function createTerminal(cwd?: string, shell?: string): Promise<string> {
  return invoke<string>("terminal_create", { cwd, shell });
}

export function writeTerminal(sessionId: string, data: string): Promise<void> {
  return invoke("terminal_write", { sessionId, data });
}

export function resizeTerminal(
  sessionId: string,
  cols: number,
  rows: number,
): Promise<void> {
  return invoke("terminal_resize", { sessionId, cols, rows });
}

export function killTerminal(sessionId: string): Promise<void> {
  return invoke("terminal_kill", { sessionId });
}

export function onTerminalOutput(
  handler: (payload: TerminalOutput) => void,
): Promise<UnlistenFn> {
  return listen<TerminalOutput>("terminal_output", (event) =>
    handler(event.payload),
  );
}

export function onTerminalExit(
  handler: (payload: TerminalExit) => void,
): Promise<UnlistenFn> {
  return listen<TerminalExit>("terminal_exit", (event) =>
    handler(event.payload),
  );
}

