import type { NextConfig } from "next";
import { LEGACY_REDIRECTS } from "./src/lib/redirects";

// Deployment-portability constraint (see README): no Vercel-only primitives
// anywhere in this app, so a future move to Cloudflare Workers (OpenNext) or
// a plain VPS is a config change, not a rewrite.
const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Old URLs keep working after the navigation moved them (src/lib/redirects.ts).
  async redirects() {
    return LEGACY_REDIRECTS.map((r) => ({ ...r, permanent: false }));
  },
  experimental: {
    serverActions: {
      // Default is 1 MB, below what the document upload (10 MB, phone
      // photos) and bank-statement upload accept. Matches the proxy's
      // default 10 MB request buffer, so the two limits agree.
      bodySizeLimit: "10mb",
    },
  },
};

export default nextConfig;

// Lets `next dev` proxy Cloudflare bindings/vars from wrangler.jsonc during
// local development, matching what `wrangler dev`/preview would see. No-op
// on any other host (Vercel, a plain Node server) -- safe to always import.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
