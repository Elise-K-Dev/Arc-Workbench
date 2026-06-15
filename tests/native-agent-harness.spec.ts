import { expect, test } from "@playwright/test";

test("tool loop, workspace trust, and palette policies are bounded", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const loop = await import("/src/agent/tools/toolLoop.ts");
    const trust = await import("/src/workspace/workspaceTrust.ts");
    const profiles = await import(
      "/src/agent/permissions/permissionProfiles.ts"
    );
    const palette = await import("/src/commands/paletteCommands.ts");
    localStorage.clear();
    const unknown = trust.workspaceTrustLevel("/tmp/new-workspace");
    const untrusted = trust.applyWorkspaceTrust(
      profiles.PERMISSION_PROFILES.fast_inspect,
      "untrusted",
    );
    trust.setWorkspaceTrust("/tmp/new-workspace", "trusted");
    const trusted = trust.applyWorkspaceTrust(
      profiles.PERMISSION_PROFILES.fast_inspect,
      trust.workspaceTrustLevel("/tmp/new-workspace"),
    );
    const commands = [
      { id: "terminal", label: "New Terminal", run() {} },
      { id: "git", label: "Show Git", run() {} },
    ];
    return {
      defaultLoop: loop.DEFAULT_TOOL_LOOP_SETTINGS,
      allowsRead: loop.canContinueToolLoop(
        { enabled: true, maxTurns: 3 },
        2,
        "read_file",
      ),
      stopsAtLimit: loop.canContinueToolLoop(
        { enabled: true, maxTurns: 3 },
        3,
        "read_file",
      ),
      rejectsShell: loop.canContinueToolLoop(
        { enabled: true, maxTurns: 3 },
        0,
        "run_shell",
      ),
      unknown,
      untrusted,
      trusted,
      filtered: palette
        .filterPaletteCommands(commands, "term")
        .map((command) => command.id),
    };
  });

  expect(result.defaultLoop).toEqual({ enabled: false, maxTurns: 3 });
  expect(result.allowsRead).toBe(true);
  expect(result.stopsAtLimit).toBe(false);
  expect(result.rejectsShell).toBe(false);
  expect(result.unknown).toBe("untrusted");
  expect(result.untrusted).toMatchObject({
    readTools: "ask",
    inspectCommands: "ask",
    checkCommands: "ask",
    modifyingCommands: "strong_confirm",
    dangerousCommands: "typed_confirm",
  });
  expect(result.trusted.inspectCommands).toBe("auto_allow");
  expect(result.filtered).toEqual(["terminal"]);
});

test("command palette opens with Ctrl+K and creates a terminal", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        transformCallback() {
          return 1;
        },
        unregisterCallback() {},
        async invoke(command: string) {
          if (command === "terminal_create") {
            throw new Error("terminal disabled in browser test");
          }
          return undefined;
        },
        convertFileSrc(path: string) {
          return path;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener() {},
      },
    });
  });
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Commands" })).toBeVisible();
  await page.locator(".top-bar").click();
  await page.keyboard.press("Control+K");
  const palette = page.getByRole("dialog", { name: "Command Palette" });
  await expect(palette).toBeVisible();
  await palette.getByLabel("Search commands").fill("terminal");
  await expect(palette.getByRole("option")).toHaveCount(1);
  await palette.getByRole("option").click();
  await expect(page.locator(".floating-pane")).toHaveCount(2);
});

test("new workspace trust prompt updates the trust pill", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "arc-workbench.workspace.v1",
      JSON.stringify({ rootPath: "/tmp/new-workspace" }),
    );
  });
  await page.goto("/");
  await expect(page.getByText("Trust this workspace?")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Workspace: Untrusted" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Trust Workspace" }).click();
  await expect(page.getByText("Trust this workspace?")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Workspace: Trusted" }),
  ).toBeVisible();
});

