import { neonConfig } from "@neondatabase/serverless";

/**
 * Local development only (`pnpm dev:local`): route the Neon driver through
 * the WebSocket-to-TCP proxy started by scripts/local-db.ts, which fronts an
 * throwaway local Postgres. A no-op unless LOCAL_DB_WS_PROXY is set, and
 * never active in production.
 */
const proxy = process.env.LOCAL_DB_WS_PROXY;
if (proxy && process.env.NODE_ENV !== "production") {
  neonConfig.wsProxy = (host, port) => `${proxy}/v2?address=${host}:${port}`;
  neonConfig.useSecureWebSocket = false;
  neonConfig.pipelineTLS = false;
  neonConfig.pipelineConnect = false;
}
