import { TaskListPage, type TaskListSearch } from "@/components/tasks/task-list-page";
import { APP_NAME } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: `Unassigned Tasks · ${APP_NAME}` };

export default function UnassignedTasksPage({ searchParams }: { searchParams: TaskListSearch }) {
  return <TaskListPage view={{ preset: "unassigned" }} searchParams={searchParams} />;
}
