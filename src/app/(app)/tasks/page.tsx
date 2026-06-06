import { requireUser } from "@/lib/auth";
import { fetchTasks, type TaskRow } from "./actions";
import { TasksView } from "@/components/tasks/tasks-view";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const { user } = await requireUser();
  // Fail soft if migration 0009 (directory_tasks) hasn't been applied yet.
  let tasks: TaskRow[] = [];
  try {
    tasks = await fetchTasks(user.id);
  } catch (err) {
    console.error("TasksPage fetch failed:", err instanceof Error ? err.message : err);
  }
  return <TasksView tasks={tasks} />;
}
