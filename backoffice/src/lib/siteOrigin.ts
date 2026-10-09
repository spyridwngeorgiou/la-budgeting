import { headers } from "next/headers";

// Absolute origin for links that leave the app (auth emails). Prefers an
// explicit NEXT_PUBLIC_SITE_URL; otherwise the request's own host, which is
// safe to trust here only because Supabase Auth refuses any redirectTo not
// on the project's Redirect URLs allowlist and falls back to its Site URL.
export async function siteOrigin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL;
  if (configured) return configured.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}
