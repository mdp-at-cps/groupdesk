import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { attachments, signatureImages } from "@/db/schema";
import { getFile, putFile, storageConfigured } from "@/lib/storage";
import type { InlineImage } from "@/lib/inline-images";
import { SIGNATURE_IMAGE_MAX_BYTES } from "@/lib/signature";

/**
 * Images in signatures. They're uploaded once to R2 and the signature HTML
 * refers to them as /api/signature-images/<id>, which the portal can show.
 * When a reply goes out they're attached inline (cid:), like images pasted
 * into the composer, so recipients see them without loading remote images.
 */

const TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
const MAX_PER_AGENT = 30;

/** /api/signature-images/<id>, optionally as a full URL on any host. */
const IMG_TAG = /<img\b[^>]*>/gi;
const SRC = /\bsrc=(["'])(?:https?:\/\/[^"'/]+)?\/api\/signature-images\/([0-9a-f-]{36})\1/i;

export async function saveSignatureImage(agentId: string, dataUrl: string, filename: string) {
  if (!storageConfigured()) throw new Error("Image storage isn't set up (the ATTACHMENTS R2 bucket).");
  const m = dataUrl.match(/^data:(image\/[a-z+.-]+);base64,([a-z0-9+/=\s]+)$/i);
  const type = m?.[1].toLowerCase();
  if (!m || !type || !TYPES[type]) throw new Error("Use a PNG, JPEG, GIF or WebP image.");
  const data = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
  if (data.byteLength > SIGNATURE_IMAGE_MAX_BYTES) throw new Error("That image is larger than 1 MB. Use a smaller one.");

  const [{ n }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(signatureImages)
    .where(eq(signatureImages.agentId, agentId));
  if (n >= MAX_PER_AGENT) throw new Error(`That's ${MAX_PER_AGENT} signature images already.`);

  const base = filename.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^\w .-]+/g, "").trim().slice(0, 60) || "image";
  const name = `${base}.${TYPES[type]}`;
  const key = await putFile(`signatures/${agentId}`, name, data, type);
  const [row] = await db
    .insert(signatureImages)
    .values({ agentId, filename: name, contentType: type, size: data.byteLength, blobUrl: key })
    .returning({ id: signatureImages.id });
  return { id: row.id, src: `/api/signature-images/${row.id}` };
}

export type ReusedImage = { contentId: string; filename: string; contentType: string; size: number; key: string };

/**
 * Point the signature's stored images at inline attachments. Images that
 * aren't this agent's, or whose file is gone, are dropped from the email.
 */
export async function inlineSignatureImages(agentId: string, html: string) {
  const ids = [...html.matchAll(IMG_TAG)].map((t) => t[0].match(SRC)?.[2]).filter((x): x is string => !!x);
  if (!ids.length) return { html, images: [] as InlineImage[], reused: [] as ReusedImage[] };

  const rows = await db
    .select()
    .from(signatureImages)
    .where(and(eq(signatureImages.agentId, agentId), inArray(signatureImages.id, [...new Set(ids)])));

  const images: InlineImage[] = [];
  const reused: ReusedImage[] = [];
  const cidFor = new Map<string, string>();
  for (const row of rows) {
    const stream = await getFile(row.blobUrl).catch(() => null);
    if (!stream) continue;
    const data = Buffer.from(await new Response(stream).arrayBuffer());
    const contentId = `${crypto.randomUUID()}@groupdesk`;
    cidFor.set(row.id, contentId);
    images.push({ contentId, filename: row.filename, contentType: row.contentType, data });
    reused.push({ contentId, filename: row.filename, contentType: row.contentType, size: row.size, key: row.blobUrl });
  }

  const out = html.replace(IMG_TAG, (tag) => {
    const m = tag.match(SRC);
    if (!m) return tag;
    const cid = cidFor.get(m[2]);
    return cid ? tag.replace(SRC, `src="cid:${cid}"`) : "";
  });
  return { html: out, images, reused };
}

/** The message's attachment rows for its signature images, pointing at the stored files. */
export async function recordSignatureImages(messageId: string, reused: ReusedImage[]) {
  if (!reused.length) return;
  await db.insert(attachments).values(
    reused.map((r) => ({
      messageId,
      filename: r.filename,
      contentType: r.contentType,
      size: r.size,
      blobUrl: r.key,
      contentId: r.contentId,
    })),
  );
}
