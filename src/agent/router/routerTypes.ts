export type WorkerRecommendation = "local" | "codex" | "manual";

export type TaskDifficulty = "easy" | "medium" | "hard";

export type TaskRisk = "low" | "medium" | "high";

export type CodexRouterDecision = {
  id: string;
  taskId: string;
  createdAt: string;
  updatedAt: string;
  recommendedWorker: WorkerRecommendation;
  difficulty: TaskDifficulty;
  risk: TaskRisk;
  needsRepoWideReasoning: boolean;
  needsMultiFileEdit: boolean;
  needsCommandLoop: boolean;
  needsLargeRefactor: boolean;
  needsExternalWorker: boolean;
  estimatedFilesTouched?: number;
  confidence: number;
  reasons: string[];
  suggestedNextStep: string;
  status: "suggested" | "dismissed" | "accepted_stub";
};

export type RoutingTaskInput = {
  userMessage?: string;
  assistantResponse?: string;
  hasWorkspaceRoot?: boolean;
  patchCount?: number;
  patchFileCount?: number;
  commandProposalCount?: number;
  commandFailureCount?: number;
  gitChangedFileCount?: number;
  selectedDiffSize?: number;
  workspaceFileCount?: number;
};
