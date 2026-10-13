// Dump OUR OWN database to one .sql file: the full schema (every migration,
// in order) followed by every row of every public table. Loading the file on
// an empty Postgres/Supabase database recreates it as it is.
//
// Usage: node scripts/own-dump.cjs <out.sql>
//
// Auth users are not included (passwords never leave Supabase); org_members
// and activity_log reference them, so they are exported but load with
// replication role 'replica' (no FK checks), like the original copy.

const fs = require("fs");
const path = require("path");
const { sql } = require("./own.cjs");

async function main() {
  const out = process.argv[2];
  if (!out) throw new Error("usage: node scripts/own-dump.cjs <out.sql>");
  const parts = [`-- Kansha back office — πλήρες αντίγραφο βάσης, ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC`, `-- 1. Δομή (migrations) · 2. Δεδομένα`, ""];

  const dir = path.join(__dirname, "..", "supabase", "migrations");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    parts.push(`-- ===== ${f} =====`, fs.readFileSync(path.join(dir, f), "utf8").replace(/\r/g, ""), "");
  }

  const tables = (await sql(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r'`)).map((r) => r.relname);
  const fk = await sql(`select c.conrelid::regclass::text a, c.confrelid::regclass::text b from pg_constraint c join pg_namespace n on n.oid = c.connamespace where n.nspname = 'public' and c.contype = 'f' and c.conrelid <> c.confrelid`);
  const sorted = [];
  const seen = new Set();
  const visit = (t) => { if (seen.has(t)) return; seen.add(t); for (const f of fk) if (f.a === t && tables.includes(f.b)) visit(f.b); sorted.push(t); };
  tables.sort().forEach(visit);

  parts.push("-- ===== Δεδομένα =====", "set session_replication_role = replica;", "");
  let total = 0;
  for (const t of sorted) {
    const cols = (await sql(`select column_name from information_schema.columns where table_schema = 'public' and table_name = '${t}'
      and is_generated <> 'ALWAYS' and coalesce(identity_generation, '') <> 'ALWAYS' order by ordinal_position`)).map((c) => c.column_name);
    const [{ n }] = await sql(`select count(*)::int n from public."${t}"`);
    if (!n) continue;
    const list = cols.map((c) => `"${c}"`).join(", ");
    for (let off = 0; off < n; off += 500) {
      const rows = await sql(`select ${list} from public."${t}" order by 1 limit 500 offset ${off}`);
      parts.push(`insert into public."${t}" (${list}) select ${list} from json_populate_recordset(null::public."${t}", $KJ$${JSON.stringify(rows)}$KJ$::json) on conflict do nothing;`);
    }
    parts.push("");
    total += n;
    console.log(`  ${t}: ${n}`);
  }
  parts.push("set session_replication_role = origin;");
  fs.writeFileSync(out, parts.join("\n"));
  console.log(`Έγραψα ${out} — ${total} γραμμές, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
