import "server-only";
import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle, type NeonDatabase } from "drizzle-orm/neon-serverless";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import ws from "ws";
import * as schema from "./schema";
import "./local-proxy";

// The WebSocket driver (not the HTTP one) is what gives us real interactive
// transactions, which the push handler needs for SELECT ... FOR UPDATE.
// Cloudflare Workers have a global WebSocket; Node scripts need `ws`.
if (typeof WebSocket === "undefined") {
  neonConfig.webSocketConstructor = ws;
}

type Database = NeonDatabase<typeof schema>;

declare global {
  var __ticketsDb: Database | undefined;
}

function open(): Database {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(new Pool({ connectionString: url }), { schema, casing: "snake_case" });
}

/**
 * On Cloudflare Workers a socket opened while serving one request cannot be
 * used by another, so each request gets its own pool, keyed on the request's
 * Cloudflare context (a fresh object per request, dropped when it finishes).
 * Work deferred with `after()` runs inside the same request, so it shares it.
 * Under `next dev` and CLI scripts there is no per-request context, so one
 * process-wide pool is reused as before.
 */
const perRequest = new WeakMap<object, Database>();

function requestScope(): object | null {
  try {
    return getCloudflareContext().ctx ?? null;
  } catch {
    return null;
  }
}

function connect(): Database {
  const scope = process.env.NODE_ENV === "production" ? requestScope() : null;
  if (scope) {
    let db = perRequest.get(scope);
    if (!db) perRequest.set(scope, (db = open()));
    return db;
  }
  return (globalThis.__ticketsDb ??= open());
}

/**
 * Lazy: the connection is opened on first query, not at module load, so
 * `next build` can collect page data without DATABASE_URL present.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    const target = connect();
    const value = Reflect.get(target, prop, target);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

export { schema };
export type Db = Database;
/** The type handed to a `db.transaction(async (tx) => ...)` callback. */
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
