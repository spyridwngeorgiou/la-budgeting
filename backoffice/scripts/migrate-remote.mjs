// Applies pending supabase/migrations/*.sql to a hosted project through the
// Supabase Management API -- no Docker, psql or database password needed,
// only a personal access token (dashboard -> Account -> Access Tokens).
//
//   node scripts/migrate-remote.mjs <project-ref> [--dry-run] [--confirm-destructive]
//
// Token comes from SUPABASE_ACCESS_TOKEN (env or backoffice/.env.migrate).
// Records each applied file in supabase_migrations.schema_migrations exactly
// like `supabase db push`, so the CLI and this script stay interchangeable.
// Each file runs as one request (one implicit transaction), so a failing
// migration leaves nothing half-applied and stops the run.
//
// Destructive guard: a pending file containing drop table / drop column /
// delete from / truncate (outside comments) runs only with
// --confirm-destructive AND a backup of this project from the last 24h
// (node scripts/backup-json.mjs <project-ref>). --dry-run lists them.
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { lit, loadEnv, makeQuery, root } from "./lib/supabase-api.mjs";
import { destructiveRefusal, findDestructive, latestManifest } from "./lib/destructive.mjs";

loadEnv();

const [ref, ...flags] = process.argv.slice(2);
const dryRun = flags.includes("--dry-run");
const confirmDestructive = flags.includes("--confirm-destructive");
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) {
  console.error(
    "usage: SUPABASE_ACCESS_TOKEN=... node scripts/migrate-remote.mjs <project-ref> [--dry-run] [--confirm-destructive]",
  );
  process.exit(2);
}
const query = makeQuery(ref, token);

await query(`
  create schema if not exists supabase_migrations;
  create table if not exists supabase_migrations.schema_migrations
    (version text primary key, statements text[], name text);
`);
const applied = new Set((await query("select version from supabase_migrations.schema_migrations")).map((r) => r.version));

const dir = join(root, "supabase", "migrations");
const files = readdirSync(dir).filter((f) => /^\d+_.+\.sql$/.test(f)).sort();
const pending = files.filter((f) => !applied.has(f.split("_")[0]));
const sqlOf = new Map(pending.map((f) => [f, readFileSync(join(dir, f), "utf8")]));
const destructive = new Map(pending.map((f) => [f, findDestructive(sqlOf.get(f))]).filter(([, hits]) => hits.length > 0));

console.log(`${ref}: ${applied.size} applied, ${pending.length} pending`);
for (const f of pending) {
  const hits = destructive.get(f);
  console.log(`  - ${f}${hits ? `   [DESTRUCTIVE: ${hits.join(", ")}]` : ""}`);
}

const manifest = latestManifest(join(root, "backups"), ref);
if (destructive.size > 0) {
  console.log(manifest ? `latest backup: ${manifest.createdAt} (${manifest.path})` : "latest backup: none");
}
if (dryRun || pending.length === 0) process.exit(0);

const refusal = destructiveRefusal({ destructiveFiles: [...destructive.keys()], confirm: confirmDestructive, manifest });
if (refusal) {
  console.error(`refusing to migrate: ${refusal}`);
  process.exit(3);
}

for (const f of pending) {
  const [version, ...rest] = f.replace(/\.sql$/, "").split("_");
  const sql = sqlOf.get(f);
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
