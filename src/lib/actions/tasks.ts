"use server";

import { revalidatePath } from "next/cache";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, projectMembers, projects, projectSections, taskFilters, tasks } from "@/db/schema";
import { criteriaQuery, parseCriteria } from "@/lib/task-filters";
import { requireAgent } from "@/lib/auth";
import { canAccessTask, isProjectMember, nextTaskPosition } from "@/lib/tasks";
import type { ActionState } from "./tickets";

/*
 * Task Manager writes. Every action checks the same rules the reads use
 * (src/lib/tasks.ts): project members can change a project and its tasks;
 * a task outside a project belongs to its creator and its assignee.
 */

const TITLE_MAX = 300;
const DESCRIPTION_MAX = 20_000;

function done() {
  revalidatePath("/tasks", "layout");
}

function cleanTitle(raw: string) {
  return raw.replace(/\s+/g, " ").trim().slice(0, TITLE_MAX);
}

function validDate(v: string | null | undefined) {
  if (!v) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) ? v : undefined;
}

async function loadTask(agentId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [task] = await db.select().from(tasks).where(eq(tasks.id, id)).limit(1);
  if (!task || !(await canAccessTask(agentId, task))) return null;
  return task;
}

/** Whether the agent can be assigned a task in this project (or anywhere, outside one). */
async function assignable(agentId: string, projectId: string | null) {
  if (projectId) return isProjectMember(projectId, agentId);
  const [a] = await db.select({ active: agents.active }).from(agents).where(eq(agents.id, agentId)).limit(1);
  return !!a?.active;
}

/* --------------------------------------------------------------- projects */

export async function createProject(input: {
  title: string;
  description?: string;
}): Promise<ActionState & { id?: string }> {
  const { agent } = await requireAgent();
  const title = cleanTitle(input.title);
  if (!title) return { error: "Name the project" };
  const id = await db.transaction(async (tx) => {
    const [p] = await tx
      .insert(projects)
      .values({ title, description: (input.description ?? "").slice(0, DESCRIPTION_MAX), createdById: agent.id })
      .returning({ id: projects.id });
    await tx.insert(projectMembers).values({ projectId: p.id, agentId: agent.id });
    return p.id;
  });
  done();
  return { ok: `Created “${title}”`, id };
}

export async function updateProject(
  id: string,
  patch: { title?: string; description?: string },
): Promise<ActionState> {
  const { agent } = await requireAgent();
  if (!(await isProjectMember(id, agent.id))) return { error: "You're not a member of that project" };
  const set: { title?: string; description?: string } = {};
  if (patch.title !== undefined) {
    const title = cleanTitle(patch.title);
    if (!title) return { error: "A project needs a title" };
    set.title = title;
  }
  if (patch.description !== undefined) set.description = patch.description.slice(0, DESCRIPTION_MAX);
  await db.update(projects).set(set).where(eq(projects.id, id));
  done();
  return { ok: "Saved" };
}

export async function deleteProject(id: string): Promise<ActionState> {
  const { agent } = await requireAgent();
  if (!(await isProjectMember(id, agent.id))) return { error: "You're not a member of that project" };
  await db.delete(projects).where(eq(projects.id, id));
  done();
  return { ok: "Project deleted" };
}

/** Add or remove a member. A project always keeps at least one. */
export async function setProjectMember(projectId: string, agentId: string, on: boolean): Promise<ActionState> {
  const { agent } = await requireAgent();
  if (!(await isProjectMember(projectId, agent.id))) return { error: "You're not a member of that project" };
  if (on) {
    const [a] = await db.select({ active: agents.active }).from(agents).where(eq(agents.id, agentId)).limit(1);
    if (!a?.active) return { error: "That agent isn't active" };
    await db.insert(projectMembers).values({ projectId, agentId }).onConflictDoNothing();
  } else {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(projectMembers)
      .where(eq(projectMembers.projectId, projectId));
    if (n <= 1) return { error: "A project needs at least one member" };
    await db
      .delete(projectMembers)
      .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.agentId, agentId)));
  }
  done();
  return { ok: on ? "Member added" : "Member removed" };
}

/* --------------------------------------------------------------- sections */

export async function createSection(projectId: string, rawTitle: string): Promise<ActionState> {
  const { agent } = await requireAgent();
  if (!(await isProjectMember(projectId, agent.id))) return { error: "You're not a member of that project" };
  const title = cleanTitle(rawTitle);
  if (!title) return { error: "Name the section" };
  const [{ n }] = await db
    .select({ n: sql<number>`coalesce(max(${projectSections.position}), -1)::int + 1` })
    .from(projectSections)
    .where(eq(projectSections.projectId, projectId));
  await db.insert(projectSections).values({ projectId, title, position: n });
  done();
  return { ok: "Section added" };
}

async function loadSection(agentId: string, id: string) {
  const [s] = await db.select().from(projectSections).where(eq(projectSections.id, id)).limit(1);
  if (!s || !(await isProjectMember(s.projectId, agentId))) return null;
  return s;
}

