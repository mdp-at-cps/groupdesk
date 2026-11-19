import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

const config: NextConfig = {
  serverExternalPackages: ["@googleapis/gmail", "google-auth-library", "postal-mime"],
  experimental: {
    // Replies and notes carry inline images in the request body (base64).
    // src/lib/inline-images.ts caps them at 15 MB, about 20 MB once encoded.
    serverActions: { bodySizeLimit: "25mb" },
    proxyClientMaxBodySize: "25mb",
  },
};

export default config;

// Gives `next dev` the Cloudflare bindings from wrangler.jsonc (R2, etc.).
initOpenNextCloudflareForDev();
