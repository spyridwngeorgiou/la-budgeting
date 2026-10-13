// One-off: copy every row from Spyros' STAGING project into OUR OWN project,
// keeping ids so every relation survives. Read-only on staging.
//
// Usage: node scripts/own-copy.cjs [--write]
//
// Skipped: activity_log (history starts fresh), org_members and profiles
// (users are created in our project separately). Columns pointing at auth
// users (created_by, uploaded_by, ...) are cleared -- those users do not exist
// in our project. Inserts run with session_replication_role = replica so
// triggers (activity log, plan completion) do not fire for the copy.

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");
const { sql } = require("./own.cjs");

const SKIP = new Set(["activity_log", "org_members", "profiles"]);
const ORG = "bdad8677-f30f-5ee1-8da6-a8193b0b69b0"; // our business on staging
const AUTH_COLS = /^(created_by|uploaded_by|updated_by|reviewed_by|decided_by|approved_by|user_id)$/;

function stagingClient() {
  const env = Object.fromEntries(
    fs.readFileSync(path.join(__dirname, "..", ".env.staging.local"), "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
  if (new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname !== "jpxxixhiudwjbzagidmn.supabase.co") throw new Error("Το .env.local δεν δείχνει στο staging.");
  return createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
}

async function main() {
  const write = process.argv.includes("--write");
  const sb = stagingClient();
  const order = (await sql(`
    with recursive t as (select c.oid, c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r')
    select relname from t order by relname`)).map((r) => r.relname);
  const fk = await sql(`select c.conrelid::regclass::text a, c.confrelid::regclass::text b from pg_constraint c join pg_namespace n on n.oid = c.connamespace
    where n.nspname = 'public' and c.contype = 'f' and c.conrelid <> c.confrelid`);
  const deps = new Map(order.map((t) => [t, new Set(fk.filter((f) => f.a === t && order.includes(f.b)).map((f) => f.b))]));
  const sorted = [];
  const seen = new Set();
  const visit = (t) => { if (seen.has(t)) return; seen.add(t); for (const d of deps.get(t)) visit(d); sorted.push(t); };
  order.forEach(visit);

  let total = 0;
  for (const table of sorted) {
    if (SKIP.has(table)) { console.log(`  · ${table}: παράλειψη`); continue; }
    const cols = (await sql(`select column_name, is_generated, identity_generation from information_schema.columns
      where table_schema = 'public' and table_name = '${table}' order by ordinal_position`))
      .filter((c) => c.is_generated !== "ALWAYS" && c.identity_generation !== "ALWAYS")
      .map((c) => c.column_name);
    const rows = [];
    // Only our business: staging also holds empty test orgs.
    const scope = table === "orgs" ? ["id", ORG] : cols.includes("org_id") ? ["org_id", ORG] : null;
    if (!scope) console.log(`  ! ${table}: χωρίς org_id — αντιγράφεται ολόκληρος`);
    for (let from = 0; ; from += 1000) {
      let q = sb.from(table).select(cols.join(","));
      if (scope) q = q.eq(scope[0], scope[1]);
      const { data, error } = await q.range(from, from + 999);
      if (error) { console.log(`  · ${table}: δεν υπάρχει στο staging (${error.message.slice(0, 60)})`); break; }
      rows.push(...data);
      if (data.length < 1000) break;
    }
    if (!rows.length) { console.log(`  · ${table}: 0`); continue; }
    for (const r of rows) for (const c of cols) if (AUTH_COLS.test(c) && table !== "documents") r[c] = null;
    total += rows.length;
    if (!write) { console.log(`  ${table}: ${rows.length}`); continue; }
    const list = cols.map((c) => `"${c}"`).join(", ");
    for (let i = 0; i < rows.length; i += 300) {
      const json = JSON.stringify(rows.slice(i, i + 300));
      if (json.includes("$KJ$")) throw new Error("απρόσμενο κείμενο στα δεδομένα");
      await sql(`set session_replication_role = replica;
        insert into public."${table}" (${list}) select ${list} from json_populate_recordset(null::public."${table}", $KJ$${json}$KJ$::json)
        on conflict do nothing;
        set session_replication_role = origin;`);
    }
    const [{ n }] = await sql(`select count(*)::int n from public."${table}"`);
    console.log(`  ✓ ${table}: ${rows.length} από staging → ${n} στη βάση μας`);
  }
  console.log(`\n${write ? "Μεταφέρθηκαν" : "Θα μεταφερθούν"} ${total} γραμμές.`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
