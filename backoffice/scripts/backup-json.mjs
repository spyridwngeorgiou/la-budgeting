// A JSON copy of every table in the public and archive schemas of a hosted
// project, through the Supabase Management API (same token as
// migrate-remote.mjs: SUPABASE_ACCESS_TOKEN, env or backoffice/.env.migrate).
//
//   node scripts/backup-json.mjs <project-ref>
//
// Writes backups/<ref>/<ISO time>/<schema>.<table>.json (a JSON array of
// rows) and, last, manifest.json with the row count of each table.
// migrate-remote.mjs accepts a destructive migration only with a complete
// manifest from the last 24 hours. backups/ is git-ignored: the files hold
// real financial data -- keep them local, delete them when done.
//
// Not a substitute for the platform's own database backups (no auth
// schema, no storage objects, no sequences/DDL); it is the "undo" for the
// rows a data migration touches.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ident, loadEnv, makeQuery, root } from "./lib/supabase-api.mjs";

loadEnv();

const [ref] = process.argv.slice(2);
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!ref || !token) {
  console.error("usage: SUPABASE_ACCESS_TOKEN=... node scripts/backup-json.mjs <project-ref>");
  process.exit(2);
}
const query = makeQuery(ref, token);
const PAGE = 5000;

const createdAt = new Date().toISOString();
// Windows does not allow ':' in a folder name.
const outDir = join(root, "backups", ref, createdAt.replace(/:/g, "-"));
mkdirSync(outDir, { recursive: true });

const tables = await query(`
  select table_schema as schema, table_name as name
  from information_schema.tables
  where table_schema in ('public', 'archive') and table_type = 'BASE TABLE'
  order by 1, 2
`);

const counts = {};
for (const { schema, name } of tables) {
  const qualified = `${ident(schema)}.${ident(name)}`;
  const rows = [];
  // Pages in a stable order (ctid would move under concurrent updates; the
  // whole row as text is total and needs no knowledge of the key).
  for (let offset = 0; ; offset += PAGE) {
    const [{ page }] = await query(
      `select coalesce(json_agg(t), '[]'::json) as page
       from (select * from ${qualified} x order by x::text limit ${PAGE} offset ${offset}) t`,
    );
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  writeFileSync(join(outDir, `${schema}.${name}.json`), JSON.stringify(rows));
  counts[`${schema}.${name}`] = rows.length;
  console.log(`  ${schema}.${name}: ${rows.length}`);
}

writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify({ ref, createdAt, complete: true, tables: counts }, null, 2),
);
console.log(`backup of ${tables.length} tables -> ${outDir}`);
