import { TaskListPage, type TaskListSearch } from "@/components/tasks/task-list-page";
import { APP_NAME } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: `All Tasks · ${APP_NAME}` };

export default function AllTasksPage({ searchParams }: { searchParams: TaskListSearch }) {
  return <TaskListPage view={{ preset: "all" }} searchParams={searchParams} />;
}
