"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, MoreHorizontal, Trash2, UserPlus } from "lucide-react";
import * as Popover from "@radix-ui/react-popover";
import { Avatar } from "@/components/ui/avatar";
import { Picker } from "@/components/ui/picker";
import {
  createSection,
  deleteProject,
  deleteSection,
  moveSection,
  renameSection,
  setProjectMember,
  updateProject,
} from "@/lib/actions/tasks";
import type { TaskRow as Row } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { TaskRow } from "./task-row";
import { QuickAdd } from "./quick-add";

type Person = { id: string; name: string; email: string };

export function ProjectHeader({
  project,
  members,
  agents,
  meId,
}: {
  project: { id: string; title: string; description: string };
  members: Person[];
  agents: Person[];
  meId: string;
}) {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const router = useRouter();
  const memberIds = members.map((m) => m.id);

  function run(fn: () => Promise<{ error?: string }>) {
    start(async () => {
      const r = await fn();
      setError(r.error ?? null);
    });
  }

  return (
    <div className="border-b border-[var(--border)] px-4 pb-4 pt-5 sm:px-6">
      <div className="flex items-start gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={() => {
            if (title.trim() && title.trim() !== project.title) run(() => updateProject(project.id, { title }));
            else setTitle(project.title);
          }}
          aria-label="Project title"
          maxLength={300}
          className="-ml-1 min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-lg font-semibold outline-none hover:bg-[var(--accent)]/50 focus:bg-[var(--accent)]/50"
        />
        <div className="flex shrink-0 items-center gap-2 pt-1">
          <div className="flex -space-x-1.5">
            {members.slice(0, 6).map((m) => (
              <span key={m.id} title={m.name} className="rounded-full ring-2 ring-[var(--background)]">
                <Avatar name={m.name} email={m.email} size="sm" />
              </span>
            ))}
            {members.length > 6 && (
              <span className="grid size-6 place-items-center rounded-full bg-[var(--muted)] text-[10px] ring-2 ring-[var(--background)]">
                +{members.length - 6}
              </span>
            )}
          </div>
          <Picker
            open={pickerOpen}
            onOpenChange={setPickerOpen}
            multi
            align="end"
            placeholder="Add or remove members…"
            selected={memberIds}
            items={agents.map((a) => ({
              value: a.id,
              label: a.id === meId ? `${a.name} (you)` : a.name,
              keywords: [a.email],
              icon: <Avatar name={a.name} email={a.email} size="xs" />,
            }))}
            onSelect={(id) => {
              const removingMe = id === meId && memberIds.includes(id);
              if (removingMe && !window.confirm("Leave this project? You won't see it any more.")) return;
              run(async () => {
                const r = await setProjectMember(project.id, id, !memberIds.includes(id));
                if (removingMe && !r.error) router.push("/tasks");
                return r;
              });
            }}
            trigger={
              <button
                type="button"
                className="flex items-center gap-1.5 rounded-md border border-[var(--border)] px-2 py-1 text-xs hover:bg-[var(--accent)]"
              >
                <UserPlus className="size-3.5" />
                Members
              </button>
            }
          />
          <Popover.Root>
            <Popover.Trigger asChild>
              <button type="button" aria-label="Project options" className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)]">
                <MoreHorizontal className="size-4" />
              </button>
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Content align="end" sideOffset={6} className="z-50 w-48 rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 text-sm shadow-lg">
                <button
                  type="button"
                  onClick={() => {
                    if (!window.confirm(`Delete “${project.title}” and all of its tasks? This can't be undone.`)) return;
                    start(async () => {
                      const r = await deleteProject(project.id);
                      if (r.error) return setError(r.error);
                      router.push("/tasks");
                    });
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[var(--destructive)] hover:bg-[var(--accent)]"
                >
                  <Trash2 className="size-4" />
                  Delete project
                </button>
              </Popover.Content>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </div>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onBlur={() => description !== project.description && run(() => updateProject(project.id, { description }))}
        placeholder="Add a description…"
        aria-label="Project description"
        rows={1}
        className="field-sizing-content -ml-1 mt-1 w-full resize-none rounded-md bg-transparent px-1 py-0.5 text-sm text-[var(--muted-foreground)] outline-none placeholder:text-[var(--muted-foreground)]/70 hover:bg-[var(--accent)]/50 focus:bg-[var(--accent)]/50 focus:text-[var(--foreground)]"
      />
      {error && <p className="mt-1 text-xs text-[var(--destructive)]">{error}</p>}
    </div>
  );
}

