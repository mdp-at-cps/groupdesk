import { requireAdmin } from "@/lib/auth";
import { agentTeamRows, listAgents, listTeams } from "@/lib/queries";
import { setAgentActive, setAgentTeam, upsertAgent } from "@/lib/actions/admin";
import {
  AddAgentForm,
  AgentTeamToggles,
  EditAgentButton,
  ToggleAgentForm,
} from "@/components/admin/forms";
import { photosFor } from "@/lib/people";
import { Avatar } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  const { agent: me } = await requireAdmin();
  const [agents, teams, memberships] = await Promise.all([
    listAgents(),
    listTeams(),
    agentTeamRows(),
  ]);
  const photos = await photosFor(agents.map((a) => a.email));

  const teamsByAgent = new Map<string, string[]>();
  for (const m of memberships) {
    teamsByAgent.set(m.agentId, [...(teamsByAgent.get(m.agentId) ?? []), m.teamId]);
  }

  return (
    <div className="max-w-4xl p-6">
      <h1 className="mb-1 text-base font-semibold">Agents</h1>
      <p className="mb-5 text-xs text-[var(--muted-foreground)]">
        Adding someone here lets them use the portal. They sign in with your identity
        provider, so they need an account there too.
      </p>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle>Add an agent</CardTitle>
          <CardDescription>
            The email must match the one their identity provider account uses.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AddAgentForm action={upsertAgent} />
        </CardContent>
      </Card>

      <table className="w-full text-sm">
        <thead className="text-left text-xs uppercase tracking-wide text-[var(--muted-foreground)]">
          <tr className="border-b border-[var(--border)]">
            <th className="py-2 font-semibold">Name</th>
            <th className="py-2 font-semibold">Email</th>
            <th className="py-2 font-semibold">Role</th>
            <th className="py-2 font-semibold">Teams</th>
            <th className="py-2 font-semibold">Signature</th>
            <th className="py-2" />
          </tr>
        </thead>
        <tbody>
          {agents.map((a) => (
            <tr
              key={a.id}
              className={`border-b border-[var(--border)] ${a.active ? "" : "opacity-50"}`}
            >
              <td className="py-2 pr-3">
                <span className="flex items-center gap-2">
                  <Avatar name={a.name} email={a.email} photo={photos[a.email.toLowerCase()]} size="sm" />
                  {a.name}
                  {a.id === me.id && <span className="text-xs text-[var(--muted-foreground)]">(you)</span>}
                </span>
              </td>
              <td className="py-2 pr-3 text-[var(--muted-foreground)]">{a.email}</td>
              <td className="py-2 pr-3 capitalize">{a.role}</td>
              <td className="py-2 pr-3">
                <AgentTeamToggles
                  action={setAgentTeam}
                  agentId={a.id}
                  teams={teams.map((t) => ({ id: t.id, name: t.name }))}
                  memberOf={teamsByAgent.get(a.id) ?? []}
                />
              </td>
              <td className="py-2 pr-3 text-xs text-[var(--muted-foreground)]">
                {a.signature ? "Custom" : "Default"}
              </td>
              <td className="py-2 text-right">
                <span className="flex justify-end gap-2">
                  <EditAgentButton
                    action={upsertAgent}
                    agent={{ id: a.id, name: a.name, email: a.email, role: a.role, signature: a.signature }}
                    isSelf={a.id === me.id}
                  />
                  <ToggleAgentForm action={setAgentActive} id={a.id} active={a.active} />
                </span>
              </td>
            </tr>
          ))}
          {agents.length === 0 && (
            <tr>
              <td colSpan={6} className="py-6 text-xs text-[var(--muted-foreground)]">
                No agents yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
