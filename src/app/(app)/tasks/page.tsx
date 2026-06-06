import { requireUser } from "@/lib/auth";
import { fetchTasks } from "./actions";
import { TasksView } from "@/components/tasks/tasks-view";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const { user } = await requireUser();
  const tasks = await fetchTasks(user.id);
  return <TasksView tasks={tasks} />;
}
