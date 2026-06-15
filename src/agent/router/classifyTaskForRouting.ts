import type {
  CodexRouterDecision,
  RoutingTaskInput,
  TaskDifficulty,
  TaskRisk,
  WorkerRecommendation,
} from "./routerTypes";

const REPO_WIDE_PATTERNS = [
  /\b(?:whole repo|entire (?:repo|project)|repo[- ]wide|project[- ]wide)\b/i,
  /\b(?:refactor|restructure|architecture|rewrite|migrat(?:e|ion))\b/i,
  /\b(?:fix all|many files|test failures|build loop|integration)\b/i,
  /(?:프로젝트|레포)\s*전체/,
  /(?:전체|전부|싹).*(?:수정|변경|고쳐|테스트|에러)/,
  /(?:구조 변경|구조를? 변경|리팩터|리팩토링|갈아엎|마이그레이션)/,
  /(?:테스트|에러)\s*전부/,
];

const LARGE_REFACTOR_PATTERNS = [
  /\b(?:rewrite|large refactor|redesign architecture|restructure)\b/i,
  /(?:갈아엎|대규모|아키텍처.*(?:변경|재설계)|구조.*(?:변경|재설계))/,
];

const LOOP_PATTERNS = [
  /\b(?:fix (?:the )?tests?|test failures|build loop|test.fix|until .*pass)\b/i,
  /(?:테스트.*(?:고쳐|수정|통과)|빌드.*(?:고쳐|수정|통과)|에러.*전부)/,
];

const NEEDS_CONTEXT_PATTERNS = [
  /\b(?:need|requires?) (?:more )?(?:repository |repo )?context\b/i,
  /\b(?:need|requires?) repo[- ]wide reasoning\b/i,
  /(?:추가|더 많은).*(?:컨텍스트|문맥|정보).*(?:필요|요청)/,
];

const DESTRUCTIVE_PATTERNS = [
  /\brm\s+-rf\b/i,
  /\bgit\s+(?:reset\s+--hard|clean\s+-[a-z]*f)/i,
  /\b(?:drop|truncate)\s+(?:database|table)\b/i,
  /\b(?:delete|remove|wipe)\s+(?:everything|all files|the repo)\b/i,
  /(?:전부|전체|모든).*(?:삭제|지워|초기화)/,
];

const AMBIGUOUS_PATTERNS = [
  /^(?:fix|change|update|do it|고쳐|수정|변경|해줘|처리해)\s*[.!?]?$/i,
  /\b(?:something is wrong|make it better)\b/i,
  /(?:뭔가|알아서).*(?:고쳐|수정|처리)/,
];

const SMALL_TASK_PATTERNS = [
  /\b(?:single file|one file|small bug|small config|explain|simple fix)\b/i,
  /(?:한 파일|단일 파일|간단한|설명|작은 버그|설정 하나)/,
];

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function levelFromScore<T extends string>(
  score: number,
  mediumAt: number,
  highAt: number,
  levels: [T, T, T],
): T {
  if (score >= highAt) {
    return levels[2];
  }
  if (score >= mediumAt) {
    return levels[1];
  }
  return levels[0];
}