export async function renameSection(id: string, rawTitle: string): Promise<ActionState> {
  const { agent } = await requireAgent();
  const section = await loadSection(agent.id, id);
  if (!section) return { error: "Section not found" };
  const title = cleanTitle(rawTitle);
  if (!title) return { error: "A section needs a title" };
  await db.update(projectSections).set({ title }).where(eq(projectSections.id, id));
  done();
  return { ok: "Saved" };
}

/** Deleting a section keeps its tasks; they move to the top of the project. */
export async function deleteSection(id: string): Promise<ActionState> {
  const { agent } = await requireAgent();
  const section = await loadSection(agent.id, id);
  if (!section) return { error: "Section not found" };
  await db.delete(projectSections).where(eq(projectSections.id, id));
  done();
  return { ok: "Section deleted; its tasks moved to the top" };
}

export async function moveSection(id: string, direction: "up" | "down"): Promise<ActionState> {
  const { agent } = await requireAgent();
  const section = await loadSection(agent.id, id);
  if (!section) return { error: "Section not found" };
  const all = await db
    .select()
    .from(projectSections)
    .where(eq(projectSections.projectId, section.projectId))
    .orderBy(projectSections.position, projectSections.title);
  const i = all.findIndex((s) => s.id === id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return { ok: "" };
  [all[i], all[j]] = [all[j], all[i]];
  await db.transaction(async (tx) => {
    for (const [pos, s] of all.entries()) {
      await tx.update(projectSections).set({ position: pos }).where(eq(projectSections.id, s.id));
    }
  });
  done();
  return { ok: "" };
}

/* ------------------------------------------------------------------ tasks */

export async function createTask(input: {
  title: string;
  projectId?: string | null;
  sectionId?: string | null;
  parentId?: string | null;
  assigneeId?: string | null;
  dueDate?: string | null;
}): Promise<ActionState & { id?: string }> {
  const { agent } = await requireAgent();
  const title = cleanTitle(input.title);
  if (!title) return { error: "Name the task" };

  let projectId = input.projectId ?? null;
  let sectionId = input.sectionId ?? null;
  const parentId = input.parentId ?? null;

  if (parentId) {
    const parent = await loadTask(agent.id, parentId);
    if (!parent) return { error: "Parent task not found" };
    if (parent.parentId) return { error: "Subtasks can't have subtasks of their own" };
    projectId = parent.projectId;
    sectionId = null;
  } else if (projectId) {
    if (!(await isProjectMember(projectId, agent.id))) return { error: "You're not a member of that project" };
    if (sectionId) {
      const s = await loadSection(agent.id, sectionId);
      if (!s || s.projectId !== projectId) sectionId = null;
    }
  } else {
    sectionId = null;
  }

  const assigneeId = input.assigneeId ?? null;
  if (assigneeId && !(await assignable(assigneeId, projectId)))
    return { error: projectId ? "Assign it to a member of the project" : "That agent isn't active" };
  const dueDate = validDate(input.dueDate);
  if (dueDate === undefined) return { error: "That due date isn't valid" };

  const position = await nextTaskPosition(
    parentId
      ? eq(tasks.parentId, parentId)
      : projectId
        ? and(eq(tasks.projectId, projectId), isNull(tasks.parentId))
        : and(isNull(tasks.projectId), isNull(tasks.parentId), eq(tasks.createdById, agent.id)),
  );

  const [row] = await db
    .insert(tasks)
    .values({ title, projectId, sectionId, parentId, assigneeId, dueDate, position, createdById: agent.id })
    .returning({ id: tasks.id });
  done();
  return { ok: "Task added", id: row.id };
}

export async function updateTask(
  id: string,
  patch: {
    title?: string;
    description?: string;
    assigneeId?: string | null;
    dueDate?: string | null;
    sectionId?: string | null;
    /** Move to another project (or none). Subtasks follow; the section is cleared. */
    projectId?: string | null;
  },
): Promise<ActionState> {
  const { agent } = await requireAgent();
  const task = await loadTask(agent.id, id);
  if (!task) return { error: "Task not found" };

  const set: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date() };
  let projectId = task.projectId;

  if (patch.projectId !== undefined && patch.projectId !== task.projectId) {
    if (task.parentId) return { error: "A subtask stays in its parent's project" };
    if (patch.projectId && !(await isProjectMember(patch.projectId, agent.id)))
      return { error: "You're not a member of that project" };
    projectId = patch.projectId;
    set.projectId = projectId;
    set.sectionId = null;
    set.position = await nextTaskPosition(
      projectId ? and(eq(tasks.projectId, projectId), isNull(tasks.parentId)) : undefined,
    );
    // Keep the assignee only if they can see it where it's going.
    const assignee = patch.assigneeId !== undefined ? patch.assigneeId : task.assigneeId;
    if (assignee && !(await assignable(assignee, projectId))) set.assigneeId = null;
  }
  if (patch.title !== undefined) {
    const title = cleanTitle(patch.title);
    if (!title) return { error: "A task needs a title" };
    set.title = title;
  }
  if (patch.description !== undefined) set.description = patch.description.slice(0, DESCRIPTION_MAX);
  if (patch.assigneeId !== undefined && set.assigneeId === undefined) {
    if (patch.assigneeId && !(await assignable(patch.assigneeId, projectId)))
      return { error: projectId ? "Assign it to a member of the project" : "That agent isn't active" };
    set.assigneeId = patch.assigneeId;
  }
  if (patch.dueDate !== undefined) {
    const d = validDate(patch.dueDate);
    if (d === undefined) return { error: "That due date isn't valid" };
    set.dueDate = d;
  }
  if (patch.sectionId !== undefined && set.sectionId === undefined) {
    if (patch.sectionId) {
      const s = await loadSection(agent.id, patch.sectionId);
      if (!s || s.projectId !== projectId || task.parentId) return { error: "Section not found" };
    }
    set.sectionId = patch.sectionId;
  }

  await db.transaction(async (tx) => {
    await tx.update(tasks).set(set).where(eq(tasks.id, id));
    if (set.projectId !== undefined) {
      await tx.update(tasks).set({ projectId: set.projectId }).where(eq(tasks.parentId, id));
    }
  });
  done();
  return { ok: "Saved" };
}

