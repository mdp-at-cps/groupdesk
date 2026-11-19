"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ChevronRight, Trash2, UserRound, X } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Picker } from "@/components/ui/picker";
import { Select, Textarea } from "@/components/ui/input";
import { deleteTask, setTaskDone, updateTask } from "@/lib/actions/tasks";
import type { taskDetail } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { DoneBox, DuePill, useTaskHref } from "./task-row";
import { QuickAdd } from "./quick-add";

type Detail = NonNullable<Awaited<ReturnType<typeof taskDetail>>>;
type Person = { id: string; name: string; email: string };

/**
 * The open task, beside the list: every field saves as soon as it changes
 * (text fields when you leave them). Rendered with key={task.id}, so moving
 * to another task starts fresh.
 */
export function TaskPanel({
  detail,
  agents,
  projects,
}: {
  detail: Detail;
  /** Everyone assignable outside a project (active agents). */
  agents: Person[];
  /** Projects I can move it to. */
  projects: { id: string; title: string }[];
}) {
  const { task, subtasks, parent, project, members, sections, createdBy } = detail;
  const href = useTaskHref();
  const router = useRouter();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [error, setError] = useState<string | null>(null);
  const [assigneeOpen, setAssigneeOpen] = useState(false);
  const [pending, start] = useTransition();
  const done = !!task.completedAt;

  const people = members ?? agents;
  const assignee = people.find((p) => p.id === task.assigneeId) ?? agents.find((p) => p.id === task.assigneeId) ?? null;

  function save(patch: Parameters<typeof updateTask>[1]) {
    start(async () => {
      const r = await updateTask(task.id, patch);
      setError(r.error ?? null);
    });
  }

  return (
    <aside className="flex h-full flex-col border-l border-[var(--border)] bg-[var(--card)]">
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--muted-foreground)]">
        <span className="flex min-w-0 flex-1 items-center gap-1">
          {project ? (
            <Link href={`/tasks/projects/${project.id}`} className="truncate hover:text-[var(--foreground)] hover:underline">
              {project.title}
            </Link>
          ) : (
            <span>No project</span>
          )}
          {parent && (
            <>
              <ChevronRight className="size-3 shrink-0" />
              <Link href={href(parent.id)} scroll={false} className="truncate hover:text-[var(--foreground)] hover:underline">
                {parent.title}
              </Link>
            </>
          )}
        </span>
        <button
          type="button"
          onClick={() => {
            if (!window.confirm(`Delete “${task.title}”${subtasks.length ? ` and its ${subtasks.length} subtask(s)` : ""}?`)) return;
            start(async () => {
              const r = await deleteTask(task.id);
              if (r.error) return setError(r.error);
              router.push(parent ? href(parent.id) : href(null), { scroll: false });
            });
          }}
          className="rounded p-1 hover:bg-[var(--accent)] hover:text-[var(--destructive)]"
          aria-label="Delete task"
          title="Delete task"
        >
          <Trash2 className="size-4" />
        </button>
        <Link href={href(null)} scroll={false} className="rounded p-1 hover:bg-[var(--accent)] hover:text-[var(--foreground)]" aria-label="Close" title="Close">
          <X className="size-4" />
        </Link>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        <div className="flex items-start gap-2.5">
          <span className="pt-1.5">
            <DoneBox id={task.id} done={done} />
          </span>
          <textarea
            value={title}
            onChange={(e) => setTitle(e.target.value.replace(/\n/g, ""))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                e.currentTarget.blur();
              }
            }}
            onBlur={() => {
              if (title.trim() && title.trim() !== task.title) save({ title });
              else setTitle(task.title);
            }}
            rows={1}
            maxLength={300}
            aria-label="Title"
            className={cn(
              "field-sizing-content min-w-0 flex-1 resize-none rounded-md bg-transparent px-1 py-0.5 text-lg font-semibold outline-none hover:bg-[var(--accent)]/50 focus:bg-[var(--accent)]/50",
              done && "text-[var(--muted-foreground)] line-through",
            )}
          />
        </div>

        <dl className="mt-4 grid grid-cols-[6.5rem_1fr] items-center gap-x-3 gap-y-2.5 text-sm">
          <dt className="text-xs text-[var(--muted-foreground)]">Assignee</dt>
          <dd>
            <Picker
              open={assigneeOpen}
              onOpenChange={setAssigneeOpen}
              placeholder={members ? "Assign to a project member…" : "Assign to…"}
              selected={task.assigneeId ? [task.assigneeId] : ["none"]}
              items={[
                { value: "none", label: "Unassigned", icon: <UserRound className="size-4 text-[var(--muted-foreground)]" /> },
                ...people.map((p) => ({
                  value: p.id,
                  label: p.name,
                  keywords: [p.email],
                  icon: <Avatar name={p.name} email={p.email} size="xs" />,
                })),
              ]}
              onSelect={(v) => save({ assigneeId: v === "none" ? null : v })}
              trigger={
                <button type="button" className="-ml-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-[var(--accent)]">
                  {assignee ? (
                    <>
                      <Avatar name={assignee.name} email={assignee.email} size="xs" />
                      {assignee.name}
                    </>
                  ) : (
                    <span className="text-[var(--muted-foreground)]">Unassigned</span>
                  )}
                </button>
              }
            />
          </dd>

          <dt className="text-xs text-[var(--muted-foreground)]">Due date</dt>
          <dd className="flex items-center gap-2">
            <input
              type="date"
              value={task.dueDate ?? ""}
              onChange={(e) => save({ dueDate: e.target.value || null })}
              className="h-8 rounded-md border border-[var(--input)] bg-transparent px-2 text-sm"
              aria-label="Due date"
            />
            {task.dueDate && <DuePill date={task.dueDate} done={done} />}
            {task.dueDate && (
              <button type="button" onClick={() => save({ dueDate: null })} className="text-xs text-[var(--muted-foreground)] hover:underline">
                Clear
              </button>
            )}
          </dd>

          <dt className="text-xs text-[var(--muted-foreground)]">Project</dt>
          <dd>
            {task.parentId ? (
              <span className="text-xs text-[var(--muted-foreground)]">Same as its parent task</span>
            ) : (
              <Select
                value={task.projectId ?? ""}
                onChange={(e) => save({ projectId: e.target.value || null })}
                className="h-8"
                aria-label="Project"
              >
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </Select>
            )}
          </dd>

          {task.projectId && !task.parentId && (
            <>
              <dt className="text-xs text-[var(--muted-foreground)]">Section</dt>
              <dd>
                <Select
                  value={task.sectionId ?? ""}
                  onChange={(e) => save({ sectionId: e.target.value || null })}
                  className="h-8"
                  aria-label="Section"
                >
                  <option value="">No section</option>
                  {sections.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.title}
                    </option>
                  ))}
                </Select>
              </dd>
            </>
          )}
        </dl>

        <div className="mt-5">
          <p className="mb-1.5 text-xs font-medium text-[var(--muted-foreground)]">Description</p>
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={() => description !== task.description && save({ description })}
            placeholder="Add details…"
            className="field-sizing-content min-h-24"
          />
        </div>

        {!task.parentId && (
          <div className="mt-5">
            <p className="mb-1 text-xs font-medium text-[var(--muted-foreground)]">
              Subtasks{subtasks.length ? ` · ${subtasks.filter((s) => s.completedAt).length}/${subtasks.length} done` : ""}
            </p>
            <div className="-mx-4 border-t border-[var(--border)]">
              {subtasks.map((s) => (
                <Link
                  key={s.id}
                  href={href(s.id)}
                  scroll={false}
                  className="flex items-center gap-2.5 border-b border-[var(--border)] px-4 py-1.5 text-sm hover:bg-[var(--accent)]/60"
                >
                  <DoneBox id={s.id} done={!!s.completedAt} size="sm" />
                  <span className={cn("min-w-0 flex-1 truncate", s.completedAt && "text-[var(--muted-foreground)] line-through")}>
                    {s.title}
                  </span>
                  {s.dueDate && <DuePill date={s.dueDate} done={!!s.completedAt} />}
                  {s.assignee && (
                    <span title={s.assignee.name}>
                      <Avatar name={s.assignee.name} email={s.assignee.email} size="xs" />
                    </span>
                  )}
                </Link>
              ))}
              <QuickAdd parentId={task.id} placeholder="Add a subtask…" className="px-4 sm:px-4" />
            </div>
          </div>
        )}

        <div className="mt-6 flex items-center gap-2">
          <button
            type="button"
            onClick={() => start(async () => void (await setTaskDone(task.id, !done)))}
            className={cn(
              "rounded-md border px-3 py-1.5 text-xs font-medium",
              done
                ? "border-[var(--border)] hover:bg-[var(--accent)]"
                : "border-[oklch(0.6_0.13_155)] text-[oklch(0.5_0.13_155)] hover:bg-[oklch(0.6_0.13_155)]/10",
            )}
          >
            {done ? "Reopen task" : "Mark complete"}
          </button>
          {pending && <span className="text-xs text-[var(--muted-foreground)]">Saving…</span>}
          {error && <span className="text-xs text-[var(--destructive)]">{error}</span>}
        </div>

        <p className="mt-4 text-xs text-[var(--muted-foreground)]">
          Created{createdBy ? ` by ${createdBy}` : ""} on{" "}
          {new Date(task.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          {done && task.completedAt
            ? ` · completed ${new Date(task.completedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
            : ""}
        </p>
      </div>
    </aside>
  );
}
