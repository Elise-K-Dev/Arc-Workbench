import { useEffect, useRef } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  createTerminal,
  killTerminal,
  onTerminalExit,
  onTerminalOutput,
  resizeTerminal,
  writeTerminal,
} from "../api/terminalApi";
import type { FloatingPaneState } from "../workspace/floatingPaneTypes";
import {
  appendTerminalOutput,
  registerTerminalSession,
  unregisterTerminal,
} from "../terminal/terminalRuntime";

type Props = {
  pane: FloatingPaneState;
};

export function TerminalPane({ pane }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: "'JetBrains Mono', 'Cascadia Code', monospace",
      fontSize: 13,
      theme: {
        background: "#111318",
        foreground: "#d7dae0",
        cursor: "#e6e6e6",
        selectionBackground: "#3c465b",
      },
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);

    let sessionId: string | undefined;
    let disposed = false;
    let unlistenOutput: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let resizeTimer: number | undefined;
    const pendingOutput: Array<{ sessionId: string; data: string }> = [];

    const sendSize = () => {
      if (!sessionId || terminal.cols < 1 || terminal.rows < 1) {
        return;
      }
      void resizeTerminal(sessionId, terminal.cols, terminal.rows);
    };

    const fit = () => {
      if (!container.isConnected) {
        return;
      }
      fitAddon.fit();
      sendSize();
    };

    const resizeObserver = new ResizeObserver(() => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(fit, 30);
    });
    resizeObserver.observe(container);

    const dataDisposable = terminal.onData((data) => {
      if (sessionId) {
        void writeTerminal(sessionId, data);
      }
    });

    void (async () => {
      try {
        const listeners = await Promise.all([
          onTerminalOutput((payload) => {
            if (!sessionId) {
              pendingOutput.push(payload);
            } else if (payload.sessionId === sessionId) {
              terminal.write(payload.data);
              appendTerminalOutput(pane.id, payload.data);
            }
          }),
          onTerminalExit((payload) => {
            if (payload.sessionId === sessionId) {
              terminal.write("\r\n[process exited]\r\n");
            }
          }),
        ]);
        unlistenOutput = listeners[0];
        unlistenExit = listeners[1];

        if (disposed) {
          unlistenOutput();
          unlistenExit();
          return;
        }

        const createdSessionId = await createTerminal();
        if (disposed) {
          await killTerminal(createdSessionId);
          return;
        }

        sessionId = createdSessionId;
        registerTerminalSession(pane.id, createdSessionId);
        for (const output of pendingOutput) {
          if (output.sessionId === sessionId) {
            terminal.write(output.data);
            appendTerminalOutput(pane.id, output.data);
          }
        }
        pendingOutput.length = 0;
        fit();
        terminal.focus();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        terminal.writeln(`\r\n[failed to create terminal: ${message}]`);
      }
    })();

    return () => {
      disposed = true;
      window.clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      dataDisposable.dispose();
      unlistenOutput?.();
      unlistenExit?.();
      terminal.dispose();
      unregisterTerminal(pane.id);
      if (sessionId) {
        void killTerminal(sessionId);
      }
    };
  }, [pane.id]);

  return <div className="terminal-pane" ref={containerRef} />;
}
