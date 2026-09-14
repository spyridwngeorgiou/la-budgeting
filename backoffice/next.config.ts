import type { NextConfig } from "next";

// Deployment-portability constraint (see README): no Vercel-only primitives
// anywhere in this app, so a future move to Cloudflare Workers (OpenNext) or
// a plain VPS is a config change, not a rewrite.
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;

// Lets `next dev` proxy Cloudflare bindings/vars from wrangler.jsonc during
// local development, matching what `wrangler dev`/preview would see. No-op
// on any other host (Vercel, a plain Node server) -- safe to always import.
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
initOpenNextCloudflareForDev();