test("workspace search tool returns structured backend results", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        transformCallback() {
          return 1;
        },
        unregisterCallback() {},
        async invoke(command: string) {
          if (command === "search_workspace") {
            return {
              query: "needle",
              matches: [
                {
                  path: "src/main.ts",
                  line: 4,
                  column: 2,
                  text: " needle",
                  before: [],
                  after: [],
                },
              ],
              truncated: false,
              backend: "ripgrep",
            };
          }
          if (command === "terminal_create") {
            throw new Error("terminal disabled in browser test");
          }
          return undefined;
        },
        convertFileSrc(path: string) {
          return path;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener() {},
      },
    });
  });
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const runner = await import("/src/agent/tools/runReadOnlyTool.ts");
    return runner.runReadOnlyTool(
      {
        id: "search-request",
        tool: "search_workspace",
        args: { query: "needle", contextLines: 2 },
        raw: "{}",
      },
      { workspaceRoot: "/tmp/project", openEditors: [] },
    );
  });
  expect(result).toMatchObject({
    status: "completed",
    resultCount: 1,
    truncated: false,
    backend: "ripgrep",
  });
  expect(JSON.parse(result.output).matches[0].path).toBe("src/main.ts");
});

test("terminal cwd markers update runtime state and command runs", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const runtime = await import("/src/terminal/terminalRuntime.ts");
    runtime.registerTerminalSession("cwd-pane", "cwd-session");
    const run = runtime.recordTerminalCommandRun({
      paneId: "cwd-pane",
      command: "pwd",
      risk: "low",
      runLocation: "terminal_cwd",
    });
    runtime.appendTerminalOutput(
      "cwd-pane",
      `\n__ARC_CWD_BEFORE:${run.id}:/tmp/before__\n__ARC_CMD_START:${run.id}__\n/tmp/before\n__ARC_CMD_END:${run.id}:0__\n`,
    );
    runtime.appendTerminalOutput(
      "cwd-pane",
      `__ARC_CWD_AFTER:${run.id}:/tmp/after__\n`,
    );
    return {
      cwd: runtime.getTerminalRuntime("cwd-pane")?.cwd,
      run: runtime.getTerminalCommandRun(run.id),
    };
  });
  expect(result.cwd).toBe("/tmp/after");
  expect(result.run).toMatchObject({
    cwdBefore: "/tmp/before",
    cwdAfter: "/tmp/after",
    exitCode: 0,
    completionStatus: "completed",
  });
});

test("enabled read-only tool loop auto-sends within the same task", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "arc-workbench.workspace.v1",
      JSON.stringify({ rootPath: "/tmp/project" }),
    );
    localStorage.setItem(
      "arc-workbench.workspace.trust.v1",
      JSON.stringify({
        "/tmp/project": {
          workspaceRoot: "/tmp/project",
          trustLevel: "trusted",
          updatedAt: "2026-06-15T00:00:00.000Z",
        },
      }),
    );
    localStorage.setItem(
      "arc-workbench.agent.settings.v1",
      JSON.stringify({
        endpoint: "http://127.0.0.1:8000/v1",
        model: "local-test",
        temperature: 0.2,
        maxTokens: 4096,
        streaming: false,
        showCodexRouterSuggestions: false,
        toolLoop: { enabled: true, maxTurns: 1 },
      }),
    );
    Object.assign(window, {
      __requests: 0,
      __TAURI_INTERNALS__: {
        transformCallback() {
          return 1;
        },
        unregisterCallback() {},
        async invoke(command: string) {
          if (command === "agent_chat") {
            const count = ++(
              window as typeof window & { __requests: number }
            ).__requests;
            return count === 1
              ? {
                  content: `\`\`\`tool_request
{"tool":"read_file","args":{"path":"src/main.ts"}}
\`\`\``,
                }
              : { content: "Automatic tool result received." };
          }
          if (command === "read_workspace_text_file") {
            return "export const value = 42;";
          }
          if (command === "read_dir") {
            return [];
          }
          if (command === "git_status") {
            return { isRepo: false, files: [] };
          }
          if (command === "terminal_create") {
            throw new Error("terminal disabled in browser test");
          }
          return undefined;
        },
        convertFileSrc(path: string) {
          return path;
        },
      },
      __TAURI_EVENT_PLUGIN_INTERNALS__: {
        unregisterListener() {},
      },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Agent" }).click();
  const agent = page.locator(".agent-pane");
  await expect(agent.getByLabel("Read-only tool loop")).toBeChecked();
  await agent.getByLabel("Agent message").fill("Inspect the file");
  await agent.getByRole("button", { name: "Send" }).click();
  await expect(agent.locator(".agent-message--assistant").last()).toContainText(
    "Automatic tool result received.",
  );
  await expect(agent.locator(".agent-task")).toHaveCount(1);
  await expect(
    agent.locator(".agent-activity").filter({ hasText: "auto-sent" }),
  ).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as typeof window & { __requests: number }).__requests,
      ),
    )
    .toBe(2);
});
