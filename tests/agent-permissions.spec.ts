import { expect, test } from "@playwright/test";

test("permission profiles and command policies use safe defaults", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const profiles = await import(
      "/src/agent/permissions/permissionProfiles.ts"
    );
    const permissions = await import(
      "/src/agent/permissions/evaluateCommandPermission.ts"
    );
    const risk = await import("/src/commands/classifyCommandRisk.ts");
    return {
      profiles: profiles.PERMISSION_PROFILES,
      dangerousAction: permissions.evaluateCommandPermission(
        risk.classifyCommandRisk("rm -rf build"),
        profiles.PERMISSION_PROFILES.balanced,
      ),
      dangerousAnalysis: risk.classifyCommandRisk("rm -rf build"),
      inspectAnalysis: risk.classifyCommandRisk("git status"),
      checkAnalysis: risk.classifyCommandRisk("cargo test"),
      modifyingAnalysis: risk.classifyCommandRisk("npm install"),
    };
  });

  expect(result.profiles.strict.readTools).toBe("ask");
  expect(result.profiles.balanced.readTools).toBe("auto_allow");
  expect(result.profiles.fast_inspect.inspectCommands).toBe("auto_allow");
  expect(result.profiles.expert.dangerousCommands).toBe("typed_confirm");
  expect(result.dangerousAction).toBe("typed_confirm");
  expect(result.dangerousAnalysis).toMatchObject({
    risk: "critical",
    category: "dangerous",
  });
  expect(result.dangerousAnalysis.detectedPatterns).toContain("rm -rf");
  expect(result.inspectAnalysis).toMatchObject({
    risk: "low",
    category: "inspect",
  });
  expect(result.checkAnalysis).toMatchObject({
    risk: "medium",
    category: "check",
  });
  expect(result.modifyingAnalysis).toMatchObject({
    risk: "high",
    category: "modifying",
  });
});

test("workspace wrappers escape paths and cwd mismatch detection is explicit", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const wrapper = await import("/src/commands/wrapCommandForTracking.ts");
    const cwd = await import("/src/commands/detectCwdMismatch.ts");
    return {
      posix: wrapper.wrapCommandForTracking(
        "run-1",
        "cat src/main.ts",
        "bash",
        "workspace_root",
        "/tmp/Elise's Project",
      ),
      powershell: wrapper.wrapCommandForTracking(
        "run-2",
        "Get-Content src/main.ts",
        "pwsh",
        "workspace_root",
        "C:\\Work\\Elise's Project",
      ),
      mismatch: cwd.detectCwdMismatch(
        "cat src/main.ts",
        "cat: src/main.ts: No such file or directory",
        "terminal_cwd",
      ),
      workspaceMismatch: cwd.detectCwdMismatch(
        "cat src/main.ts",
        "No such file or directory",
        "workspace_root",
      ),
    };
  });

  expect(result.posix).toContain("cd '/tmp/Elise'\\''s Project' && {");
  expect(result.powershell).toContain(
    "Push-Location 'C:\\Work\\Elise''s Project'",
  );
  expect(result.mismatch).toBe(true);
  expect(result.workspaceMismatch).toBe(false);
});

