// Applies pending supabase/migrations/*.sql to a hosted project through the
// Supabase Management API -- no Docker, psql or database password needed,
// only a personal access token (dashboard -> Account -> Access Tokens).
//
//   node scripts/migrate-remote.mjs <project-ref> [--dry-run]
//
// Token comes from SUPABASE_ACCESS_TOKEN (env or backoffice/.env.migrate).
// Records each applied file in supabase_migrations.schema_migrations exactly
// like `supabase db push`, so the CLI and this script stay interchangeable.
// Each file runs as one request (one implicit transaction), so a failing
// migration leaves nothing half-applied and stops the run.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const envFile = join(root, ".env.migrate");
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const [ref, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) {
  console.error("usage: SUPABASE_ACCESS_TOKEN=... node scripts/migrate-remote.mjs <project-ref> [--dry-run]");
  process.exit(2);
}

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  if (!res.ok) throw new Error(`${res.status}: ${body}`);
  return body ? JSON.parse(body) : [];
}

const lit = (s) => `'${s.replace(/'/g, "''")}'`;

await query(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations
    (version text primary key, statements text[], name text);
`);
const applied = new Set((await query("select version from supabase_migrations.schema_migrations")).map((r) => r.version));

const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
const pending = files.filter((f) => !applied.has(f.split("_")[0]));

console.log(`${ref}: ${applied.size} applied, ${pending.length} pending`);
for (const f of pending) console.log(`  - ${f}`);
if (dryRun || pending.length === 0) process.exit(0);

for (const f of pending) {
  const [version, ...rest] = f.replace(/\.sql$/, "").split("_");
  const sql = readFileSync(join(dir, f), "utf8");
  process.stdout.write(`applying ${f} ... `);
  try {
    await query(
      `${sql}\n;insert into supabase_migrations.schema_migrations (version, name, statements)` +
        ` values (${lit(version)}, ${lit(rest.join("_"))}, array[${lit(sql)}]);`,
    );
    console.log("ok");
  } catch (err) {
    console.log("FAILED");
    console.error(String(err.message ?? err));
    process.exit(1);
  }
}
console.log("done");