/** The project's tasks: those in no section first, then each section in order. */
export function ProjectSections({
  projectId,
  sections,
  tasks,
  selectedId,
}: {
  projectId: string;
  sections: { id: string; title: string }[];
  tasks: Row[];
  selectedId: string | null;
}) {
  const [showDone, setShowDone] = useState(false);
  const doneCount = tasks.filter((t) => t.completedAt).length;
  const visible = showDone ? tasks : tasks.filter((t) => !t.completedAt);
  const known = new Set(sections.map((s) => s.id));
  const loose = visible.filter((t) => !t.sectionId || !known.has(t.sectionId));

  return (
    <div className="pb-10">
      <div className="flex items-center justify-end px-4 pt-2 sm:px-6">
        {doneCount > 0 && (
          <button type="button" onClick={() => setShowDone((v) => !v)} className="text-xs text-[var(--muted-foreground)] hover:underline">
            {showDone ? "Hide" : "Show"} completed ({doneCount})
          </button>
        )}
      </div>
      <div>
        {loose.map((t) => (
          <TaskRow key={t.id} task={t} selected={t.id === selectedId} />
        ))}
        <QuickAdd projectId={projectId} />
      </div>
      {sections.map((s, i) => (
        <Section
          key={s.id}
          section={s}
          first={i === 0}
          last={i === sections.length - 1}
          projectId={projectId}
          tasks={visible.filter((t) => t.sectionId === s.id)}
          selectedId={selectedId}
        />
      ))}
      <AddSection projectId={projectId} />
    </div>
  );
}

function Section({
  section,
  first,
  last,
  projectId,
  tasks,
  selectedId,
}: {
  section: { id: string; title: string };
  first: boolean;
  last: boolean;
  projectId: string;
  tasks: Row[];
  selectedId: string | null;
}) {
  const [open, setOpen] = useState(true);
  const [title, setTitle] = useState(section.title);
  const [, start] = useTransition();
  return (
    <section className="mt-6">
      <div className="group flex items-center gap-1 border-b border-[var(--border)] px-2 pb-1 sm:px-4">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Collapse section" : "Expand section"}
          className="rounded p-0.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)]"
        >
          {open ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </button>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
          onBlur={() => {
            if (title.trim() && title.trim() !== section.title) start(async () => void (await renameSection(section.id, title)));
            else setTitle(section.title);
          }}
          aria-label="Section title"
          className="min-w-0 flex-1 rounded bg-transparent px-1 py-0.5 text-sm font-semibold outline-none hover:bg-[var(--accent)]/50 focus:bg-[var(--accent)]/50"
        />
        <span className="text-xs tabular-nums text-[var(--muted-foreground)]">{tasks.length}</span>
        <span className="flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
          <IconButton label="Move section up" disabled={first} onClick={() => start(async () => void (await moveSection(section.id, "up")))}>
            <ArrowUp className="size-3.5" />
          </IconButton>
          <IconButton label="Move section down" disabled={last} onClick={() => start(async () => void (await moveSection(section.id, "down")))}>
            <ArrowDown className="size-3.5" />
          </IconButton>
          <IconButton
            label="Delete section"
            onClick={() => {
              if (window.confirm(`Delete the section “${section.title}”? Its tasks stay in the project.`))
                start(async () => void (await deleteSection(section.id)));
            }}
          >
            <Trash2 className="size-3.5" />
          </IconButton>
        </span>
      </div>
      {open && (
        <div>
          {tasks.map((t) => (
            <TaskRow key={t.id} task={t} selected={t.id === selectedId} />
          ))}
          <QuickAdd projectId={projectId} sectionId={section.id} />
        </div>
      )}
    </section>
  );
}

function IconButton({
  label,
  disabled,
  onClick,
  children,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="rounded p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function AddSection({ projectId }: { projectId: string }) {
  const [title, setTitle] = useState("");
  const [pending, start] = useTransition();
  return (
    <form
      className="mt-6 px-4 sm:px-6"
      onSubmit={(e) => {
        e.preventDefault();
        if (!title.trim()) return;
        start(async () => {
          const r = await createSection(projectId, title);
          if (!r.error) setTitle("");
        });
      }}
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="+ Add section"
        disabled={pending}
        maxLength={300}
        className={cn(
          "h-8 w-full max-w-sm rounded-md border border-dashed border-[var(--border)] bg-transparent px-2 text-sm font-medium outline-none placeholder:text-[var(--muted-foreground)] focus:border-solid focus:border-[var(--ring)]",
        )}
      />
    </form>
  );
}
