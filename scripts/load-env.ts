/*
 * Next loads .env.local automatically; plain node scripts do not. Import this
 * first in every CLI script so `pnpm db:migrate` and friends see the same
 * variables `pnpm dev` does, plus .env.neon.
 */
import { config } from "dotenv";

// .env.neon holds the production DATABASE_URL for migrations and seeding.
// It is deliberately not .env/.env.local: the Cloudflare build copies those
// into the Worker bundle, and the deployed app gets DATABASE_URL as a secret.
config({ path: [".env.local", ".env", ".env.neon"], quiet: true });
