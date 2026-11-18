"use client";

import { usePathname } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { TaskSidebar, type TaskSidebarProps } from "@/components/tasks/task-sidebar";

export type AppSidebarProps = {
  tickets: React.ComponentProps<typeof Sidebar>;
  tasks: TaskSidebarProps;
};

/** The left sidebar for whichever app is open: the help desk or the Task Manager. */
export function AppSidebar({ tickets, tasks, className }: AppSidebarProps & { className?: string }) {
  const pathname = usePathname();
  return pathname === "/tasks" || pathname.startsWith("/tasks/") ? (
    <TaskSidebar {...tasks} className={className} />
  ) : (
    <Sidebar {...tickets} className={className} />
  );
}
