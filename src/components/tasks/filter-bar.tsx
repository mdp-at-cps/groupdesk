"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Bookmark, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveTaskFilter, updateTaskFilter } from "@/lib/actions/tasks";
import { criteriaQuery, DUE_OPTIONS, type TaskCriteria } from "@/lib/task-filters";
import { cn } from "@/lib/utils";

type Option = { id: string; name: string };

/**
 * Narrow a task list by assignee, project, due date, words and subtasks.
 * Changes go in the URL on top of the view's own preset; "Save as filter"
 * keeps the combination in the sidebar.
 */
export function FilterBar({
  criteria,
  preset,
  agents,
  projects,
  meId,
  saved,
}: {
  /** What the list is showing now. */
  criteria: TaskCriteria;
  /** The view's own criteria, before any changes in the URL. */
  preset: TaskCriteria;
  agents: Option[];
  projects: Option[];
  meId: string;
  /** Set on a saved filter's page. */
  saved?: { id: string; name: string };
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [q, setQ] = useState(criteria.q ?? "");
  const [message, setMessage] = useState<{ ok?: string; error?: string }>({});
  const [pending, start] = useTransition();
  const modified = criteriaQuery(criteria) !== criteriaQuery(preset);

  function set<K extends keyof TaskCriteria>(key: K, value: TaskCriteria[K] | undefined) {
    const next = new URLSearchParams(params.toString());
    const presetValue = preset[key];
    const v = key === "sub" ? (value ? "1" : undefined) : (value as string | undefined) || undefined;
    const pv = key === "sub" ? (presetValue ? "1" : undefined) : (presetValue as string | undefined);
    if (v === pv) next.delete(key);
    else if (v === undefined) next.set(key, key === "sub" ? "0" : "any");
    else next.set(key, v);
    setMessage({});
    const s = next.toString();
    router.push(s ? `${pathname}?${s}` : pathname, { scroll: false });
  }

  const resetHref = (() => {
    const next = new URLSearchParams();
    if (params.get("show")) next.set("show", params.get("show")!);
    const s = next.toString();
    return s ? `${pathname}?${s}` : pathname;
  })();

  const select = "h-8 rounded-md border border-[var(--input)] bg-[var(--background)] px-2 text-xs";

  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-[var(--border)] px-4 py-2 sm:px-6">
      <select
        aria-label="Assignee"
        value={criteria.assignee ?? ""}
        onChange={(e) => set("assignee", e.target.value)}
        className={cn(select, criteria.assignee && "border-[var(--ring)]")}
      >
        <option value="">Anyone</option>
        <option value="me">Assigned to me</option>
        <option value="none">Unassigned</option>
        <optgroup label="Assigned to">
          {agents
            .filter((a) => a.id !== meId)
            .map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
        </optgroup>
      </select>

      <select
        aria-label="Project"
        value={criteria.project ?? ""}
        onChange={(e) => set("project", e.target.value)}
        className={cn(select, criteria.project && "border-[var(--ring)]")}
      >
        <option value="">Any project</option>
        <option value="none">No project</option>
        {projects.length > 0 && (
          <optgroup label="Projects">
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>

      <select
        aria-label="Due date"
        value={criteria.due ?? ""}
        onChange={(e) => set("due", (e.target.value || undefined) as TaskCriteria["due"])}
        className={cn(select, criteria.due && "border-[var(--ring)]")}
      >
        <option value="">Any due date</option>
        {DUE_OPTIONS.map((d) => (
          <option key={d.value} value={d.value}>
            {d.label}
          </option>
        ))}
      </select>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          set("q", q.trim());
        }}
        className="relative"
      >
        <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-[var(--muted-foreground)]" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onBlur={() => q.trim() !== (criteria.q ?? "") && set("q", q.trim())}
          placeholder="Search tasks"
          aria-label="Search tasks"
          maxLength={100}
          className={cn(select, "w-40 pl-7", criteria.q && "border-[var(--ring)]")}
        />
      </form>

      <label className="flex items-center gap-1.5 text-xs">
        <input type="checkbox" checked={!!criteria.sub} onChange={(e) => set("sub", e.target.checked)} />
        Include subtasks
      </label>

      <span className="ml-auto flex items-center gap-2">
        {message.ok && <span className="text-xs text-[var(--muted-foreground)]">{message.ok}</span>}
        {message.error && <span className="text-xs text-[var(--destructive)]">{message.error}</span>}
        {modified && (
          <Link
            href={resetHref}
            scroll={false}
            className="flex items-center gap-1 text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:underline"
          >
            <X className="size-3" />
            Reset
          </Link>
        )}
        {saved && modified && (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const r = await updateTaskFilter(saved.id, { query: criteriaQuery(criteria) });
                setMessage(r);
                if (!r.error) router.push(resetHref, { scroll: false });
              })
            }
          >
            Update “{saved.name}”
          </Button>
        )}
        {(modified || !saved) && <SaveAs criteria={criteria} primary={!saved} />}
      </span>
    </div>
  );
}

function SaveAs({ criteria, primary }: { criteria: TaskCriteria; primary: boolean }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        setError(null);
      }}
    >
      <Popover.Trigger asChild>
        <Button type="button" size="sm" variant={primary ? "outline" : "ghost"}>
          <Bookmark className="size-3.5" />
          {primary ? "Save as filter" : "Save as new"}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={12}
          className="z-50 w-72 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-sm shadow-lg"
        >
          <form
            className="flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const r = await saveTaskFilter(name, criteriaQuery(criteria));
                if (r.error || !r.id) return setError(r.error ?? "Couldn't save it");
                setOpen(false);
                setName("");
                router.push(`/tasks/filters/${r.id}`);
              });
            }}
          >
            <p className="font-medium">Save filter</p>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name, e.g. Overdue network work" autoFocus maxLength={60} />
            <p className="text-xs text-[var(--muted-foreground)]">It appears under Filters in your sidebar. Only you see it.</p>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={pending || !name.trim()}>
                Save
              </Button>
              {error && <span className="text-xs text-[var(--destructive)]">{error}</span>}
            </div>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
