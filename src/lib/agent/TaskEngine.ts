/**
 * TaskEngine — thin wrapper around AgentLoop that tracks task state
 * in WorkspaceStore. Future iterations will add sub-task decomposition,
 * verification, and retry logic here.
 */
import type { Task } from "./TaskState";
import { runAgentLoop } from "./AgentLoop";
import type { AgentLoopOptions } from "./AgentLoop";
import type { ConversationTurn } from "../ai/types";
import { useWorkspaceStore } from "../stores/WorkspaceStore";

export async function runTaskEngine(
  userMsg: string,
  history: ConversationTurn[],
  options: AgentLoopOptions
): Promise<{ finalText: string; updatedHistory: ConversationTurn[] }> {
  const task: Task = {
    id: Date.now().toString(),
    userGoal: userMsg,
    subtasks: [],
    currentIndex: 0,
    status: "running",
  };

  useWorkspaceStore.getState().setTask(task);

  try {
    const result = await runAgentLoop(userMsg, history, options);
    return result;
  } finally {
    useWorkspaceStore.getState().clearTask();
  }
}
