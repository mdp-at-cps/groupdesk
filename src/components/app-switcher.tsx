"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

/** Switch between the help desk and the Task Manager. */
export function AppSwitcher() {
  const pathname = usePathname();
  const onTasks = pathname === "/tasks" || pathname.startsWith("/tasks/");
  const item = (active: boolean) =>
    cn(
      "rounded px-2 py-0.5 text-xs",
      active
        ? "bg-[var(--card)] font-medium text-[var(--foreground)] shadow-sm"
        : "text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
    );
  return (
    <div className="flex items-center gap-0.5 rounded-md border border-[var(--border)] bg-[var(--muted)] p-0.5">
      <Link href="/tickets" className={item(!onTasks)} aria-current={!onTasks ? "page" : undefined}>
        Tickets
      </Link>
      <Link href="/tasks" className={item(onTasks)} aria-current={onTasks ? "page" : undefined}>
        Tasks
      </Link>
    </div>
  );
}
