/**
 * Where the Google clients send their requests. In local development,
 * GOOGLE_API_ROOT points them all at the fake Google server started by
 * `pnpm dev:local` (scripts/fake-google.ts). Never honoured in production.
 */
const fake =
  process.env.NODE_ENV !== "production"
    ? process.env.GOOGLE_API_ROOT?.trim().replace(/\/+$/, "") || undefined
    : undefined;

/** `rootUrl` for @googleapis/gmail; undefined keeps the real API. */
export const gmailRootUrl = fake ? `${fake}/` : undefined;

/** OAuth endpoints for google-auth-library; undefined keeps Google's. */
export const oauthEndpoints = fake
  ? {
      oauth2AuthBaseUrl: `${fake}/o/oauth2/v2/auth`,
      oauth2TokenUrl: `${fake}/token`,
      oauth2RevokeUrl: `${fake}/revoke`,
    }
  : undefined;

export const peopleApiBase = fake ?? "https://people.googleapis.com";

/**
 * HTTP options for every Google client (OAuth, Gmail, People, Pub/Sub token
 * checks). gaxios uses `window.fetch` when there is a window and otherwise
 * falls back to node-fetch, which on Cloudflare Workers hands back response
 * bodies as unparsed strings: the OAuth token reply arrived as text, so its
 * refresh_token was never seen. The runtime's own fetch works everywhere.
 */
export const googleTransport = {
  fetchImplementation: ((input, init) => fetch(input, init)) as typeof fetch,
};
