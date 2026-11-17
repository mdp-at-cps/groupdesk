import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Every page is per-agent and rendered on demand, so no incremental cache
// (and no extra R2 bucket for one) is needed.
export default defineCloudflareConfig({});
