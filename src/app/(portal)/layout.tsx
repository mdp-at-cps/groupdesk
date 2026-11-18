import { Suspense } from "react";
import { cookies } from "next/headers";
import { ResizablePanel } from "@/components/resizable-panel";
import Link from "next/link";
import { canManageGmail, requireAgent } from "@/lib/auth";
import { listSavedViews, listTags, listTeams, viewCounts } from "@/lib/queries";
import { AppSidebar } from "@/components/app-sidebar";
import { AppSwitcher } from "@/components/app-switcher";
import { taskSidebar } from "@/lib/tasks";
import { MobileNav } from "@/components/mobile-nav";
import { photosFor } from "@/lib/people";
import { UserMenu } from "@/components/user-menu";
import { signInConfigured } from "@/lib/session";
import { APP_NAME, APP_TAGLINE } from "@/lib/utils";
import { GlobalShortcuts } from "@/components/shortcuts";

export default async function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { agent } = await requireAgent();
  const [counts, teams, tags, photos, views, tasks] = await Promise.all([
    viewCounts(agent),
    listTeams(),
    listTags(),
    photosFor([agent.email]),
    listSavedViews(agent.id),
    taskSidebar(agent.id),
  ]);

  const sidebar = {
    counts,
    teams: teams.map((t) => ({ name: t.name, slug: t.slug })),
    tags: tags.map((t) => ({ name: t.name, slug: t.slug, color: t.color })),
    isAdmin: agent.role === "admin",
    canManageGmail: canManageGmail(agent),
    savedViews: views,
  };

  return (
    // The shell is pinned to the window: the sidebar, the page and any side
    // panel each scroll on their own instead of the whole document scrolling.
    <div className="flex h-dvh flex-col overflow-hidden">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--border)] px-4">
        <Suspense fallback={null}>
          <MobileNav tickets={sidebar} tasks={tasks} />
        </Suspense>
        <Link href="/tickets" className="flex items-baseline gap-2 text-sm font-semibold tracking-tight">
          {APP_NAME}
          {APP_TAGLINE && (
            <span className="hidden text-xs font-normal italic tracking-normal text-[var(--muted-foreground)] sm:inline">
              {APP_TAGLINE}
            </span>
          )}
        </Link>
        <AppSwitcher />
        <div className="ml-auto flex items-center gap-3 text-xs text-[var(--muted-foreground)]">
          <GlobalShortcuts />
          <UserMenu
            name={agent.name}
            email={agent.email}
            photo={photos[agent.email.toLowerCase()] ?? null}
            logoutUrl={signInConfigured() ? "/api/auth/logout" : null}
            notifyEmail={agent.notifyEmail}
            theme={agent.theme}
          />
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ResizablePanel
          id="sidebar-w"
          side="left"
          initialWidth={Number((await cookies()).get("sidebar-w")?.value) || undefined}
          defaultWidth={224}
          min={180}
          max={360}
          className="hidden md:flex"
        >
          <Suspense fallback={<div className="h-full border-r border-[var(--border)]" />}>
            <AppSidebar tickets={sidebar} tasks={tasks} className="h-full w-full overflow-y-auto" />
          </Suspense>
        </ResizablePanel>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">{children}</main>
          {/* Artwork for themes that have it (globals.css); hidden otherwise. */}
          <div className="theme-footer" aria-hidden />
        </div>
      </div>
    </div>
  );
}