test("tool extraction, path safety, limits, redaction, and activity collapse work", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        async invoke(command: string, args?: Record<string, unknown>) {
          if (command === "read_workspace_text_file") {
            return `${String(
              args?.relativePath,
            )}\napi_key=secret-value\n${"x".repeat(60_000)}`;
          }
          if (command === "read_dir") {
            return [];
          }
          if (command === "terminal_create") {
            throw new Error("terminal disabled in browser test");
          }
          return undefined;
        },
        transformCallback() {
          return 1;
        },
        unregisterCallback() {},
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
    const extract = await import(
      "/src/agent/tools/extractToolRequests.ts"
    );
    const safety = await import("/src/agent/tools/toolSafety.ts");
    const runner = await import("/src/agent/tools/runReadOnlyTool.ts");
    const activities = await import(
      "/src/agent/activity/activityStore.ts"
    );
    const requests = extract.extractToolRequests(`\`\`\`tool_request
{"tool":"read_files","args":{"paths":["src/a.ts","src/b.ts"]}}
\`\`\``);
    let traversal = "";
    let outside = "";
    try {
      safety.resolveToolPath("/tmp/project", "../secret.txt");
    } catch (reason) {
      traversal = String(reason);
    }
    try {
      safety.resolveToolPath("/tmp/project", "/etc/passwd");
    } catch (reason) {
      outside = String(reason);
    }
    const toolResult = await runner.runReadOnlyTool(requests[0], {
      workspaceRoot: "/tmp/project",
      openEditors: [],
    });
    const completed = activities.addAgentActivity({
      taskId: "task-completed",
      kind: "tool_result",
      status: "completed",
      title: "Read files",
    });
    const failed = activities.addAgentActivity({
      taskId: "task-failed",
      kind: "command_result",
      status: "failed",
      title: "Command failed",
    });
    return {
      request: requests[0],
      traversal,
      outside,
      toolResult,
      completed,
      failed,
    };
  });

  expect(result.request.tool).toBe("read_files");
  expect(result.traversal).toContain("workspace root");
  expect(result.outside).toContain("workspace root");
  expect(result.toolResult.status).toBe("completed");
  expect(result.toolResult.output).toContain("[REDACTED]");
  expect(result.toolResult.output).not.toContain("secret-value");
  expect(result.toolResult.output.length).toBeLessThanOrEqual(120_100);
  expect(result.completed.collapsed).toBe(true);
  expect(result.failed.collapsed).toBe(false);
});

test("dangerous commands require typed RUN and default to workspace root", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "arc-workbench.workspace.v1",
      JSON.stringify({ rootPath: "/tmp/project" }),
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
      }),
    );
    let callbackId = 1;
    const callbacks = new Map<number, (...args: unknown[]) => void>();
    Object.assign(window, {
      __terminalWrites: [] as string[],
      __TAURI_INTERNALS__: {
        transformCallback(callback: (...args: unknown[]) => void) {
          const id = callbackId++;
          callbacks.set(id, callback);
          return id;
        },
        unregisterCallback(id: number) {
          callbacks.delete(id);
        },
        async invoke(command: string, args?: Record<string, unknown>) {
          if (command === "plugin:event|listen") {
            return callbackId++;
          }
          if (command === "plugin:event|unlisten") {
            return undefined;
          }
          if (command === "terminal_create") {
            return "permission-terminal";
          }
          if (command === "terminal_write") {
            (
              window as typeof window & { __terminalWrites: string[] }
            ).__terminalWrites.push(String(args?.data));
            return undefined;
          }
          if (
            command === "terminal_resize" ||
            command === "terminal_kill" ||
            command === "read_dir"
          ) {
            return command === "read_dir" ? [] : undefined;
          }
          if (command === "git_status") {
            return {
              isRepo: false,
              files: [],
            };
          }
          if (command === "agent_chat") {
            return {
              content: `Review this command:
\`\`\`bash
rm -rf build
\`\`\``,
            };
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
  await expect(agent.getByLabel("Agent permission profile")).toHaveValue(
    "balanced",
  );
  await agent.getByLabel("Agent message").fill("Show the dangerous command");
  await agent.getByRole("button", { name: "Send" }).click();

  const activity = agent.locator(".agent-activity").filter({
    hasText: "Command proposal",
  });
  await expect(activity).toContainText("critical");
  await expect(activity.getByRole("button", { name: "Advanced Run" })).toBeVisible();
  await activity.getByRole("button", { name: "Advanced Run" }).click();

  const dialog = page.getByRole("dialog", {
    name: "Dangerous command confirmation",
  });
  const run = dialog.getByRole("button", { name: "Run", exact: true });
  await expect(run).toBeDisabled();
  await dialog.getByLabel("Type RUN to confirm").fill("run");
  await expect(run).toBeDisabled();
  await dialog.getByLabel("Type RUN to confirm").fill("RUN");
  await expect(run).toBeEnabled();
  await run.click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __terminalWrites: string[] })
            .__terminalWrites,
      ),
    )
    .toHaveLength(1);
  const written = await page.evaluate(
    () =>
      (window as typeof window & { __terminalWrites: string[] })
        .__terminalWrites[0],
  );
  expect(written).toContain("cd '/tmp/project' && {");
  expect(written).toContain("rm -rf build");
});

