"use client";

import { useRef, useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { createTask } from "@/lib/actions/tasks";
import { cn } from "@/lib/utils";

/** "Add a task…": type a title and press Enter; the field stays ready for the next. */
export function QuickAdd({
  projectId,
  sectionId,
  parentId,
  assigneeId,
  placeholder = "Add a task…",
  className,
}: {
  projectId?: string | null;
  sectionId?: string | null;
  parentId?: string | null;
  assigneeId?: string | null;
  placeholder?: string;
  className?: string;
}) {
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLInputElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const t = title.trim();
    if (!t) return;
    start(async () => {
      const r = await createTask({ title: t, projectId, sectionId, parentId, assigneeId });
      if (r.error) return setError(r.error);
      setError(null);
      setTitle("");
      ref.current?.focus();
    });
  }

  return (
    <form onSubmit={submit} className={cn("flex items-center gap-3 px-4 py-1.5 sm:px-6", className)}>
      <Plus className="size-[18px] shrink-0 text-[var(--muted-foreground)]" />
      <input
        ref={ref}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            setTitle("");
            ref.current?.blur();
          }
        }}
        placeholder={placeholder}
        disabled={pending}
        maxLength={300}
        className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--muted-foreground)]"
      />
      {error && <span className="text-xs text-[var(--destructive)]">{error}</span>}
    </form>
  );
}