export function classifyTaskForRouting(
  taskId: string,
  input: RoutingTaskInput,
  existingId: string = crypto.randomUUID(),
): CodexRouterDecision {
  const text = `${input.userMessage ?? ""}\n${input.assistantResponse ?? ""}`.trim();
  const repoWide = matchesAny(text, REPO_WIDE_PATTERNS);
  const largeRefactor = matchesAny(text, LARGE_REFACTOR_PATTERNS);
  const commandLoop =
    matchesAny(text, LOOP_PATTERNS) || (input.commandFailureCount ?? 0) >= 2;
  const needsContext = matchesAny(text, NEEDS_CONTEXT_PATTERNS);
  const destructive = matchesAny(text, DESTRUCTIVE_PATTERNS);
  const ambiguous =
    !text || matchesAny(input.userMessage?.trim() ?? "", AMBIGUOUS_PATTERNS);
  const estimatedFilesTouched = Math.max(
    input.patchFileCount ?? 0,
    input.gitChangedFileCount ?? 0,
  );
  const multiFile =
    estimatedFilesTouched >= 4 ||
    (input.patchCount ?? 0) >= 3 ||
    repoWide;

  let difficultyScore = 0;
  let riskScore = 0;
  const reasons: string[] = [];

  if (repoWide) {
    difficultyScore += 4;
    riskScore += 2;
    reasons.push("The request appears to require repository-wide reasoning.");
  }
  if (largeRefactor) {
    difficultyScore += 3;
    riskScore += 2;
    reasons.push("The requested architecture or refactor has a broad change surface.");
  }
  if (multiFile) {
    difficultyScore += 2;
    riskScore += 1;
    reasons.push(
      estimatedFilesTouched > 0
        ? `The task may affect at least ${estimatedFilesTouched} files.`
        : "The task likely requires coordinated edits across multiple files.",
    );
  }
  if (commandLoop) {
    difficultyScore += 3;
    riskScore += 1;
    reasons.push("The task likely needs an iterative build, test, and fix loop.");
  }
  if ((input.commandFailureCount ?? 0) > 0) {
    difficultyScore += Math.min(3, input.commandFailureCount ?? 0);
    riskScore += Math.min(2, input.commandFailureCount ?? 0);
    reasons.push(
      `${input.commandFailureCount} tracked command failure(s) need investigation.`,
    );
  }
  if ((input.selectedDiffSize ?? 0) > 20_000) {
    difficultyScore += 2;
    riskScore += 1;
    reasons.push("The selected diff is large.");
  }
  if ((input.workspaceFileCount ?? 0) > 250) {
    difficultyScore += 1;
    reasons.push("The workspace is large enough to benefit from broader inspection.");
  }
  if (needsContext) {
    difficultyScore += 2;
    reasons.push("The local Agent indicated that broader repository context is needed.");
  }
  if (destructive) {
    riskScore += 5;
    reasons.push("The request contains potentially destructive operations.");
  }
  if (ambiguous) {
    riskScore += 3;
    reasons.push("The requested outcome is ambiguous and needs manual clarification.");
  }
  if (input.hasWorkspaceRoot === false && (repoWide || multiFile)) {
    riskScore += 2;
    reasons.push("No workspace root is available for a repository-level request.");
  }
  if (
    matchesAny(text, SMALL_TASK_PATTERNS) &&
    !repoWide &&
    !largeRefactor &&
    !commandLoop
  ) {
    difficultyScore = Math.max(0, difficultyScore - 2);
  }

  let recommendedWorker: WorkerRecommendation = "local";
  if (destructive || ambiguous) {
    recommendedWorker = "manual";
  } else if (difficultyScore >= 4 || (multiFile && riskScore >= 2)) {
    recommendedWorker = "codex";
  }

  const difficulty = levelFromScore<TaskDifficulty>(
    difficultyScore,
    2,
    5,
    ["easy", "medium", "hard"],
  );
  const risk = levelFromScore<TaskRisk>(
    riskScore,
    2,
    5,
    ["low", "medium", "high"],
  );
  const confidence = Math.min(
    0.98,
    Math.max(
      0.55,
      0.58 +
        Math.min(0.24, reasons.length * 0.05) +
        (repoWide || destructive ? 0.1 : 0),
    ),
  );
  const now = new Date().toISOString();

  return {
    id: existingId,
    taskId,
    createdAt: now,
    updatedAt: now,
    recommendedWorker,
    difficulty,
    risk,
    needsRepoWideReasoning: repoWide || needsContext,
    needsMultiFileEdit: multiFile,
    needsCommandLoop: commandLoop,
    needsLargeRefactor: largeRefactor,
    needsExternalWorker: recommendedWorker === "codex",
    estimatedFilesTouched:
      estimatedFilesTouched > 0 ? estimatedFilesTouched : undefined,
    confidence,
    reasons:
      reasons.length > 0
        ? reasons
        : ["The request appears bounded enough for the local Agent workflow."],
    suggestedNextStep:
      recommendedWorker === "codex"
        ? "Review the handoff summary, then use Codex manually if broader repository work is needed."
        : recommendedWorker === "manual"
          ? "Clarify the scope and review risky operations before continuing."
          : "Continue with the local Agent patch and command approval workflow.",
    status: "suggested",
  };
}
