import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { listAgents } from "@/lib/queries";
import { savedTaskFilter, taskList, taskSidebar } from "@/lib/tasks";
import { applyOverrides, parseCriteria, PRESETS, type PresetKey } from "@/lib/task-filters";
import { daysUntil, todayISO } from "@/lib/task-dates";
import { cn } from "@/lib/utils";
import { TaskShell } from "./task-shell";
import { TaskRow } from "./task-row";
import { QuickAdd } from "./quick-add";
import { FilterBar } from "./filter-bar";
import { SavedFilterTitle } from "./saved-filter-title";

const VIEWS: Record<PresetKey, { href: string; title: string; blurb: string; empty: string }> = {
  mine: {
    href: "/tasks",
    title: "My Tasks",
    blurb: "Tasks and subtasks assigned to you, in every project.",
    empty: "Nothing assigned to you. Add a task above, or open a project.",
  },
  all: {
    href: "/tasks/all",
    title: "All Tasks",
    blurb: "Every task you can see: your projects' tasks, plus tasks outside a project that you created or were given.",
    empty: "No open tasks.",
  },
  unassigned: {
    href: "/tasks/unassigned",
    title: "Unassigned",
    blurb: "Tasks you can see that nobody has been assigned yet.",
    empty: "Every open task has someone assigned.",
  },
};

export type TaskListSearch = Promise<Record<string, string | string[] | undefined>>;

/**
 * A task list from the sidebar: one of the built-in views or a saved filter,
 * narrowed further by the filter bar, and grouped by when tasks are due.
 */
export async function TaskListPage({
  view,
  searchParams,
}: {
  view: { preset: PresetKey } | { filterId: string };
  searchParams: TaskListSearch;
}) {
  const { agent } = await requireAgent();
  const params = await searchParams;
  const task = typeof params.task === "string" ? params.task : null;
  const completed = params.show === "completed";

  const saved = "filterId" in view ? await savedTaskFilter(agent.id, view.filterId) : null;
  if ("filterId" in view && !saved) notFound();
  const preset = saved ? parseCriteria(saved.query) : PRESETS[(view as { preset: PresetKey }).preset];
  const info = saved
    ? { href: `/tasks/filters/${saved.id}`, title: saved.name, blurb: "Your saved filter. Only you see it.", empty: "No tasks match this filter." }
    : VIEWS[(view as { preset: PresetKey }).preset];
  const criteria = applyOverrides(preset, params);

  const [rows, agents, sidebar] = await Promise.all([
    taskList(agent.id, criteria, completed),
    listAgents(true),
    taskSidebar(agent.id),
  ]);

  const today = todayISO();
  const due = (r: (typeof rows)[number]) => (r.dueDate ? daysUntil(r.dueDate, today) : null);
  const groups = completed
    ? [{ key: "done", title: "Recently completed", rows }]
    : [
        { key: "overdue", title: "Overdue", rows: rows.filter((r) => (due(r) ?? 0) < 0) },
        { key: "today", title: "Today", rows: rows.filter((r) => due(r) === 0) },
        { key: "week", title: "Next 7 days", rows: rows.filter((r) => (due(r) ?? 0) > 0 && (due(r) ?? 0) <= 7) },
        { key: "later", title: "Later", rows: rows.filter((r) => (due(r) ?? 0) > 7) },
        { key: "none", title: "No due date", rows: rows.filter((r) => due(r) === null) },
      ];

  // Tabs keep the filter bar's changes.
  const tabHref = (show: boolean) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (typeof v === "string" && k !== "show" && k !== "task") next.set(k, v);
    if (show) next.set("show", "completed");
    const s = next.toString();
    return s ? `${info.href}?${s}` : info.href;
  };
  const tab = (active: boolean) =>
    cn(
      "-mb-px border-b-2 px-1 pb-2 text-sm",
      active
        ? "border-[var(--primary)] font-medium"
        : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
    );

  return (
    <TaskShell agentId={agent.id} taskId={task}>
      <div className="px-4 pt-5 sm:px-6">
        {/* A saved filter's title is keyed on its name too, so a rename from the sidebar shows here. */}
        {saved ? (
          <SavedFilterTitle key={`${saved.id}:${saved.name}`} id={saved.id} name={saved.name} />
        ) : (
          <h1 className="text-lg font-semibold">{info.title}</h1>
        )}
        <p className="text-xs text-[var(--muted-foreground)]">{info.blurb}</p>
        <div className="mt-3 flex gap-4 border-b border-[var(--border)]">
          <Link href={tabHref(false)} className={tab(!completed)}>
            Open
          </Link>
          <Link href={tabHref(true)} className={tab(completed)}>
            Completed
          </Link>
        </div>
      </div>

      <FilterBar
        key={`${info.href}?${new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string")).toString()}`}
        criteria={criteria}
        preset={preset}
        agents={agents.map((a) => ({ id: a.id, name: a.name }))}
        projects={sidebar.projects.map((p) => ({ id: p.id, name: p.title }))}
        meId={agent.id}
        saved={saved ? { id: saved.id, name: saved.name } : undefined}
      />

      {!completed && "preset" in view && view.preset === "mine" && (
        <QuickAdd
          assigneeId={agent.id}
          placeholder="Add a task for yourself…"
          className="border-b border-[var(--border)] py-2"
        />
      )}

      {groups
        .filter((g) => g.rows.length)
        .map((g) => (
          <section key={g.key} className="mt-4">
            <h2
              className={cn(
                "border-b border-[var(--border)] px-4 pb-1 text-xs font-semibold uppercase tracking-wide sm:px-6",
                g.key === "overdue" ? "text-[var(--destructive)]" : "text-[var(--muted-foreground)]",
              )}
            >
              {g.title} <span className="font-normal tabular-nums">· {g.rows.length}</span>
            </h2>
            {g.rows.map((r) => (
              <TaskRow key={r.id} task={r} showProject selected={r.id === task} />
            ))}
          </section>
        ))}

      {rows.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-[var(--muted-foreground)] sm:px-6">
          {completed ? "Nothing completed yet." : info.empty}
        </p>
      )}
    </TaskShell>
  );
}
