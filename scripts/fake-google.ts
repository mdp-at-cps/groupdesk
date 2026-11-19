/*
 * A fake Google for `pnpm dev:local`: just enough of OAuth, the Gmail API and
 * the People directory for every email feature to run on one machine, plus a
 * small webmail ("the world") to act as requesters and agents.
 *
 *   - OAuth consent + token + revoke, so /admin/gmail → Connect works
 *   - Gmail: profile, messages.list/get/send, history.list, watch/stop,
 *     settings.sendAs.list, for the one mailbox (GMAIL_MAILBOX)
 *   - People: searchDirectoryPeople (names only, no photos)
 *   - The viewer at its root URL: read any address's mail, compose as anyone,
 *     reply in-thread, attach files
 *
 * Mail addressed to the mailbox or to GROUP_EMAIL is delivered into the
 * mailbox's INBOX, and the app is told to sync at once (through the reconcile
 * cron route, standing in for a Pub/Sub push). Everything lives in memory.
 *
 * Not covered: Pub/Sub push token verification (/api/gmail/push), which needs
 * tokens signed by Google.
 */
import http from "node:http";
import { randomBytes } from "node:crypto";
import PostalMime from "postal-mime";

export type FakeGoogleOptions = {
  port: number;
  mailbox: string;
  group: string;
  appUrl: string;
  cronSecret: string;
};

type Msg = {
  id: string;
  threadId: string;
  raw: Buffer;
  internalDate: number;
  from: string;
  fromName: string | null;
  to: string[];
  cc: string[];
  bcc: string[];
  subject: string;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  text: string;
  html: string | null;
  attachments: { filename: string; contentType: string; size: number }[];
  /** Set when the message is in GMAIL_MAILBOX. */
  labelIds: string[] | null;
  historyId: number | null;
};

type SendAsSetting = "verified" | "pending" | "missing";

const CRLF = "\r\n";

