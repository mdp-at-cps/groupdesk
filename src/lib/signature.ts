/**
 * Reply signatures. Each agent can save their own HTML signature (Settings, or
 * an admin on the Agents page); without one, replies end with the default
 * "-- / name / team" block. (The ticket number is already in the subject.)
 *
 * Pure functions: the settings page uses them for its live preview, and
 * sendReply for the real email.
 */

/** Plenty for a styled signature with a hosted logo; keeps rows small. */
export const MAX_SIGNATURE_LENGTH = 20_000;
/** Signature images, after the browser scales them to SIGNATURE_IMAGE_MAX_SIDE. */
export const SIGNATURE_IMAGE_MAX_BYTES = 1024 * 1024;
export const SIGNATURE_IMAGE_MAX_SIDE = 800;

/**
 * Drop anything active from HTML before it goes out or into the database.
 * The composer and signatures only need formatting, links and images.
 */
export function cleanHtml(html: string) {
  return html
    .replace(/<(script|style|iframe|object|embed|form)[\s\S]*?<\/\1>/gi, "")
    .replace(/<(script|style|iframe|object|embed|form|link|meta|base)[^>]*>/gi, "")
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*(["']?)\s*javascript:[^"'\s>]*/gi, "$1=$2#");
}

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** A signature as saved: cleaned, trimmed, and null when there's nothing left. */
export function cleanSignature(raw: string | null | undefined): string | null {
  const s = cleanHtml(raw ?? "")
    .replace(/<!doctype[^>]*>|<\/?(html|head|body)[^>]*>|<title>[\s\S]*?<\/title>/gi, "")
    .trim();
  return htmlToText(s) || /<img\b/i.test(s) ? s : null;
}

/** The signature block that ends a reply, as HTML and as plain text. */
export function signatureBlock(
  agent: { name: string; signature: string | null },
  teamName: string,
) {
  const sig = cleanSignature(agent.signature);
  if (!sig) {
    return {
      html: `<p style="margin-top:16px;color:#6b7280">--<br>${escapeHtml(agent.name)}<br>${escapeHtml(teamName)}</p>`,
      text: `--\n${agent.name}\n${teamName}`,
    };
  }
  return {
    html: `<div style="margin-top:16px">${sig}</div>`,
    text: `--\n${htmlToText(sig)}`,
  };
}

/** Readable plain text for the text/plain part: line breaks kept, tags gone. */
export function htmlToText(html: string) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
