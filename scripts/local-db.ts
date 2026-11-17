/*
 * `pnpm dev:local`: a throwaway local preview with no external services.
 *
 * Starts a real, throwaway Postgres (embedded-postgres, in a temp folder),
 * puts a small WebSocket-to-TCP proxy in front of it (the Neon driver only
 * speaks WebSocket), migrates and seeds it, starts the fake Google from
 * scripts/fake-google.ts, then runs `next dev` signed in as the admin through
 * DEV_BYPASS_EMAIL. Everything is discarded on exit.
 */
import "./load-env";
import { spawn, type ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import net from "node:net";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";
import { WebSocketServer } from "ws";
import { startFakeGoogle } from "./fake-google";

const PG_PORT = Number(process.env.LOCAL_PG_PORT) || 54329;
const WS_PORT = Number(process.env.LOCAL_WS_PORT) || 54330;
const GOOGLE_PORT = Number(process.env.LOCAL_GOOGLE_PORT) || 54340;
// Set LOCAL_REAL_GOOGLE=1 (with real Google values in .env.local) to skip the fake.
const FAKE_GOOGLE = process.env.LOCAL_REAL_GOOGLE !== "1";
const ADMIN = process.env.SEED_ADMIN_EMAIL || process.env.DEV_BYPASS_EMAIL || "admin@example.org";

async function main() {
  // A run that was killed (not stopped) leaves its folder behind; Postgres
  // itself exits with it. Clear those out before starting a new one.
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith("groupdesk-pg-")) continue;
    const pid = Number(readFileSafe(path.join(tmpdir(), name, "postmaster.pid")).split("\n")[0]);
    if (!pid || !alive(pid)) rmSync(path.join(tmpdir(), name), { recursive: true, force: true });
  }
  const dataDir = mkdtempSync(path.join(tmpdir(), "groupdesk-pg-"));
  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    port: PG_PORT,
    user: "postgres",
    password: "postgres",
    persistent: false,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  console.log(`local db: postgres running on 127.0.0.1:${PG_PORT} (throwaway)`);

  // Neon's driver opens ws://<proxy>/v2?address=host:port and streams the
  // Postgres wire protocol over it; forward each socket to Postgres over TCP.
  const wss = new WebSocketServer({ host: "127.0.0.1", port: WS_PORT });
  wss.on("connection", (socket, req) => {
    if (process.env.LOCAL_DB_DEBUG) console.log("local db proxy: connect", req.url);
    const address = new URL(req.url ?? "/", "http://x").searchParams.get("address") ?? "";
    const [host, port] = address.split(":");
    const tcp = net.connect(Number(port) || PG_PORT, host || "127.0.0.1");
    const pending: Buffer[] = [];
    let open = false;
    tcp.on("connect", () => {
      open = true;
      for (const chunk of pending) tcp.write(chunk);
      pending.length = 0;
    });
    socket.on("message", (data) => {
      const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);
      if (open) tcp.write(chunk);
      else pending.push(chunk);
    });
    tcp.on("data", (chunk) => socket.send(chunk));
    tcp.on("close", () => socket.close());
    tcp.on("error", (err) => {
      console.error("local db proxy:", err.message);
      socket.close();
    });
    socket.on("close", () => tcp.destroy());
    socket.on("error", () => tcp.destroy());
  });

  // Placeholders so pages render without Google set up; .env.local wins.
  const placeholders: Record<string, string> = {
    GMAIL_MAILBOX: ADMIN,
    GROUP_EMAIL: "help@example.org",
    GOOGLE_CLIENT_ID: "local-preview",
    GOOGLE_CLIENT_SECRET: "local-preview",
    GMAIL_PUBSUB_TOPIC: "projects/local/topics/local",
    GMAIL_PUSH_SA_EMAIL: "local@example.org",
    TOKEN_ENC_KEY: randomBytes(32).toString("base64"),
    CRON_SECRET: randomBytes(32).toString("base64url"),
    SESSION_SECRET: randomBytes(32).toString("base64url"),
    ALERT_EMAIL_TO: "alerts@example.org",
  };
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(placeholders)) env[k] ||= v;
  Object.assign(env, {
    DATABASE_URL: `postgres://postgres:postgres@127.0.0.1:${PG_PORT}/postgres`,
    LOCAL_DB_WS_PROXY: `127.0.0.1:${WS_PORT}`,
    DEV_BYPASS_EMAIL: ADMIN,
    SEED_ADMIN_EMAIL: ADMIN,
  });

  let fakeGoogle: { close(): void } | null = null;
  if (FAKE_GOOGLE) {
    env.GOOGLE_API_ROOT = `http://127.0.0.1:${GOOGLE_PORT}`;
    fakeGoogle = await startFakeGoogle({
      port: GOOGLE_PORT,
      mailbox: env.GMAIL_MAILBOX!,
      group: env.GROUP_EMAIL!,
      appUrl: (env.APP_URL || "http://localhost:3000").replace(/\/+$/, ""),
      cronSecret: env.CRON_SECRET!,
    });
    console.log(`fake google: mail viewer at http://localhost:${GOOGLE_PORT}`);
  }

  // Async on purpose: this process hosts the proxy, so it must keep serving
  // while the scripts talk to the database through it.
  const run = (script: string) =>
    new Promise<void>((resolve, reject) =>
      spawn("node_modules/.bin/tsx", [script], { env, stdio: "inherit" }).on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error(`${script} failed`)),
      ),
    );
  await run("scripts/migrate.ts");
  await run("scripts/seed.ts");
  console.log(`local db: seeded; signed in as ${ADMIN}`);

  const next: ChildProcess = spawn("node_modules/.bin/next", ["dev", ...process.argv.slice(2)], {
    env,
    stdio: "inherit",
  });
  const stop = async () => {
    next.kill("SIGTERM");
    wss.close();
    fakeGoogle?.close();
    await pg.stop().catch(() => {});
    rmSync(dataDir, { recursive: true, force: true });
    process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  next.on("exit", stop);
}

function readFileSafe(file: string) {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