export function startFakeGoogle(opts: FakeGoogleOptions) {
  const mailbox = opts.mailbox.toLowerCase();
  const group = opts.group.toLowerCase();
  const base = `http://127.0.0.1:${opts.port}`;

  const all: Msg[] = [];
  const history: { id: number; message: Msg }[] = [];
  let historyId = 1000;
  let sendAs: SendAsSetting = "verified";
  let groupRewritesFrom = false;
  let lastSync = "";
  const known = new Set<string>([mailbox, group, "requester@example.com"]);
  const names = new Map<string, string>();

  const newId = () => randomBytes(8).toString("hex");

  /* ------------------------------------------------------------ storage */

  async function store(raw: Buffer, extra: { bcc?: string[]; threadId?: string; labelIds?: string[] | null }) {
    const parsed = await PostalMime.parse(raw);
    const addrs = (list?: { address?: string }[]) =>
      (list ?? []).map((a) => a.address?.toLowerCase()).filter((a): a is string => !!a);
    const header = (name: string) => parsed.headers.find((h) => h.key === name)?.value ?? null;

    const references = (header("references") ?? "").split(/\s+/).filter(Boolean);
    const inReplyTo = header("in-reply-to")?.trim() || null;

    let threadId = extra.threadId && all.some((m) => m.threadId === extra.threadId) ? extra.threadId : undefined;
    if (!threadId) {
      const related = new Set([inReplyTo, ...references].filter(Boolean));
      threadId = all.find((m) => related.has(m.messageId))?.threadId;
    }

    const msg: Msg = {
      id: newId(),
      threadId: threadId ?? newId(),
      raw,
      internalDate: parsed.date ? Date.parse(parsed.date) || Date.now() : Date.now(),
      from: parsed.from?.address?.toLowerCase() ?? "",
      fromName: parsed.from?.name || null,
      to: addrs(parsed.to),
      cc: addrs(parsed.cc),
      bcc: [...addrs(parsed.bcc), ...(extra.bcc ?? [])],
      subject: parsed.subject ?? "",
      messageId: parsed.messageId ?? "",
      inReplyTo,
      references,
      text: parsed.text ?? "",
      html: parsed.html ?? null,
      attachments: (parsed.attachments ?? []).map((a) => ({
        filename: a.filename ?? "attachment",
        contentType: a.mimeType,
        size: typeof a.content === "string" ? a.content.length : a.content.byteLength,
      })),
      labelIds: extra.labelIds ?? null,
      historyId: null,
    };
    if (msg.labelIds) {
      msg.historyId = ++historyId;
      history.push({ id: msg.historyId, message: msg });
    }
    all.push(msg);
    for (const a of [msg.from, ...msg.to, ...msg.cc, ...msg.bcc]) if (a) known.add(a);
    if (msg.fromName) names.set(msg.from, msg.fromName);
    return msg;
  }

  const recipients = (m: Msg) => [...m.to, ...m.cc, ...m.bcc];
  const reachesMailbox = (rcpts: string[]) => rcpts.includes(mailbox) || rcpts.includes(group);

  /** Call one of the app's /api/cron/* routes with CRON_SECRET. */
  async function runCron(route: string, label = route) {
    try {
      const res = await fetch(`${opts.appUrl}/api/cron/${route}`, {
        headers: { authorization: `Bearer ${opts.cronSecret}` },
      });
      const body = await res.text();
      lastSync = `${label}: ${res.ok ? "" : `failed (${res.status}) `}${body.slice(0, 400)}`;
    } catch (err) {
      lastSync = `${label}: failed: ${(err as Error).message}`;
    }
  }

  /** Tell the app new mail arrived (stands in for the Pub/Sub push). */
  const nudgeApp = () => runCron("gmail-reconcile", "App synced");

  const CRON_JOBS: Record<string, string> = {
    "gmail-watch": "Renew Gmail watch",
    "gmail-reconcile": "Catch-up sync",
    daily: "Daily (auto-solve)",
    "digest?force=1": "Weekly digest (forced)",
  };

  /** Mail sent by a person in the viewer. */
  async function deliverFromWorld(raw: Buffer, options: { notify?: boolean } = {}) {
    const parsed = await PostalMime.parse(raw);
    const rcpts = [...(parsed.to ?? []), ...(parsed.cc ?? []), ...(parsed.bcc ?? [])]
      .map((a) => a.address?.toLowerCase())
      .filter((a): a is string => !!a);
    let labels: string[] | null = null;
    let stored = raw;
    if (reachesMailbox(rcpts)) {
      labels = ["INBOX", "UNREAD"];
      if (rcpts.includes(group) && !rcpts.includes(mailbox)) stored = viaGroup(raw, parsed.from);
    }
    const msg = await store(stripHeader(stored, "bcc"), {
      bcc: (parsed.bcc ?? []).map((a) => a.address!.toLowerCase()).filter(Boolean),
      labelIds: labels,
    });
    if (labels && options.notify !== false) await nudgeApp();
    return msg;
  }

  /** What Google Groups adds when it relays a message to its members. */
  function viaGroup(raw: Buffer, from?: { address?: string; name?: string }) {
    let out = addHeaders(raw, {
      "List-Id": `<${group.replace("@", ".")}>`,
      "Mailing-list": `list ${group}; contact ${group.replace("@", "+owners@")}`,
      "X-Original-Sender": from?.address ?? "",
      "Delivered-To": mailbox,
    });
    if (groupRewritesFrom && from?.address) {
      const display = from.name || from.address.split("@")[0];
      out = stripHeader(stripHeader(out, "from"), "reply-to");
      out = addHeaders(out, {
        From: `"${display.replace(/"/g, "")} via ${group.split("@")[0]}" <${group}>`,
        "Reply-To": formatAddr(from.address, from.name),
        "X-Original-From": formatAddr(from.address, from.name),
      });
    }
    return out;
  }

  /** users.messages.send from the connected mailbox. */
  async function sendFromMailbox(raw: Buffer, threadId?: string) {
    const parsed = await PostalMime.parse(raw);
    let out = raw;
    if (!parsed.messageId) out = addHeaders(out, { "Message-ID": `<${newId()}.${Date.now()}@mail.gmail.com>` });
    if (!parsed.date) out = addHeaders(out, { Date: new Date().toUTCString().replace("GMT", "+0000") });

    // Gmail sends from the mailbox unless From is a verified alias.
    const fromAddr = parsed.from?.address?.toLowerCase();
    const aliasOk = fromAddr === mailbox || (fromAddr === group && sendAs === "verified");
    if (!aliasOk) {
      out = stripHeader(out, "from");
      out = addHeaders(out, { From: formatAddr(mailbox, parsed.from?.name) });
    }

    const bcc = (parsed.bcc ?? []).map((a) => a.address!.toLowerCase()).filter(Boolean);
    const rcpts = [...(parsed.to ?? []), ...(parsed.cc ?? [])]
      .map((a) => a.address?.toLowerCase())
      .filter((a): a is string => !!a)
      .concat(bcc);
    // Mail to yourself (or your own group) shows up as SENT + INBOX.
    const labels = reachesMailbox(rcpts) ? ["SENT", "INBOX"] : ["SENT"];
    return store(stripHeader(out, "bcc"), { bcc, threadId, labelIds: labels });
  }

  /* --------------------------------------------------------- gmail api */

  const inMailbox = () => all.filter((m) => m.labelIds);

  function matches(m: Msg, q: string) {
    const terms = q.match(/(-?\w+:"[^"]*"|-?\w+:\S+|"[^"]*"|\S+)/g) ?? [];
    for (const term of terms) {
      const neg = term.startsWith("-");
      const t = neg ? term.slice(1) : term;
      const [key, ...rest] = t.split(":");
      const val = rest.join(":").replace(/^"|"$/g, "").toLowerCase();
      let ok = true;
      if (rest.length === 0) {
        const word = t.replace(/^"|"$/g, "").toLowerCase();
        ok = `${m.subject}\n${m.text}`.toLowerCase().includes(word);
      } else if (key === "in" || key === "label") {
        ok = val === "anywhere" ? true : (m.labelIds ?? []).includes(val.toUpperCase());
      } else if (key === "newer_than") {
        const n = parseInt(val, 10);
        const unit = val.slice(-1);
        const ms = unit === "h" ? 3600e3 : unit === "m" ? 30 * 86400e3 : unit === "y" ? 365 * 86400e3 : 86400e3;
        ok = m.internalDate >= Date.now() - n * ms;
      } else if (key === "after" || key === "before") {
        const t0 = Date.parse(val.replaceAll("/", "-"));
        ok = Number.isNaN(t0) ? true : key === "after" ? m.internalDate >= t0 : m.internalDate < t0;
      } else if (key === "from") {
        ok = m.from.includes(val);
      } else if (key === "to" || key === "deliveredto" || key === "list") {
        ok = recipients(m).some((r) => r.includes(val));
      } else if (key === "subject") {
        ok = m.subject.toLowerCase().includes(val);
      }
      if (neg ? ok : !ok) return false;
    }
    return true;
  }

  function headersOf(m: Msg) {
    const head = m.raw.toString("utf8").split(/\r?\n\r?\n/)[0];
    const out: { name: string; value: string }[] = [];
    for (const line of head.split(/\r?\n/)) {
      if (/^[ \t]/.test(line) && out.length) out[out.length - 1].value += " " + line.trim();
      else {
        const i = line.indexOf(":");
        if (i > 0) out.push({ name: line.slice(0, i), value: line.slice(i + 1).trim() });
      }
    }
    return out;
  }

  function messageResource(m: Msg, format: string, wanted: string[]) {
    const base = { id: m.id, threadId: m.threadId, labelIds: m.labelIds ?? [], historyId: String(m.historyId), internalDate: String(m.internalDate), sizeEstimate: m.raw.length, snippet: m.text.slice(0, 120) };
    if (format === "raw") return { ...base, raw: m.raw.toString("base64url") };
    if (format === "minimal") return base;
    const lower = wanted.map((w) => w.toLowerCase());
    const headers = headersOf(m).filter((h) => !lower.length || lower.includes(h.name.toLowerCase()));
    return { ...base, payload: { mimeType: "message/rfc822", headers } };
  }

  /* ------------------------------------------------------------- oauth */

  const tokenFor = (kind: string, email: string) => `fake-${kind}.${Buffer.from(email).toString("base64url")}`;
  const emailOfToken = (token: string | undefined) => {
    const m = token?.match(/^fake-(?:access|refresh|code)\.(.+)$/);
    return m ? Buffer.from(m[1], "base64url").toString("utf8") : null;
  };
  const caller = (req: http.IncomingMessage) =>
    emailOfToken(req.headers.authorization?.replace(/^Bearer\s+/i, "")) ?? mailbox;

  /* ------------------------------------------------------------ server */

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", base);
    const path = url.pathname;
    const send = (status: number, body: unknown, type = "application/json") => {
      res.writeHead(status, { "content-type": type });
      res.end(typeof body === "string" ? body : JSON.stringify(body));
    };
    const notFound = (what = "Requested entity was not found.") =>
      send(404, { error: { code: 404, message: what, status: "NOT_FOUND" } });
    const readBody = async () => {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      return Buffer.concat(chunks);
    };
    const asRequest = async () =>
      new Request(url, { method: req.method, headers: req.headers as HeadersInit, body: await readBody() });

    try {
      /* OAuth */
      if (path === "/o/oauth2/v2/auth") {
        return send(200, consentPage(url.searchParams), "text/html; charset=utf-8");
      }
      if (path === "/o/oauth2/v2/approve") {
        const back = new URL(url.searchParams.get("redirect_uri") ?? opts.appUrl);
        const state = url.searchParams.get("state");
        if (state) back.searchParams.set("state", state);
        if (url.searchParams.get("deny")) back.searchParams.set("error", "access_denied");
        else {
          const who = (url.searchParams.get("account") || mailbox).trim().toLowerCase();
          back.searchParams.set("code", tokenFor("code", who));
          back.searchParams.set("scope", url.searchParams.get("scope") ?? "");
        }
        res.writeHead(302, { location: back.toString() });
        return res.end();
      }
      if (path === "/token" && req.method === "POST") {
        const form = new URLSearchParams((await readBody()).toString("utf8"));
        const grant = form.get("grant_type");
        const who = emailOfToken(form.get(grant === "refresh_token" ? "refresh_token" : "code") ?? "");
        if (!who) return send(400, { error: "invalid_grant" });
        return send(200, {
          access_token: tokenFor("access", who),
          ...(grant === "authorization_code" ? { refresh_token: tokenFor("refresh", who) } : {}),
          expires_in: 3600,
          token_type: "Bearer",
          scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/directory.readonly",
        });
      }
      if (path === "/revoke") return send(200, {});

      /* People directory */
      if (path === "/v1/people:searchDirectoryPeople") {
        const q = (url.searchParams.get("query") ?? "").toLowerCase();
        const name = names.get(q) ?? q.split("@")[0].replace(/[._-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        return send(200, q ? { people: [{ names: [{ displayName: name }] }] } : {});
      }

      /* Gmail */
      const g = path.match(/^\/gmail\/v1\/users\/([^/]+)(\/.*)?$/);
      if (g) {
        const user = decodeURIComponent(g[1]).toLowerCase();
        const who = caller(req);
        if (user !== "me" && user !== who) return send(403, { error: { code: 403, message: "Delegation denied" } });
        const rest = g[2] ?? "";
        // Any account can sign in and read its (empty) profile, so the app's
        // "wrong mailbox" check can be exercised; only GMAIL_MAILBOX has mail.
        if (who !== mailbox) {
          if (rest === "/profile") return send(200, { emailAddress: who, messagesTotal: 0, threadsTotal: 0, historyId: "1" });
          return send(400, { error: { code: 400, message: `Fake Gmail only has mail for ${mailbox}` } });
        }

        if (rest === "/profile") {
          return send(200, { emailAddress: mailbox, messagesTotal: inMailbox().length, threadsTotal: new Set(inMailbox().map((m) => m.threadId)).size, historyId: String(historyId) });
        }
        if (rest === "/messages" && req.method === "GET") {
          const q = url.searchParams.get("q") ?? "";
          const list = inMailbox().filter((m) => matches(m, q)).sort((a, b) => b.internalDate - a.internalDate);
          return send(200, { messages: list.map((m) => ({ id: m.id, threadId: m.threadId })), resultSizeEstimate: list.length });
        }
        if (rest === "/messages/send" && req.method === "POST") {
          const body = JSON.parse((await readBody()).toString("utf8") || "{}");
          if (!body.raw) return send(400, { error: { code: 400, message: "raw is required" } });
          const msg = await sendFromMailbox(Buffer.from(body.raw, "base64url"), body.threadId);
          return send(200, { id: msg.id, threadId: msg.threadId, labelIds: msg.labelIds });
        }
        const one = rest.match(/^\/messages\/([^/]+)$/);
        if (one && req.method === "GET") {
          const m = inMailbox().find((x) => x.id === one[1]);
          if (!m) return notFound();
          return send(200, messageResource(m, url.searchParams.get("format") ?? "full", url.searchParams.getAll("metadataHeaders")));
        }
        if (rest === "/history") {
          const start = Number(url.searchParams.get("startHistoryId"));
          if (!start || start < 1000) return notFound("Invalid startHistoryId");
          const entries = history
            .filter((h) => h.id > start)
            .map((h) => ({ id: String(h.id), messagesAdded: [{ message: { id: h.message.id, threadId: h.message.threadId, labelIds: h.message.labelIds } }] }));
          return send(200, { ...(entries.length ? { history: entries } : {}), historyId: String(historyId) });
        }
        if (rest === "/watch") return send(200, { historyId: String(historyId), expiration: String(Date.now() + 7 * 86400e3) });
        if (rest === "/stop") {
          res.writeHead(204);
          return res.end();
        }
        if (rest === "/settings/sendAs") {
          const list: object[] = [{ sendAsEmail: mailbox, isPrimary: true, isDefault: true }];
          if (sendAs !== "missing") list.push({ sendAsEmail: group, displayName: "", verificationStatus: sendAs === "verified" ? "accepted" : "pending" });
          return send(200, { sendAs: list });
        }
        return notFound(`Fake Gmail doesn't implement ${req.method} ${rest}`);
      }

      /* JSON helpers for scripted tests */
      if (path === "/_fake/send" && req.method === "POST") {
        const body = JSON.parse((await readBody()).toString("utf8"));
        // Backdated mail is "old" mail the watch never saw: no history entry.
        const msg = await deliverFromWorld(buildRaw(body), { notify: !body.date });
        if (body.date && msg.historyId) {
          const i = history.findIndex((h) => h.id === msg.historyId);
          if (i >= 0) history.splice(i, 1);
        }
        return send(200, { id: msg.id, threadId: msg.threadId, messageId: msg.messageId, sync: lastSync });
      }
      if (path === "/_fake/messages") {
        const forAddr = url.searchParams.get("for")?.toLowerCase();
        const list = (forAddr ? mailFor(forAddr) : all).map(({ raw: _raw, ...m }) => m);
        return send(200, list);
      }

      /* Viewer */
      if (path === "/settings" && req.method === "POST") {
        const form = await (await asRequest()).formData();
        const v = String(form.get("sendAs") ?? sendAs);
        if (v === "verified" || v === "pending" || v === "missing") sendAs = v;
        groupRewritesFrom = form.get("rewrite") === "on";
        res.writeHead(303, { location: String(form.get("back") || "/") });
        return res.end();
      }
      if (path === "/cron" && req.method === "POST") {
        const form = await (await asRequest()).formData();
        const job = String(form.get("job") ?? "");
        if (CRON_JOBS[job]) await runCron(job, CRON_JOBS[job]);
        res.writeHead(303, { location: String(form.get("back") || "/") });
        return res.end();
      }
      if (path === "/compose" && req.method === "POST") {
        const form = await (await asRequest()).formData();
        const files = form.getAll("files").filter((f): f is File => typeof f !== "string" && f.size > 0);
        const raw = buildRaw({
          from: String(form.get("from")),
          fromName: String(form.get("fromName") ?? "") || undefined,
          to: String(form.get("to") ?? ""),
          cc: String(form.get("cc") ?? ""),
          subject: String(form.get("subject") ?? ""),
          text: String(form.get("text") ?? ""),
          inReplyTo: String(form.get("inReplyTo") ?? "") || undefined,
          references: String(form.get("references") ?? "") || undefined,
          attachments: await Promise.all(
            files.map(async (f) => ({ filename: f.name, contentType: f.type || "application/octet-stream", base64: Buffer.from(await f.arrayBuffer()).toString("base64") })),
          ),
        });
        const msg = await deliverFromWorld(raw);
        const as = String(form.get("from")).toLowerCase();
        res.writeHead(303, { location: `/message/${msg.id}?as=${encodeURIComponent(as)}` });
        return res.end();
      }
      // Inline images (cid:) of a message, for the viewer's iframe.
      const part = path.match(/^\/part\/([^/]+)\/(.+)$/);
      if (part) {
        const m = all.find((x) => x.id === part[1]);
        const cid = decodeURIComponent(part[2]).replace(/^<|>$/g, "");
        const parsed = m ? await PostalMime.parse(m.raw) : null;
        const att = parsed?.attachments.find((a) => a.contentId?.replace(/^<|>$/g, "") === cid);
        if (!att) return send(404, "Not found", "text/plain");
        res.writeHead(200, { "content-type": att.mimeType });
        return res.end(typeof att.content === "string" ? att.content : new Uint8Array(att.content));
      }
      const view = path.match(/^\/message\/([^/]+)$/);
      if (view) {
        const m = all.find((x) => x.id === view[1]);
        if (!m) return send(404, "Not found", "text/plain");
        return send(200, messagePage(m, url.searchParams.get("as") ?? ""), "text/html; charset=utf-8");
      }
      if (path === "/") {
        return send(200, homePage(url.searchParams), "text/html; charset=utf-8");
      }
      return send(404, "Not found", "text/plain");
    } catch (err) {
      console.error("fake google:", err);
      send(500, { error: { code: 500, message: (err as Error).message } });
    }
  });

  /* ------------------------------------------------------------ views */

  function mailFor(addr: string) {
    const list = addr === mailbox ? inMailbox() : all.filter((m) => m.from === addr || recipients(m).includes(addr));
    return [...list].sort((a, b) => b.internalDate - a.internalDate);
  }

  function layout(title: string, body: string) {
    return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{color-scheme:light dark;--bg:#fff;--fg:#1f2328;--muted:#6b7280;--line:#e5e7eb;--accent:#2563eb;--chip:#f3f4f6}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--fg:#e6e6e6;--muted:#9aa0a6;--line:#2a2e36;--accent:#7aa2ff;--chip:#1c2028}}
*{box-sizing:border-box}body{margin:0;font:14px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
header{padding:12px 16px;border-bottom:1px solid var(--line);display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header b{font-size:15px}main{display:grid;grid-template-columns:240px 1fr;min-height:calc(100vh - 50px)}
@media (max-width:760px){main{grid-template-columns:1fr}}
nav{border-right:1px solid var(--line);padding:12px}nav a{display:block;padding:4px 8px;border-radius:6px;color:inherit;text-decoration:none;overflow:hidden;text-overflow:ellipsis}
nav a.on{background:var(--chip);font-weight:600}section{padding:16px;min-width:0}
a{color:var(--accent)}.muted{color:var(--muted)}.chip{background:var(--chip);border-radius:4px;padding:0 6px;font-size:12px;margin-left:4px}
table{width:100%;border-collapse:collapse}td{padding:6px 8px;border-bottom:1px solid var(--line);vertical-align:top}
tr:hover td{background:var(--chip)}td.subj{width:55%}
form.compose{display:grid;gap:6px;max-width:720px;margin:16px 0}form.compose input,form.compose textarea{width:100%;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:var(--bg);color:inherit;font:inherit}
button{padding:6px 12px;border-radius:6px;border:1px solid var(--line);background:var(--accent);color:#fff;font:inherit;cursor:pointer;justify-self:start}
iframe{width:100%;min-height:360px;border:1px solid var(--line);border-radius:6px;background:#fff}
pre{white-space:pre-wrap;background:var(--chip);padding:12px;border-radius:6px;overflow:auto}
.note{background:var(--chip);padding:8px 12px;border-radius:6px;margin-bottom:12px;font-size:13px;overflow-wrap:anywhere}
.cron{display:flex;flex-wrap:wrap;gap:6px;margin-top:16px}.cron button{background:transparent;color:inherit;font-size:12px;padding:4px 8px}
</style></head><body>${body}</body></html>`;
  }

  function headerBar(back: string) {
    return `<header><b>Fake Gmail</b><span class="muted">mailbox ${esc(mailbox)} · group ${esc(group)}</span>
<form method="post" action="/settings" style="display:flex;gap:8px;align-items:center;margin-left:auto">
<input type="hidden" name="back" value="${esc(back)}">
<label>Send-as alias <select name="sendAs" onchange="this.form.submit()">${(["verified", "pending", "missing"] as const).map((v) => `<option ${v === sendAs ? "selected" : ""}>${v}</option>`).join("")}</select></label>
<label><input type="checkbox" name="rewrite" ${groupRewritesFrom ? "checked" : ""} onchange="this.form.submit()"> Group rewrites From ("via")</label>
</form></header>`;
  }

  function sidebar(current: string) {
    const list = [...known].sort((a, b) => (a === mailbox ? -1 : b === mailbox ? 1 : a === group ? -1 : b === group ? 1 : a.localeCompare(b)));
    return `<nav><div class="muted" style="margin-bottom:6px">View mail as</div>${list
      .map((a) => `<a class="${a === current ? "on" : ""}" href="/?as=${encodeURIComponent(a)}">${esc(a)}${a === mailbox ? '<span class="chip">mailbox</span>' : a === group ? '<span class="chip">group</span>' : ""}</a>`)
      .join("")}<form action="/" style="margin-top:12px"><input name="as" placeholder="another address" style="width:100%;padding:4px 6px"></form>
<form method="post" action="/cron"><input type="hidden" name="back" value="/?as=${encodeURIComponent(current)}"><div class="muted" style="margin-top:16px">Run a scheduled job</div><div class="cron">${Object.entries(CRON_JOBS)
      .map(([job, label]) => `<button name="job" value="${esc(job)}">${esc(label)}</button>`)
      .join("")}</div></form></nav>`;
  }

  function homePage(params: URLSearchParams) {
    const as = (params.get("as") ?? "requester@example.com").toLowerCase();
    known.add(as);
    const list = mailFor(as);
    const rows = list
      .map(
        (m) => `<tr><td>${esc(m.fromName ?? m.from)}<div class="muted">${esc(m.from)}</div></td><td class="subj"><a href="/message/${m.id}?as=${encodeURIComponent(as)}">${esc(m.subject || "(no subject)")}</a>${(m.labelIds ?? []).filter((l) => l !== "UNREAD").map((l) => `<span class="chip">${l}</span>`).join("")}${m.attachments.length ? `<span class="chip">📎 ${m.attachments.length}</span>` : ""}<div class="muted">to ${esc([...m.to, ...m.cc].join(", "))}</div></td><td class="muted">${new Date(m.internalDate).toLocaleString()}</td></tr>`,
      )
      .join("");
    const isPerson = as !== mailbox && as !== group;
    return layout(
      `Fake Gmail – ${as}`,
      headerBar(`/?as=${encodeURIComponent(as)}`) +
        `<main>${sidebar(as)}<section>
${lastSync ? `<div class="note">${esc(lastSync)}</div>` : ""}
${as === mailbox ? `<div class="note">This is the connected mailbox, as the app sees it through the Gmail API. Connect it at <a href="${esc(opts.appUrl)}/admin/gmail" target="_blank">/admin/gmail</a> first, or incoming mail can't sync.</div>` : ""}
<h3 style="margin:0 0 8px">${esc(as)}</h3>
${list.length ? `<table>${rows}</table>` : `<p class="muted">No mail yet.</p>`}
${isPerson ? composeForm({ from: as, to: group }) : ""}
</section></main>`,
    );
  }

  function composeForm(p: { from: string; fromName?: string; to: string; cc?: string; subject?: string; inReplyTo?: string; references?: string; quote?: string }) {
    return `<form class="compose" method="post" action="/compose" enctype="multipart/form-data">
<h4 style="margin:0">${p.inReplyTo ? "Reply" : "New email"} as ${esc(p.from)}</h4>
<input type="hidden" name="from" value="${esc(p.from)}">
<input type="hidden" name="inReplyTo" value="${esc(p.inReplyTo ?? "")}"><input type="hidden" name="references" value="${esc(p.references ?? "")}">
<input name="fromName" placeholder="Your name (optional)" value="${esc(p.fromName ?? names.get(p.from) ?? "")}">
<input name="to" placeholder="To" value="${esc(p.to)}" required>
<input name="cc" placeholder="Cc" value="${esc(p.cc ?? "")}">
<input name="subject" placeholder="Subject" value="${esc(p.subject ?? "")}">
<textarea name="text" rows="6" placeholder="Message">${p.quote ? "\n\n" + esc(p.quote) : ""}</textarea>
<input type="file" name="files" multiple>
<button>Send</button></form>`;
  }

  function messagePage(m: Msg, asParam: string) {
    const as = (asParam || m.to[0] || m.from).toLowerCase();
    const replyTo = headersOf(m).find((h) => h.name.toLowerCase() === "reply-to")?.value;
    const replyAddr = (replyTo?.match(/<([^>]+)>/)?.[1] ?? replyTo ?? m.from).toLowerCase();
    const canReply = as !== mailbox && as !== group;
    const replyAll = [...new Set([...m.to, ...m.cc].filter((a) => a !== as && a !== replyAddr))];
    const quote = m.text
      .split("\n")
      .slice(0, 40)
      .map((l) => `> ${l}`)
      .join("\n");
    return layout(
      m.subject,
      headerBar(`/message/${m.id}?as=${encodeURIComponent(as)}`) +
        `<main>${sidebar(as)}<section>
${lastSync ? `<div class="note">${esc(lastSync)}</div>` : ""}
<p><a href="/?as=${encodeURIComponent(as)}">← ${esc(as)}</a></p>
<h3 style="margin:0">${esc(m.subject || "(no subject)")}</h3>
<p class="muted">From ${esc(m.fromName ? `${m.fromName} <${m.from}>` : m.from)}<br>To ${esc(m.to.join(", "))}${m.cc.length ? `<br>Cc ${esc(m.cc.join(", "))}` : ""}${m.bcc.length ? `<br>Bcc ${esc(m.bcc.join(", "))}` : ""}<br>${new Date(m.internalDate).toLocaleString()} · thread ${m.threadId}${m.labelIds ? ` · labels ${m.labelIds.join(", ")}` : ""}</p>
${m.attachments.length ? `<p>Attachments: ${m.attachments.map((a) => `${esc(a.filename)} <span class="muted">(${esc(a.contentType)}, ${a.size} B)</span>`).join(", ")}</p>` : ""}
${m.html ? `<iframe sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" srcdoc="${esc(`<base target="_blank">${m.html.replace(/cid:([^"'\s)>]+)/gi, (_w, id: string) => `${base}/part/${m.id}/${encodeURIComponent(id)}`)}`)}"></iframe>` : `<pre>${esc(m.text)}</pre>`}
<details><summary class="muted">Headers</summary><pre>${esc(headersOf(m).map((h) => `${h.name}: ${h.value}`).join("\n"))}</pre></details>
${canReply ? composeForm({ from: as, to: replyAddr, cc: replyAll.join(", "), subject: /^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`, inReplyTo: m.messageId, references: [...m.references, m.messageId].filter(Boolean).join(" "), quote }) : ""}
</section></main>`,
    );
  }

  function consentPage(params: URLSearchParams) {
    const hint = params.get("login_hint") ?? mailbox;
    const hidden = ["redirect_uri", "state", "scope"].map((k) => `<input type="hidden" name="${k}" value="${esc(params.get(k) ?? "")}">`).join("");
    return layout(
      "Sign in – Fake Google",
      `<section style="max-width:460px;margin:48px auto">
<h2>Fake Google sign-in</h2>
<p class="muted">The app asks for: ${esc((params.get("scope") ?? "").split(" ").map((s) => s.split("/").pop()).join(", "))}</p>
<form class="compose" action="/o/oauth2/v2/approve">${hidden}
<label>Account <input name="account" value="${esc(hint)}"></label>
<div style="display:flex;gap:8px"><button>Allow</button><button name="deny" value="1" style="background:transparent;color:inherit">Deny</button></div>
</form><p class="muted">Use a different account to check that the app refuses mailboxes other than GMAIL_MAILBOX.</p></section>`,
    );
  }

  return new Promise<http.Server>((resolve) => server.listen(opts.port, "127.0.0.1", () => resolve(server)));
}

/* --------------------------------------------------------------- MIME */

type Compose = {
  from: string;
  fromName?: string;
  to: string;
  cc?: string;
  subject?: string;
  text?: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
  /** Backdate the message (ISO date), e.g. to test the backfill. */
  date?: string;
  attachments?: { filename: string; contentType: string; base64: string }[];
};

function list(s?: string) {
  return (s ?? "")
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function encodeWord(s: string) {
  return /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s, "utf8").toString("base64")}?=`;
}

function formatAddr(address: string, name?: string | null) {
  return name ? `"${encodeWord(name).replace(/"/g, "")}" <${address}>` : address;
}

function b64lines(buf: Buffer) {
  return (buf.toString("base64").match(/.{1,76}/g) ?? []).join(CRLF);
}

export function buildRaw(c: Compose): Buffer {
  const boundary = (tag: string) => `----fake-${tag}-${randomBytes(6).toString("hex")}`;
  const headers = [
    `From: ${formatAddr(c.from, c.fromName)}`,
    `To: ${list(c.to).join(", ")}`,
    ...(list(c.cc).length ? [`Cc: ${list(c.cc).join(", ")}`] : []),
    `Subject: ${encodeWord(c.subject ?? "")}`,
    `Date: ${(c.date ? new Date(c.date) : new Date()).toUTCString().replace("GMT", "+0000")}`,
    `Message-ID: <${randomBytes(10).toString("hex")}@fake.example>`,
    ...(c.inReplyTo ? [`In-Reply-To: ${c.inReplyTo}`] : []),
    ...(c.references ? [`References: ${c.references}`] : []),
    "MIME-Version: 1.0",
  ];
  const textPart = [`Content-Type: text/plain; charset=utf-8`, `Content-Transfer-Encoding: base64`, "", b64lines(Buffer.from(c.text ?? "", "utf8"))].join(CRLF);
  let body: string;
  let bodyType: string;
  if (c.html) {
    const alt = boundary("alt");
    const htmlPart = [`Content-Type: text/html; charset=utf-8`, `Content-Transfer-Encoding: base64`, "", b64lines(Buffer.from(c.html, "utf8"))].join(CRLF);
    bodyType = `multipart/alternative; boundary="${alt}"`;
    body = [`--${alt}`, textPart, `--${alt}`, htmlPart, `--${alt}--`, ""].join(CRLF);
  } else {
    bodyType = "";
    body = textPart;
  }
  const files = c.attachments ?? [];
  if (!files.length) {
    if (bodyType) return Buffer.from([...headers, `Content-Type: ${bodyType}`, "", body].join(CRLF));
    return Buffer.from([...headers, textPart].join(CRLF));
  }
  const mixed = boundary("mixed");
  const parts = [bodyType ? `Content-Type: ${bodyType}${CRLF}${CRLF}${body}` : textPart];
  for (const f of files) {
    parts.push(
      [
        `Content-Type: ${f.contentType}; name="${f.filename.replace(/"/g, "")}"`,
        `Content-Disposition: attachment; filename="${f.filename.replace(/"/g, "")}"`,
        "Content-Transfer-Encoding: base64",
        "",
        b64lines(Buffer.from(f.base64, "base64")),
      ].join(CRLF),
    );
  }
  return Buffer.from(
    [...headers, `Content-Type: multipart/mixed; boundary="${mixed}"`, "", ...parts.flatMap((p) => [`--${mixed}`, p]), `--${mixed}--`, ""].join(CRLF),
  );
}

/* ----------------------------------------------------- header surgery */

function splitHead(raw: Buffer) {
  const s = raw.toString("latin1");
  const m = s.match(/\r?\n\r?\n/);
  const i = m?.index ?? s.length;
  return { head: s.slice(0, i), rest: s.slice(i), nl: s.includes("\r\n") ? "\r\n" : "\n" };
}

function stripHeader(raw: Buffer, name: string) {
  const { head, rest, nl } = splitHead(raw);
  const lines = head.split(/\r?\n/);
  const out: string[] = [];
  let skipping = false;
  for (const line of lines) {
    if (/^[ \t]/.test(line)) {
      if (!skipping) out.push(line);
      continue;
    }
    skipping = line.toLowerCase().startsWith(`${name.toLowerCase()}:`);
    if (!skipping) out.push(line);
  }
  return Buffer.from(out.join(nl) + rest, "latin1");
}

function addHeaders(raw: Buffer, headers: Record<string, string>) {
  const { head, rest, nl } = splitHead(raw);
  const extra = Object.entries(headers)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}: ${v}`)
    .join(nl);
  return Buffer.from(extra + nl + head + rest, "latin1");
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
