import { notFound } from "next/navigation";
import { requireAgent } from "@/lib/auth";
import { APP_NAME } from "@/lib/utils";
import { listAgents } from "@/lib/queries";
import { projectView } from "@/lib/tasks";
import { TaskShell } from "@/components/tasks/task-shell";
import { ProjectHeader, ProjectSections } from "@/components/tasks/project-view";

export const dynamic = "force-dynamic";
export const metadata = { title: `Tasks · ${APP_NAME}` };

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ task?: string }>;
}) {
  const { agent } = await requireAgent();
  const { id } = await params;
  const { task } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  // Not a member reads the same as no such project.
  const [view, agents] = await Promise.all([projectView(id, agent.id), listAgents(true)]);
  if (!view) notFound();

  return (
    <TaskShell agentId={agent.id} taskId={task ?? null}>
      <ProjectHeader
        key={view.project.id}
        project={view.project}
        members={view.members}
        agents={agents.map((a) => ({ id: a.id, name: a.name, email: a.email }))}
        meId={agent.id}
      />
      <ProjectSections
        projectId={view.project.id}
        sections={view.sections}
        tasks={view.tasks}
        selectedId={task ?? null}
      />
    </TaskShell>
  );
}
