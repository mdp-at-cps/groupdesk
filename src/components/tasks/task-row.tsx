"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useOptimistic, useTransition } from "react";
import { AlignLeft, CalendarDays, Check, ListTree } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { setTaskDone } from "@/lib/actions/tasks";
import { dueLabel } from "@/lib/task-dates";
import type { TaskRow as Row } from "@/lib/tasks";
import { cn } from "@/lib/utils";

/** The current page's URL with ?task= set (or removed, for null). */
export function useTaskHref() {
  const pathname = usePathname();
  const params = useSearchParams();
  return (taskId: string | null) => {
    const next = new URLSearchParams(params.toString());
    if (taskId) next.set("task", taskId);
    else next.delete("task");
    const q = next.toString();
    return q ? `${pathname}?${q}` : pathname;
  };
}

export function DoneBox({ id, done, size = "md" }: { id: string; done: boolean; size?: "sm" | "md" }) {
  const [optimistic, setOptimistic] = useOptimistic(done);
  const [, start] = useTransition();
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={optimistic}
      aria-label={optimistic ? "Mark not done" : "Mark done"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        start(async () => {
          setOptimistic(!optimistic);
          await setTaskDone(id, !optimistic);
        });
      }}
      className={cn(
        "grid shrink-0 place-items-center rounded-full border transition-colors",
        size === "sm" ? "size-4" : "size-[18px]",
        optimistic
          ? "border-[oklch(0.6_0.13_155)] bg-[oklch(0.6_0.13_155)] text-white"
          : "border-[var(--muted-foreground)]/60 text-transparent hover:border-[oklch(0.6_0.13_155)] hover:text-[oklch(0.6_0.13_155)]",
      )}
    >
      <Check className={size === "sm" ? "size-2.5" : "size-3"} strokeWidth={3} />
    </button>
  );
}

export function DuePill({ date, done }: { date: string; done?: boolean }) {
  const { label, tone } = dueLabel(date);
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1 text-xs tabular-nums",
        done
          ? "text-[var(--muted-foreground)]"
          : tone === "overdue"
            ? "font-medium text-[var(--destructive)]"
            : tone === "soon"
              ? "font-medium text-[oklch(0.62_0.15_60)]"
              : "text-[var(--muted-foreground)]",
      )}
      title={date}
    >
      <CalendarDays className="size-3" />
      {label}
    </span>
  );
}

/** One task in a list: done box, title, and its project, subtasks, due date and assignee. */
export function TaskRow({
  task,
  showProject = false,
  selected = false,
}: {
  task: Row;
  showProject?: boolean;
  selected?: boolean;
}) {
  const href = useTaskHref();
  const done = !!task.completedAt;
  return (
    <Link
      href={href(task.id)}
      scroll={false}
      className={cn(
        "group flex items-center gap-3 border-b border-[var(--border)] px-4 py-2 text-sm hover:bg-[var(--accent)]/60 sm:px-6",
        selected && "bg-[var(--accent)]",
      )}
    >
      <DoneBox id={task.id} done={done} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn("truncate", done && "text-[var(--muted-foreground)] line-through")}>{task.title}</span>
        {(task.parentTitle || (showProject && task.projectTitle)) && (
          <span className="truncate text-xs text-[var(--muted-foreground)]">
            {task.parentTitle ? `Subtask of ${task.parentTitle}` : null}
            {task.parentTitle && showProject && task.projectTitle ? " · " : null}
            {showProject && task.projectTitle}
          </span>
        )}
      </span>
      {task.hasDescription && <AlignLeft className="size-3.5 shrink-0 text-[var(--muted-foreground)]" aria-label="Has a description" />}
      {task.subtasks.total > 0 && (
        <span className="inline-flex shrink-0 items-center gap-1 text-xs tabular-nums text-[var(--muted-foreground)]" title="Subtasks done">
          <ListTree className="size-3.5" />
          {task.subtasks.done}/{task.subtasks.total}
        </span>
      )}
      {task.dueDate && <DuePill date={task.dueDate} done={done} />}
      {task.assignee ? (
        <span title={task.assignee.name}>
          <Avatar name={task.assignee.name} email={task.assignee.email} size="xs" />
        </span>
      ) : (
        <span className="size-5 shrink-0 rounded-full border border-dashed border-[var(--border)]" title="Unassigned" />
      )}
    </Link>
  );
}
