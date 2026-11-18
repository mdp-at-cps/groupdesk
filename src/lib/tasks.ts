import "server-only";
import { and, asc, desc, eq, isNull, isNotNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import { agents, projectMembers, projects, projectSections, taskFilters, tasks, type Task } from "@/db/schema";
import { PRESETS, parseCriteria, type TaskCriteria } from "@/lib/task-filters";
import { todayISO } from "@/lib/task-dates";

/*
 * The Task Manager's access rules and reads.
 *
 * - A project, its sections and its tasks are visible to (and editable by)
 *   the project's members.
 * - A task outside any project is visible to whoever created it and whoever
 *   it's assigned to; its subtasks go with it.
 * - Subtasks are one level deep and always sit in their parent's project.
 */

export type TaskRow = {
  id: string;
  title: string;
  dueDate: string | null;
  completedAt: Date | null;
  projectId: string | null;
  projectTitle: string | null;
  sectionId: string | null;
  parentId: string | null;
  parentTitle: string | null;
  assignee: { id: string; name: string; email: string } | null;
  subtasks: { total: number; done: number };
  hasDescription: boolean;
};

export async function isProjectMember(projectId: string, agentId: string) {
  const [row] = await db
    .select({ id: projectMembers.projectId })
    .from(projectMembers)
    .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.agentId, agentId)))
    .limit(1);
  return !!row;
}

/** Whether the agent can see (and so edit) this task. */
export async function canAccessTask(agentId: string, task: Task): Promise<boolean> {
  if (task.projectId) return isProjectMember(task.projectId, agentId);
  if (task.createdById === agentId || task.assigneeId === agentId) return true;
  if (task.parentId) {
    const [parent] = await db.select().from(tasks).where(eq(tasks.id, task.parentId)).limit(1);
    return !!parent && canAccessTask(agentId, parent);
  }
  return false;
}

/** SQL for "this agent can see the task in `tasks`" (subtasks of personal tasks included). */
function visibleTo(agentId: string): SQL {
  return sql`(
    (${tasks.projectId} is not null and exists (
      select 1 from ${projectMembers} pm where pm.project_id = ${tasks.projectId} and pm.agent_id = ${agentId}
    ))
    or (${tasks.projectId} is null and (
      ${tasks.createdById} = ${agentId} or ${tasks.assigneeId} = ${agentId}
      or exists (select 1 from ${tasks} p where p.id = ${tasks.parentId}
                 and (p.created_by_id = ${agentId} or p.assignee_id = ${agentId}))
    ))
  )`;
}

const parent = sql`(select p.title from ${tasks} p where p.id = ${tasks.parentId})`;
const subtaskTotal = sql<number>`(select count(*)::int from ${tasks} s where s.parent_id = ${tasks.id})`;
const subtaskDone = sql<number>`(select count(*)::int from ${tasks} s where s.parent_id = ${tasks.id} and s.completed_at is not null)`;

async function selectRows(where: SQL | undefined, order: SQL[]): Promise<TaskRow[]> {
  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      completedAt: tasks.completedAt,
      projectId: tasks.projectId,
      projectTitle: projects.title,
      sectionId: tasks.sectionId,
      parentId: tasks.parentId,
      parentTitle: sql<string | null>`${parent}`,
      assigneeId: agents.id,
      assigneeName: agents.name,
      assigneeEmail: agents.email,
      total: subtaskTotal,
      done: subtaskDone,
      hasDescription: sql<boolean>`${tasks.description} <> ''`,
    })
    .from(tasks)
    .leftJoin(projects, eq(projects.id, tasks.projectId))
    .leftJoin(agents, eq(agents.id, tasks.assigneeId))
    .where(where)
    .orderBy(...order);
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    dueDate: r.dueDate,
    completedAt: r.completedAt,
    projectId: r.projectId,
    projectTitle: r.projectTitle,
    sectionId: r.sectionId,
    parentId: r.parentId,
    parentTitle: r.parentTitle,
    assignee: r.assigneeId ? { id: r.assigneeId, name: r.assigneeName!, email: r.assigneeEmail! } : null,
    subtasks: { total: r.total, done: r.done },
    hasDescription: r.hasDescription,
  }));
}

