/**
 * Task filter criteria, shared by the filter bar (browser) and the queries
 * (server). A filter is a handful of URL parameters:
 *
 *   assignee  me | none | <agent id>          (absent: anyone)
 *   project   none | <project id>             (absent: any project or none)
 *   due       overdue | today | week | later | none | dated
 *   q         words to find in the title or description
 *   sub       1 to list subtasks as well as tasks
 *
 * Each sidebar view is a preset of these; the URL adds to or overrides it,
 * with "any" to clear one of the preset's values. A saved filter stores the
 * combined criteria as a query string.
 */

export type DueFilter = "overdue" | "today" | "week" | "later" | "none" | "dated";

export type TaskCriteria = {
  assignee?: string;
  project?: string;
  due?: DueFilter;
  q?: string;
  sub?: boolean;
};

export const CRITERIA_KEYS = ["assignee", "project", "due", "q", "sub"] as const;

export const DUE_OPTIONS: { value: DueFilter; label: string }[] = [
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Due today" },
  { value: "week", label: "Due in the next 7 days" },
  { value: "later", label: "Due later" },
  { value: "dated", label: "Has a due date" },
  { value: "none", label: "No due date" },
];

const UUID = /^[0-9a-f-]{36}$/i;
const DUE = new Set(DUE_OPTIONS.map((d) => d.value));

export const PRESETS = {
  mine: { assignee: "me", sub: true },
  all: {},
  unassigned: { assignee: "none" },
} satisfies Record<string, TaskCriteria>;
export type PresetKey = keyof typeof PRESETS;

type Params = Record<string, string | string[] | undefined> | URLSearchParams;

function get(params: Params, key: string) {
  const v = params instanceof URLSearchParams ? params.get(key) : params[key];
  return (Array.isArray(v) ? v[0] : v) ?? undefined;
}

/** Valid criteria from a query string or search params; anything unknown is dropped. */
export function parseCriteria(params: Params | string): TaskCriteria {
  const p = typeof params === "string" ? new URLSearchParams(params) : params;
  const c: TaskCriteria = {};
  const assignee = get(p, "assignee");
  if (assignee === "me" || assignee === "none" || (assignee && UUID.test(assignee))) c.assignee = assignee;
  const project = get(p, "project");
  if (project === "none" || (project && UUID.test(project))) c.project = project;
  const due = get(p, "due");
  if (due && DUE.has(due as DueFilter)) c.due = due as DueFilter;
  const q = get(p, "q")?.trim().slice(0, 100);
  if (q) c.q = q;
  if (get(p, "sub") === "1") c.sub = true;
  return c;
}

/** The preset with the URL's changes on top ("any" clears a preset value). */
export function applyOverrides(preset: TaskCriteria, params: Params): TaskCriteria {
  const out: TaskCriteria = { ...preset, ...parseCriteria(params) };
  for (const key of CRITERIA_KEYS) {
    const v = get(params, key);
    if (v === "any" || (key === "sub" && v === "0")) delete out[key];
  }
  return out;
}

/** Criteria as a query string, keys in a fixed order (so equal filters compare equal). */
export function criteriaQuery(c: TaskCriteria) {
  const p = new URLSearchParams();
  if (c.assignee) p.set("assignee", c.assignee);
  if (c.project) p.set("project", c.project);
  if (c.due) p.set("due", c.due);
  if (c.q) p.set("q", c.q);
  if (c.sub) p.set("sub", "1");
  return p.toString();
}

export function sameCriteria(a: TaskCriteria, b: TaskCriteria) {
  return criteriaQuery(a) === criteriaQuery(b);
}
