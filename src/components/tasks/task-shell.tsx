import { cookies } from "next/headers";
import { ResizablePanel } from "@/components/resizable-panel";
import { listAgents } from "@/lib/queries";
import { taskDetail, taskSidebar } from "@/lib/tasks";
import { cn } from "@/lib/utils";
import { TaskPanel } from "./task-panel";

/**
 * A Task Manager page: the list, plus the open task (?task=<id>) in a panel
 * on the right. On a phone the panel takes the whole width instead.
 */
export async function TaskShell({
  agentId,
  taskId,
  children,
}: {
  agentId: string;
  taskId: string | null;
  children: React.ReactNode;
}) {
  const detail = taskId ? await taskDetail(taskId, agentId) : null;
  const [agents, sidebar, jar] = detail
    ? await Promise.all([listAgents(true), taskSidebar(agentId), cookies()])
    : [[], null, null];

  return (
    <div className="flex h-full">
      <div className={cn("min-w-0 flex-1 overflow-y-auto", detail && "max-md:hidden")}>{children}</div>
      {detail && (
        <ResizablePanel
          id="task-panel-w"
          side="right"
          initialWidth={Number(jar?.get("task-panel-w")?.value) || undefined}
          defaultWidth={440}
          min={340}
          max={760}
          className="max-md:w-full!"
        >
          <TaskPanel
            key={detail.task.id}
            detail={detail}
            agents={agents.map((a) => ({ id: a.id, name: a.name, email: a.email }))}
            projects={(sidebar?.projects ?? []).map((p) => ({ id: p.id, title: p.title }))}
          />
        </ResizablePanel>
      )}
    </div>
  );
}