function addDays(iso: string, n: number) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** SQL for a filter's criteria, always limited to tasks the agent can see. */
function criteriaWhere(agentId: string, c: TaskCriteria): SQL {
  const parts: (SQL | undefined)[] = [visibleTo(agentId)];
  if (!c.sub) parts.push(isNull(tasks.parentId));

  if (c.assignee === "me") parts.push(eq(tasks.assigneeId, agentId));
  else if (c.assignee === "none") parts.push(isNull(tasks.assigneeId));
  else if (c.assignee) parts.push(eq(tasks.assigneeId, c.assignee));

  if (c.project === "none") parts.push(isNull(tasks.projectId));
  else if (c.project) parts.push(eq(tasks.projectId, c.project));

  const today = todayISO();
  if (c.due === "overdue") parts.push(sql`${tasks.dueDate} < ${today}`);
  else if (c.due === "today") parts.push(sql`${tasks.dueDate} = ${today}`);
  else if (c.due === "week") parts.push(sql`${tasks.dueDate} between ${today} and ${addDays(today, 7)}`);
  else if (c.due === "later") parts.push(sql`${tasks.dueDate} > ${addDays(today, 7)}`);
  else if (c.due === "none") parts.push(isNull(tasks.dueDate));
  else if (c.due === "dated") parts.push(isNotNull(tasks.dueDate));

  if (c.q) {
    const like = `%${c.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
    parts.push(sql`(${tasks.title} ilike ${like} or ${tasks.description} ilike ${like})`);
  }
  return and(...parts)!;
}

async function openCount(agentId: string, c: TaskCriteria) {
  const [r] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(and(criteriaWhere(agentId, c), isNull(tasks.completedAt)));
  return r.n;
}

/** My saved filters, in sidebar order. */
export async function savedTaskFilters(agentId: string) {
  return db
    .select({ id: taskFilters.id, name: taskFilters.name, query: taskFilters.query })
    .from(taskFilters)
    .where(eq(taskFilters.agentId, agentId))
    .orderBy(asc(taskFilters.position), asc(taskFilters.createdAt));
}

export async function savedTaskFilter(agentId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [f] = await db
    .select()
    .from(taskFilters)
    .where(and(eq(taskFilters.id, id), eq(taskFilters.agentId, agentId)))
    .limit(1);
  return f ?? null;
}

/** Left-sidebar data: open counts for each view and saved filter, and my projects. */
export async function taskSidebar(agentId: string) {
  const saved = await savedTaskFilters(agentId);
  const [myOpen, allOpen, unassignedOpen, filterCounts, myProjects] = await Promise.all([
    openCount(agentId, PRESETS.mine),
    openCount(agentId, PRESETS.all),
    openCount(agentId, PRESETS.unassigned),
    Promise.all(saved.map((f) => openCount(agentId, parseCriteria(f.query)))),
    db
      .select({
        id: projects.id,
        title: projects.title,
        open: sql<number>`(select count(*)::int from ${tasks} t where t.project_id = ${projects.id}
                           and t.parent_id is null and t.completed_at is null)`,
      })
      .from(projects)
      .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.agentId, agentId)))
      .orderBy(asc(sql`lower(${projects.title})`)),
  ]);
  return {
    myOpen,
    allOpen,
    unassignedOpen,
    filters: saved.map((f, i) => ({ id: f.id, name: f.name, open: filterCounts[i] })),
    projects: myProjects,
  };
}

/** Tasks matching the criteria: open ones by due date, or the 100 most recently completed. */
export async function taskList(agentId: string, criteria: TaskCriteria, completed: boolean) {
  return selectRows(
    and(criteriaWhere(agentId, criteria), completed ? isNotNull(tasks.completedAt) : isNull(tasks.completedAt)),
    completed
      ? [desc(tasks.completedAt)]
      : [sql`${tasks.dueDate} asc nulls last`, asc(tasks.position), asc(tasks.createdAt)],
  ).then((rows) => (completed ? rows.slice(0, 100) : rows));
}

export async function projectView(projectId: string, agentId: string) {
  if (!(await isProjectMember(projectId, agentId))) return null;
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;
  const [members, sections, rows] = await Promise.all([
    projectMemberList(projectId),
    db
      .select()
      .from(projectSections)
      .where(eq(projectSections.projectId, projectId))
      .orderBy(asc(projectSections.position), asc(projectSections.title)),
    selectRows(and(eq(tasks.projectId, projectId), isNull(tasks.parentId)), [
      sql`${tasks.completedAt} is not null`,
      asc(tasks.position),
      asc(tasks.createdAt),
    ]),
  ]);
  return { project, members, sections, tasks: rows };
}

export async function projectMemberList(projectId: string) {
  return db
    .select({ id: agents.id, name: agents.name, email: agents.email })
    .from(projectMembers)
    .innerJoin(agents, eq(agents.id, projectMembers.agentId))
    .where(eq(projectMembers.projectId, projectId))
    .orderBy(asc(agents.name));
}

/** Everything the task panel shows, or null when it isn't visible to me. */
export async function taskDetail(taskId: string, agentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return null;
  const [task] = await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1);
  if (!task || !(await canAccessTask(agentId, task))) return null;

  const [subtasks, parentRow, project, members, sections, creator] = await Promise.all([
    selectRows(eq(tasks.parentId, task.id), [asc(tasks.position), asc(tasks.createdAt)]),
    task.parentId
      ? db.select({ id: tasks.id, title: tasks.title }).from(tasks).where(eq(tasks.id, task.parentId)).limit(1)
      : Promise.resolve([]),
    task.projectId
      ? db.select({ id: projects.id, title: projects.title }).from(projects).where(eq(projects.id, task.projectId)).limit(1)
      : Promise.resolve([]),
    task.projectId ? projectMemberList(task.projectId) : Promise.resolve(null),
    task.projectId
      ? db
          .select({ id: projectSections.id, title: projectSections.title })
          .from(projectSections)
          .where(eq(projectSections.projectId, task.projectId))
          .orderBy(asc(projectSections.position))
      : Promise.resolve([]),
    task.createdById
      ? db.select({ name: agents.name }).from(agents).where(eq(agents.id, task.createdById)).limit(1)
      : Promise.resolve([]),
  ]);
  return {
    task,
    subtasks,
    parent: parentRow[0] ?? null,
    project: project[0] ?? null,
    /** Who it can be assigned to: the project's members, or (outside a project) null for everyone. */
    members,
    sections,
    createdBy: creator[0]?.name ?? null,
  };
}

/** Next position at the end of a list. */
export async function nextTaskPosition(where: SQL | undefined) {
  const [{ n }] = await db
    .select({ n: sql<number>`coalesce(max(${tasks.position}), -1)::int + 1` })
    .from(tasks)
    .where(where);
  return n;
}

