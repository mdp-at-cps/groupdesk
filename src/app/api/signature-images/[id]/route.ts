import { eq } from "drizzle-orm";
import { db } from "@/db";
import { signatureImages } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getFile } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * A signature image, for the portal (the Settings preview, the Agents page).
 * Emails never load this: replies carry the image inline.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [img] = await db.select().from(signatureImages).where(eq(signatureImages.id, id)).limit(1);
  if (!img) return new Response("Not found", { status: 404 });

  const found = await getFile(img.blobUrl).catch(() => null);
  if (!found) return new Response("Image is no longer available", { status: 404 });

  return new Response(found, {
    headers: {
      "Content-Type": img.contentType,
      "Content-Disposition": "inline",
      // The file behind an id never changes.
      "Cache-Control": "private, max-age=86400, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    },
  });
}
