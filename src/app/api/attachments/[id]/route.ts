import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { getSession } from "@/lib/auth";
import { getFile } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Serves an email attachment from R2 to signed-in agents, so attachment
 * links never expose storage URLs.
 * Images and PDFs open in the browser; everything else downloads.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response("Not found", { status: 404 });
  const [att] = await db.select().from(attachments).where(eq(attachments.id, id)).limit(1);
  if (!att) return new Response("Not found", { status: 404 });

  const found = await getFile(att.blobUrl).catch(() => null);
  if (!found) return new Response("Attachment is no longer available", { status: 404 });

  const type = att.contentType || "application/octet-stream";
  const inline = /^(image\/|application\/pdf$|text\/plain$)/.test(type);
  const safeName = att.filename.replace(/["\\\r\n]/g, "_");
  return new Response(found, {
    headers: {
      "Content-Type": type,
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(att.filename)}`,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
      // Never let an attachment run as a page on our origin. (PDFs skip the
      // sandbox directive, which stops Chrome's built-in viewer from loading.)
      "Content-Security-Policy":
        type === "application/pdf"
          ? "default-src 'none'; object-src 'self'; plugin-types application/pdf"
          : "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}
