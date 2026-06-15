import { expect, test } from "@playwright/test";

test("router classifies local, Codex, Korean, manual, and failed tasks", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { classifyTaskForRouting } = await import(
      "/src/agent/router/classifyTaskForRouting.ts"
    );
    const local = classifyTaskForRouting("local", {
      userMessage: "Explain this single file function",
      hasWorkspaceRoot: true,
    });
    const codex = classifyTaskForRouting("codex", {
      userMessage: "Refactor the whole repo architecture and fix all tests",
      hasWorkspaceRoot: true,
    });
    const korean = classifyTaskForRouting("korean", {
      userMessage: "프로젝트 전체 구조 변경하고 전부 리팩토링해",
      hasWorkspaceRoot: true,
    });
    const manual = classifyTaskForRouting("manual", {
      userMessage: "rm -rf everything and fix it",
      hasWorkspaceRoot: true,
    });
    const beforeFailure = classifyTaskForRouting("failure-before", {
      userMessage: "Fix this integration",
      hasWorkspaceRoot: true,
    });
    const afterFailure = classifyTaskForRouting("failure-after", {
      userMessage: "Fix this integration",
      hasWorkspaceRoot: true,
      commandFailureCount: 2,
    });
    return {
      local,
      codex,
      korean,
      manual,
      beforeFailure,
      afterFailure,
    };
  });

  expect(result.local.recommendedWorker).toBe("local");
  expect(result.codex.recommendedWorker).toBe("codex");
  expect(result.korean.recommendedWorker).toBe("codex");
  expect(result.manual.recommendedWorker).toBe("manual");
  expect(["medium", "hard"]).toContain(result.afterFailure.difficulty);
  expect(["medium", "high"]).toContain(result.afterFailure.risk);
  expect(result.afterFailure.confidence).toBeGreaterThan(
    result.beforeFailure.confidence,
  );
});

test("router store keeps one decision per task and supports dismissal", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const tasks = await import("/src/agent/tasks/taskStore.ts");
    const router = await import("/src/agent/router/routerStore.ts");
    const task = tasks.createAgentTask("Refactor whole repo", "router-user");
    const first = router.evaluateTaskRouting(task.id, {
      userMessage: "Refactor the whole repo",
      hasWorkspaceRoot: true,
    });
    const second = router.evaluateTaskRouting(task.id, {
      assistantResponse: "This needs repo-wide reasoning.",
      patchCount: 2,
    });
    router.dismissRouterDecision(second.id);
    return {
      firstId: first.id,
      secondId: second.id,
      task: tasks.getAgentTask(task.id),
      decision: router.getTaskRouterDecision(task.id),
      decisions: router
        .getRouterDecisionsSnapshot()
        .filter((decision) => decision.taskId === task.id),
    };
  });

  expect(result.firstId).toBe(result.secondId);
  expect(result.task?.routerDecisionIds).toEqual([result.firstId]);
  expect(result.decisions).toHaveLength(1);
  expect(result.decision?.status).toBe("dismissed");
});

test("Codex handoff includes summaries and redacts secrets", async ({ page }) => {
  await page.goto("/");
  const prompt = await page.evaluate(async () => {
    const { buildCodexHandoffPrompt } = await import(
      "/src/agent/router/buildCodexHandoffPrompt.ts"
    );
    return buildCodexHandoffPrompt({
      taskTitle: "Repair build",
      userRequest: "Fix the repository. token=top-secret",
      workspaceRoot: "/tmp/project",
      gitStatusSummary: "M src/main.ts",
      recentCommandResults: [
        "Command: npm test\nStatus: failed\napi_key=hidden-value",
      ],
      localAgentConclusion: "The integration suite needs a multi-file fix.",
    });
  });

  expect(prompt).toContain("Task:\nRepair build");
  expect(prompt).toContain("Workspace:\n/tmp/project");
  expect(prompt).toContain("Git status:\nM src/main.ts");
  expect(prompt).toContain("Command: npm test");
  expect(prompt).toContain("Local Agent notes:");
  expect(prompt).toContain("[REDACTED]");
  expect(prompt).not.toContain("top-secret");
  expect(prompt).not.toContain("hidden-value");
});

test("repo-wide Agent task shows one dismissible Codex recommendation", async ({
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
        showCodexRouterSuggestions: true,
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
              content:
                "This needs repo-wide reasoning and coordinated integration changes.",
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
  await expect(
    agent.getByLabel("Show Codex Router Suggestions"),
  ).toBeChecked();
  await agent
    .getByLabel("Agent message")
    .fill("Refactor the whole repo architecture and fix all tests");
  await agent.getByRole("button", { name: "Send" }).click();

  const task = agent.locator(".agent-task");
  const routerCard = task.locator(".codex-router-card");
  await expect(routerCard).toHaveCount(1);
  await expect(routerCard).toContainText("Consider Codex");
  await expect(routerCard).toContainText(
    "This task may be better suited for Codex.",
  );
  await expect(
    routerCard.getByRole("button", { name: "Copy Handoff Prompt" }),
  ).toBeVisible();
  await expect(
    routerCard.getByRole("button", { name: "Prepare Codex Handoff" }),
  ).toBeDisabled();

  await routerCard.getByRole("button", { name: "Dismiss" }).click();
  await expect(task.locator(".codex-router-card")).toHaveCount(0);
});

test("simple Agent task stays local without a recommendation card", async ({
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
        showCodexRouterSuggestions: true,
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
            return { content: "This function returns the configured value." };
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
  await agent
    .getByLabel("Agent message")
    .fill("Explain this single file function");
  await agent.getByRole("button", { name: "Send" }).click();
  await expect(agent.locator(".agent-message--assistant")).toContainText(
    "configured value",
  );
  await expect(agent.locator(".codex-router-card")).toHaveCount(0);
});
