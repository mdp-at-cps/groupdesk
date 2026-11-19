"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useState, useTransition } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ArrowDown, ArrowUp, CheckCircle2, CircleDashed, Filter, FolderKanban, ListTodo, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { createProject, deleteTaskFilter, moveTaskFilter, updateTaskFilter } from "@/lib/actions/tasks";
import { cn } from "@/lib/utils";

export type TaskSidebarProps = {
  myOpen: number;
  allOpen: number;
  unassignedOpen: number;
  filters: { id: string; name: string; open: number }[];
  projects: { id: string; title: string; open: number }[];
};

const FILTERS = [
  { href: "/tasks", label: "My Tasks", icon: CheckCircle2, count: "myOpen" },
  { href: "/tasks/all", label: "All Tasks", icon: ListTodo, count: "allOpen" },
  { href: "/tasks/unassigned", label: "Unassigned", icon: CircleDashed, count: "unassignedOpen" },
] as const;

/** The Task Manager's left sidebar: the task filters, then the projects I'm a member of. */
export function TaskSidebar({ projects, filters, className, ...counts }: TaskSidebarProps & { className?: string }) {
  const pathname = usePathname();
  return (
    <nav className={cn("flex w-56 shrink-0 flex-col gap-6 border-r border-[var(--border)] p-3 text-sm", className)}>
      <div className="flex flex-col gap-0.5">
        <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Tasks
        </p>
        {FILTERS.map((f) => {
          const Icon = f.icon;
          return (
            <Link
              key={f.href}
              href={f.href}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--accent)]",
                pathname === f.href && "bg-[var(--accent)] font-medium",
              )}
            >
              <Icon className="size-4 text-[var(--muted-foreground)]" />
              <span className="flex-1 truncate">{f.label}</span>
              <span className="tabular-nums text-xs text-[var(--muted-foreground)]">{counts[f.count]}</span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col gap-0.5">
        <p className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
          Filters
        </p>
        {filters.map((f, i) => (
          <SavedFilterLink
            key={f.id}
            filter={f}
            active={pathname === `/tasks/filters/${f.id}`}
            first={i === 0}
            last={i === filters.length - 1}
          />
        ))}
        {filters.length === 0 && (
          <p className="px-2 py-1 text-xs text-[var(--muted-foreground)]">
            Narrow a list with the filter bar, then &ldquo;Save as filter&rdquo; to keep it here.
          </p>
        )}
      </div>

      <div className="flex flex-col gap-0.5">
        <div className="flex items-center px-2 pb-1">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
            Projects
          </p>
          <NewProjectButton />
        </div>
        {projects.map((p) => {
          const href = `/tasks/projects/${p.id}`;
          return (
            <Link
              key={p.id}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--accent)]",
                pathname === href && "bg-[var(--accent)] font-medium",
              )}
            >
              <FolderKanban className="size-4 shrink-0 text-[var(--muted-foreground)]" />
              <span className="flex-1 truncate">{p.title}</span>
              <span className="tabular-nums text-xs text-[var(--muted-foreground)]">{p.open}</span>
            </Link>
          );
        })}
        {projects.length === 0 && (
          <p className="px-2 py-1 text-xs text-[var(--muted-foreground)]">
            No projects yet. Projects you create or are added to show here.
          </p>
        )}
      </div>
    </nav>
  );
}

function NewProjectButton() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await createProject({ title, description });
      if (r.error || !r.id) return setError(r.error ?? "Couldn't create it");
      setOpen(false);
      setTitle("");
      setDescription("");
      router.push(`/tasks/projects/${r.id}`);
    });
  }

  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setError(null);
      }}
    >
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label="New project"
          title="New project"
          className="ml-auto rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
        >
          <Plus className="size-3.5" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          side="right"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-80 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm shadow-lg"
        >
          <form onSubmit={submit} className="flex flex-col gap-2.5">
            <p className="font-medium">New project</p>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" autoFocus maxLength={300} />
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description (optional)"
              rows={3}
              className="min-h-0"
            />
            <p className="text-xs text-[var(--muted-foreground)]">
              You&apos;ll be its first member; add others from the project.
            </p>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={pending || !title.trim()}>
                Create project
              </Button>
              {error && <span className="text-xs text-[var(--destructive)]">{error}</span>}
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A saved filter in the sidebar, with a menu to rename, reorder or delete it. */
function SavedFilterLink({
  filter,
  active,
  first,
  last,
}: {
  filter: { id: string; name: string; open: number };
  active: boolean;
  first: boolean;
  last: boolean;
}) {
  const [, start] = useTransition();
  const router = useRouter();
  const item = "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left hover:bg-[var(--accent)] disabled:opacity-40";
  return (
    <div className="group flex items-center">
      <Link
        href={`/tasks/filters/${filter.id}`}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 hover:bg-[var(--accent)]",
          active && "bg-[var(--accent)] font-medium",
        )}
      >
        <Filter className="size-4 shrink-0 text-[var(--muted-foreground)]" />
        <span className="flex-1 truncate">{filter.name}</span>
        <span className="tabular-nums text-xs text-[var(--muted-foreground)] group-hover:hidden">{filter.open}</span>
      </Link>
      <Popover.Root>
        <Popover.Trigger asChild>
          <button
            type="button"
            aria-label={`Manage ${filter.name}`}
            className="ml-0.5 hidden rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] group-hover:block data-[state=open]:block"
          >
            <MoreHorizontal className="size-3.5" />
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content align="start" side="right" sideOffset={6} className="z-50 w-44 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 text-sm shadow-lg">
            <Popover.Close asChild>
              <button
                type="button"
                className={item}
                onClick={() => {
                  const name = window.prompt("Rename filter", filter.name);
                  if (name && name.trim() && name.trim() !== filter.name)
                    start(async () => void (await updateTaskFilter(filter.id, { name })));
                }}
              >
                <Pencil className="size-4 text-[var(--muted-foreground)]" />
                Rename
              </button>
            </Popover.Close>
            <button type="button" className={item} disabled={first} onClick={() => start(async () => void (await moveTaskFilter(filter.id, "up")))}>
              <ArrowUp className="size-4 text-[var(--muted-foreground)]" />
              Move up
            </button>
            <button type="button" className={item} disabled={last} onClick={() => start(async () => void (await moveTaskFilter(filter.id, "down")))}>
              <ArrowDown className="size-4 text-[var(--muted-foreground)]" />
              Move down
            </button>
            <Popover.Close asChild>
              <button
                type="button"
                className={cn(item, "text-[var(--destructive)]")}
                onClick={() => {
                  if (!window.confirm(`Delete the filter “${filter.name}”? Its tasks aren't affected.`)) return;
                  start(async () => {
                    await deleteTaskFilter(filter.id);
                    if (active) router.push("/tasks");
                  });
                }}
              >
                <Trash2 className="size-4" />
                Delete
              </button>
            </Popover.Close>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
