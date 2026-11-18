import { TaskListPage, type TaskListSearch } from "@/components/tasks/task-list-page";
import { APP_NAME } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: `Tasks · ${APP_NAME}` };

/** One of my saved task filters. */
export default async function SavedFilterPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: TaskListSearch;
}) {
  const { id } = await params;
  return <TaskListPage view={{ filterId: id }} searchParams={searchParams} />;
}
