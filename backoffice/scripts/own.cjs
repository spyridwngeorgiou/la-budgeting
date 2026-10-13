// Helper for OUR OWN Supabase project (not Spyros' live or staging).
//
// Usage:
//   node scripts/own.cjs migrate          apply supabase/migrations/*.sql in order (skips applied ones)
//   node scripts/own.cjs sql "<query>"    run one SQL statement and print the result
//
// Reads .env.own.local (gitignored): OWN_PROJECT_REF, SUPABASE_ACCESS_TOKEN.
// SQL goes through the Supabase Management API, so no database password is
// needed. Refuses to run against any project ref other than the one in the file.

const fs = require("fs");
const path = require("path");

function env() {
  const file = path.join(__dirname, "..", ".env.own.local");
  return Object.fromEntries(
    fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.includes("=")).map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim()]),
  );
}

const E = env();
const REF = E.OWN_PROJECT_REF;
if (!/^[a-z]{20}$/.test(REF || "")) throw new Error("OWN_PROJECT_REF λείπει από το .env.own.local");
if (["hjypszddhwohgvubirkc", "jpxxixhiudwjbzagidmn"].includes(REF)) throw new Error("Άρνηση: αυτό είναι project του Σπύρου.");

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${E.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 800)}`);
  return text ? JSON.parse(text) : null;
}

async function migrate() {
  await sql("create schema if not exists kansha_meta; create table if not exists kansha_meta.applied_migrations (name text primary key, applied_at timestamptz not null default now());");
  const done = new Set((await sql("select name from kansha_meta.applied_migrations")).map((r) => r.name));
  const dir = path.join(__dirname, "..", "supabase", "migrations");
  for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    if (done.has(f)) { console.log(`  ✓ ${f} (ήδη)`); continue; }
    const body = fs.readFileSync(path.join(dir, f), "utf8").replace(/\r/g, "");
    try {
      await sql(`begin;\n${body}\n;insert into kansha_meta.applied_migrations(name) values ('${f}');\ncommit;`);
      console.log(`  ✓ ${f}`);
    } catch (e) {
      console.log(`  ✗ ${f}\n    ${e.message}`);
      process.exit(1);
    }
  }
}

module.exports = { sql, env: E };

if (require.main === module) {
  const [cmd, arg] = process.argv.slice(2);
  (cmd === "migrate" ? migrate() : cmd === "sql" ? sql(arg).then((r) => console.log(JSON.stringify(r, null, 1))) : Promise.reject(new Error("usage: migrate | sql \"...\"")))
    .catch((e) => { console.error(e.message); process.exit(1); });
}
