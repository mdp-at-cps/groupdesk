"use server";

import { revalidatePath } from "next/cache";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { agents, savedViews } from "@/db/schema";
import { requireAgent } from "@/lib/auth";
import type { ActionState } from "./tickets";
import { isTheme } from "@/lib/themes";
import { cleanSignature, MAX_SIGNATURE_LENGTH } from "@/lib/signature";
import { saveSignatureImage } from "@/lib/signature-images";

/** Save the current list filters (a /tickets query string) under a name. */
export async function saveView(name: string, query: string): Promise<ActionState> {
  const { agent } = await requireAgent();
  const clean = name.trim().slice(0, 60);
  if (!clean) return { error: "Name the view" };
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(savedViews)
    .where(eq(savedViews.agentId, agent.id));
  if (n >= 30) return { error: "That's 30 views: delete one first" };
  await db.insert(savedViews).values({ agentId: agent.id, name: clean, query, position: n });
  revalidatePath("/", "layout");
  return { ok: `Saved “${clean}”` };
}

export async function deleteView(id: string): Promise<ActionState> {
  const { agent } = await requireAgent();
  await db.delete(savedViews).where(and(eq(savedViews.id, id), eq(savedViews.agentId, agent.id)));
  revalidatePath("/", "layout");
  return { ok: "View deleted" };
}

/** Turn my assignment / reply / mention emails on or off. */
export async function setNotifyEmail(on: boolean): Promise<ActionState> {
  const { agent } = await requireAgent();
  await db.update(agents).set({ notifyEmail: on }).where(eq(agents.id, agent.id));
  revalidatePath("/", "layout");
  return { ok: on ? "Notifications on" : "Notifications off" };
}

/** My colour theme in the portal. */
export async function setTheme(theme: string): Promise<ActionState> {
  const { agent } = await requireAgent();
  if (!isTheme(theme)) return { error: "Unknown theme" };
  await db.update(agents).set({ theme }).where(eq(agents.id, agent.id));
  revalidatePath("/", "layout");
  return { ok: "Theme saved" };
}

/** My reply signature, as HTML. Empty means the default block. */
export async function setSignature(html: string): Promise<ActionState> {
  const { agent } = await requireAgent();
  if (html.length > MAX_SIGNATURE_LENGTH)
    return { error: "That signature is too long. Link to a hosted image instead of embedding one." };
  const signature = cleanSignature(html);
  await db.update(agents).set({ signature }).where(eq(agents.id, agent.id));
  revalidatePath("/settings");
  revalidatePath("/admin/agents");
  return { ok: signature ? "Signature saved" : "Using the default signature" };
}

/**
 * Store an image for a signature: mine, or (admins only) another agent's.
 * Returns the src to put in the signature HTML.
 */
export async function uploadSignatureImage(input: {
  dataUrl: string;
  filename: string;
  agentId?: string;
}): Promise<ActionState & { src?: string }> {
  const { agent } = await requireAgent();
  const owner = input.agentId ?? agent.id;
  if (owner !== agent.id && agent.role !== "admin") return { error: "Admins only." };
  try {
    const { src } = await saveSignatureImage(owner, input.dataUrl, input.filename);
    return { ok: "Image added", src };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