test("long command proposals start as compact collapsed activities", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "arc-workbench.agent.settings.v1",
      JSON.stringify({
        endpoint: "http://127.0.0.1:8000/v1",
        model: "local-test",
        temperature: 0.2,
        maxTokens: 4096,
        streaming: false,
        showCodexRouterSuggestions: false,
      }),
    );
    Object.assign(window, {
      __TAURI_INTERNALS__: {
        transformCallback() {
          return 1;
        },
        unregisterCallback() {},
        async invoke(command: string) {
          if (command === "agent_chat") {
            return {
              content: `\`\`\`bash
printf '%s\\n' '${"long-command-argument ".repeat(15)}'
\`\`\``,
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
  await page.getByRole("button", { name: "Agent" }).click();
  const agent = page.locator(".agent-pane");
  await agent.getByLabel("Agent message").fill("Suggest the long command");
  await agent.getByRole("button", { name: "Send" }).click();
  const activity = agent.locator(".agent-activity").filter({
    hasText: "Command proposal",
  });
  await expect(activity.locator(".agent-activity__toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(activity.locator(".command-proposal")).toHaveCount(0);
  await activity.locator(".agent-activity__toggle").click();
  await expect(activity.locator(".command-proposal")).toBeVisible();
});

test("Balanced auto-runs read tools and result feedback stays in the task", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "arc-workbench.workspace.v1",
      JSON.stringify({ rootPath: "/tmp/project" }),
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
      }),
    );
    Object.assign(window, {
      __agentRequests: [] as unknown[],
      __TAURI_INTERNALS__: {
        transformCallback() {
          return 1;
        },
        unregisterCallback() {},
        async invoke(command: string, args?: Record<string, unknown>) {
          if (command === "read_dir") {
            return [];
          }
          if (command === "read_workspace_text_file") {
            return "export const value = 42;\\napi_key=tool-secret";
          }
          if (command === "git_status") {
            return { isRepo: false, files: [] };
          }
          if (command === "agent_chat") {
            const requests = (
              window as typeof window & { __agentRequests: unknown[] }
            ).__agentRequests;
            requests.push(args?.request);
            return requests.length === 1
              ? {
                  content: `I will inspect the file.
\`\`\`tool_request
{"tool":"read_file","args":{"path":"src/main.ts"}}
\`\`\``,
                }
              : { content: "The tool result confirms the exported value." };
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
  await agent.getByLabel("Agent message").fill("Inspect src/main.ts");
  await agent.getByRole("button", { name: "Send" }).click();

  const toolActivity = agent.locator(".agent-activity").filter({
    hasText: "Read tool completed",
  });
  await expect(toolActivity).toBeVisible();
  await expect(toolActivity).toContainText("Read 1 file");
  const taskId = await agent.locator(".agent-task").getAttribute("data-task-id");
  await expect(toolActivity).toHaveAttribute("data-task-id", taskId!);
  await toolActivity
    .getByRole("button", { name: "Send Result to Agent" })
    .click();
  await expect(agent.locator(".agent-message--assistant").last()).toContainText(
    "exported value",
  );
  await expect(agent.locator(".agent-task")).toHaveCount(1);

  const request = await page.evaluate(
    () =>
      (
        window as typeof window & {
          __agentRequests: Array<{
            messages: Array<{ content: string }>;
          }>;
        }
      ).__agentRequests[1],
  );
  const content = request.messages[request.messages.length - 1].content;
  expect(content).toContain("Tool result for read_file");
  expect(content).toContain("api_key=[REDACTED]");
  expect(content).not.toContain("tool-secret");
});
