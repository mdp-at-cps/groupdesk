import "server-only";
import { db } from "@/db";
import { attachments } from "@/db/schema";
import { putFile, storageConfigured } from "@/lib/storage";

/**
 * Images pasted, dropped or picked in the composer arrive in its HTML as
 * `data:` URLs. Before a reply is sent or a note saved, each one becomes an
 * inline attachment with a Content-ID and the HTML points at `cid:` instead,
 * which is how mail clients expect inline images and how the portal already
 * renders inbound ones (src/lib/queries.ts maps cid: to /api/attachments).
 */
export type InlineImage = {
  contentId: string;
  filename: string;
  contentType: string;
  data: Buffer;
};

const TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};
/** Per image, after the composer has downscaled it. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
/** Gmail rejects messages over 25 MB; base64 adds a third. */
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const MAX_IMAGES = 20;

export function extractInlineImages(html: string | null): { html: string | null; images: InlineImage[] } {
  if (!html || !/<img\b[^>]*\bsrc=["']data:/i.test(html)) return { html, images: [] };
  const images: InlineImage[] = [];
  let total = 0;

  const out = html.replace(/<img\b[^>]*>/gi, (tag) => {
    const src = tag.match(/\bsrc=(["'])(data:[^"']*)\1/i)?.[2];
    if (!src) return tag;
    const m = src.match(/^data:(image\/[a-z+.-]+);base64,([a-z0-9+/=\s]+)$/i);
    const type = m?.[1].toLowerCase();
    // Anything else (SVG, odd encodings) is dropped rather than sent.
    if (!m || !type || !TYPES[type]) return "";

    const data = Buffer.from(m[2].replace(/\s+/g, ""), "base64");
    if (data.byteLength > MAX_IMAGE_BYTES) throw new Error("An image is larger than 5 MB. Use a smaller one.");
    total += data.byteLength;
    if (total > MAX_TOTAL_BYTES) throw new Error("The images add up to more than 15 MB. Remove some.");
    if (images.length >= MAX_IMAGES) throw new Error(`Add at most ${MAX_IMAGES} images to one message.`);

    const alt = decodeEntities(tag.match(/\balt=(["'])(.*?)\1/i)?.[2] ?? "");
    const base = alt.replace(/\.[a-z0-9]{2,5}$/i, "").replace(/[^\w .-]+/g, "").trim().slice(0, 60) || `image-${images.length + 1}`;
    const contentId = `${crypto.randomUUID()}@groupdesk`;
    images.push({ contentId, filename: `${base}.${TYPES[type]}`, contentType: type, data });

    const altAttr = alt ? ` alt="${escapeAttr(alt)}"` : "";
    return `<img src="cid:${contentId}"${altAttr} style="max-width:100%;height:auto">`;
  });

  return { html: out, images };
}

/** Saves the images as the message's inline attachments, so the portal shows them. */
export async function storeInlineImages(messageId: string, images: InlineImage[]) {
  if (!images.length || !storageConfigured()) return;
  for (const img of images) {
    try {
      const key = await putFile(`messages/${messageId}`, img.filename, img.data, img.contentType);
      await db.insert(attachments).values({
        messageId,
        filename: img.filename,
        contentType: img.contentType,
        size: img.data.byteLength,
        blobUrl: key,
        contentId: img.contentId,
      });
    } catch (err) {
      // The email already went out with the image; only the portal copy is missing.
      console.error("inline image upload failed", err);
    }
  }
}

function decodeEntities(s: string) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function escapeAttr(s: string) {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}
