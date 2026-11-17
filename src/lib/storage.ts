import "server-only";
import { getCloudflareContext } from "@opennextjs/cloudflare";

/**
 * Attachment storage on Cloudflare R2, through the ATTACHMENTS bucket binding
 * declared in wrangler.jsonc. The bucket is private; files are only ever
 * served through /api/attachments/[id] to signed-in agents.
 *
 * The `attachments.blob_url` column holds the R2 object key.
 */
function bucket(): R2Bucket | null {
  try {
    return (getCloudflareContext().env as CloudflareEnv).ATTACHMENTS ?? null;
  } catch {
    // Plain Node (CLI scripts) or `next dev` without the binding.
    return null;
  }
}

export function storageConfigured(): boolean {
  return bucket() !== null;
}

/** Stores a file under `${prefix}/<random>/<filename>` and returns its key. */
export async function putFile(
  prefix: string,
  filename: string,
  body: Uint8Array,
  contentType: string,
): Promise<string> {
  const b = bucket();
  if (!b) throw new Error("ATTACHMENTS R2 bucket is not bound");
  const key = `${prefix}/${crypto.randomUUID()}/${filename}`;
  await b.put(key, body, { httpMetadata: { contentType } });
  return key;
}

export async function getFile(key: string): Promise<ReadableStream | null> {
  const b = bucket();
  if (!b) return null;
  const obj = await b.get(key);
  return obj?.body ?? null;
}
