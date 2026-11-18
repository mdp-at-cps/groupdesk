import { TaskListPage, type TaskListSearch } from "@/components/tasks/task-list-page";
import { APP_NAME } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: `Tasks · ${APP_NAME}` };

/** My Tasks: everything assigned to me. */
export default function MyTasksPage({ searchParams }: { searchParams: TaskListSearch }) {
  return <TaskListPage view={{ preset: "mine" }} searchParams={searchParams} />;
}
