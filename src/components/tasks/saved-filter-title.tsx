"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { deleteTaskFilter, updateTaskFilter } from "@/lib/actions/tasks";

/** A saved filter's name, renamed in place, with a delete button. */
export function SavedFilterTitle({ id, name }: { id: string; name: string }) {
  const [value, setValue] = useState(name);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const router = useRouter();
  return (
    <div className="flex items-center gap-2">
      <input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        onBlur={() => {
          if (!value.trim() || value.trim() === name) return setValue(name);
          start(async () => {
            const r = await updateTaskFilter(id, { name: value });
            setError(r.error ?? null);
          });
        }}
        aria-label="Filter name"
        maxLength={60}
        className="-ml-1 min-w-0 flex-1 rounded-md bg-transparent px-1 py-0.5 text-lg font-semibold outline-none hover:bg-[var(--accent)]/50 focus:bg-[var(--accent)]/50"
      />
      <button
        type="button"
        onClick={() => {
          if (!window.confirm(`Delete the filter “${name}”? Its tasks aren't affected.`)) return;
          start(async () => {
            await deleteTaskFilter(id);
            router.push("/tasks");
          });
        }}
        className="rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--destructive)]"
        aria-label="Delete filter"
        title="Delete filter"
      >
        <Trash2 className="size-4" />
      </button>
      {error && <span className="text-xs text-[var(--destructive)]">{error}</span>}
    </div>
  );
}
