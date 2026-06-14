import { useSyncExternalStore } from "react";
import {
  getAgentTasksSnapshot,
  subscribeAgentTasks,
} from "./taskStore";

export function useAgentTasks() {
  return useSyncExternalStore(
    subscribeAgentTasks,
    getAgentTasksSnapshot,
    getAgentTasksSnapshot,
  );
}

