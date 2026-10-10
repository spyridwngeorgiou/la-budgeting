// Shared by migrate-remote.mjs and backup-json.mjs: the access token from
// SUPABASE_ACCESS_TOKEN (env or backoffice/.env.migrate) and one SQL query
// through the Supabase Management API (no Docker, psql or DB password).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

export function loadEnv() {
  const envFile = join(root, ".env.migrate");
  if (!existsSync(envFile)) return;
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

export function makeQuery(ref, token) {
  return async function query(sql) {
    const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`${res.status}: ${body}`);
    return body ? JSON.parse(body) : [];
  };
}

export const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
export const ident = (s) => `"${String(s).replace(/"/g, '""')}"`;