export async function setTaskDone(id: string, isDone: boolean): Promise<ActionState> {
  const { agent } = await requireAgent();
  const task = await loadTask(agent.id, id);
  if (!task) return { error: "Task not found" };
  await db
    .update(tasks)
    .set({ completedAt: isDone ? new Date() : null, updatedAt: new Date() })
    .where(eq(tasks.id, id));
  done();
  return { ok: isDone ? "Completed" : "Reopened" };
}

export async function deleteTask(id: string): Promise<ActionState> {
  const { agent } = await requireAgent();
  const task = await loadTask(agent.id, id);
  if (!task) return { error: "Task not found" };
  await db.delete(tasks).where(eq(tasks.id, id));
  done();
  return { ok: "Task deleted" };
}

/* --------------------------------------------------------- saved filters */

const MAX_FILTERS = 30;

function cleanName(raw: string) {
  return raw.replace(/\s+/g, " ").trim().slice(0, 60);
}

/** Save the current criteria (a query string) as one of my filters. */
export async function saveTaskFilter(rawName: string, query: string): Promise<ActionState & { id?: string }> {
  const { agent } = await requireAgent();
  const name = cleanName(rawName);
  if (!name) return { error: "Name the filter" };
  const [{ n, max }] = await db
    .select({ n: sql<number>`count(*)::int`, max: sql<number>`coalesce(max(${taskFilters.position}), -1)::int` })
    .from(taskFilters)
    .where(eq(taskFilters.agentId, agent.id));
  if (n >= MAX_FILTERS) return { error: `That's ${MAX_FILTERS} filters: delete one first` };
  const [row] = await db
    .insert(taskFilters)
    .values({ agentId: agent.id, name, query: criteriaQuery(parseCriteria(query)), position: max + 1 })
    .returning({ id: taskFilters.id });
  done();
  return { ok: `Saved “${name}”`, id: row.id };
}

async function myFilter(agentId: string, id: string) {
  const [f] = await db
    .select()
    .from(taskFilters)
    .where(and(eq(taskFilters.id, id), eq(taskFilters.agentId, agentId)))
    .limit(1);
  return f ?? null;
}

/** Rename a filter, or replace its criteria with the current ones. */
export async function updateTaskFilter(id: string, patch: { name?: string; query?: string }): Promise<ActionState> {
  const { agent } = await requireAgent();
  if (!(await myFilter(agent.id, id))) return { error: "Filter not found" };
  const set: { name?: string; query?: string } = {};
  if (patch.name !== undefined) {
    const name = cleanName(patch.name);
    if (!name) return { error: "A filter needs a name" };
    set.name = name;
  }
  if (patch.query !== undefined) set.query = criteriaQuery(parseCriteria(patch.query));
  await db.update(taskFilters).set(set).where(eq(taskFilters.id, id));
  done();
  return { ok: patch.query !== undefined ? "Filter updated" : "Renamed" };
}

export async function deleteTaskFilter(id: string): Promise<ActionState> {
  const { agent } = await requireAgent();
  await db.delete(taskFilters).where(and(eq(taskFilters.id, id), eq(taskFilters.agentId, agent.id)));
  done();
  return { ok: "Filter deleted" };
}

export async function moveTaskFilter(id: string, direction: "up" | "down"): Promise<ActionState> {
  const { agent } = await requireAgent();
  const all = await db
    .select({ id: taskFilters.id })
    .from(taskFilters)
    .where(eq(taskFilters.agentId, agent.id))
    .orderBy(taskFilters.position, taskFilters.createdAt);
  const i = all.findIndex((f) => f.id === id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= all.length) return { ok: "" };
  [all[i], all[j]] = [all[j], all[i]];
  await db.transaction(async (tx) => {
    for (const [pos, f] of all.entries()) {
      await tx.update(taskFilters).set({ position: pos }).where(eq(taskFilters.id, f.id));
    }
  });
  done();
  return { ok: "" };
}
