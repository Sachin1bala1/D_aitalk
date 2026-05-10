import { useWorkspaceStore } from "../stores/WorkspaceStore";

export interface Task {
  id: string;
  userGoal: string;
  status: "planning" | "running" | "done" | "error";
}

let _activeTask: Task | null = null;

export const TaskEngine = {
  start(userGoal: string): Task {
    const task: Task = { id: `task-${Date.now()}`, userGoal, status: "planning" };
    _activeTask = task;
    useWorkspaceStore.getState().setCurrentTask({ userGoal, status: "planning" });
    return task;
  },

  update(status: Task["status"]) {
    if (!_activeTask) return;
    _activeTask.status = status;
    useWorkspaceStore.getState().setCurrentTask({ userGoal: _activeTask.userGoal, status });
  },

  complete() {
    _activeTask = null;
    useWorkspaceStore.getState().setCurrentTask(null);
  },

  get current() {
    return _activeTask;
  },
};
