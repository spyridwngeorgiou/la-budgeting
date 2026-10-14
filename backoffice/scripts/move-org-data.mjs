// Replaces one org's working data on a hosted project with a copy taken from
// another project (staging -> prod) or from a backup-json.mjs folder (the
// undo). One SQL request = one transaction: delete the org's rows in the
// moved tables, insert the source rows, then check row counts, orphans and
// the 13/10-style balances; any failed check raises and nothing is kept.
//
//   node scripts/move-org-data.mjs <target-ref> --from <source-ref | backup dir> [--commit]
//
// Without --commit it is a rehearsal: the same transaction, always rolled
// back, printing the checks. Triggers are off for the transaction
// (session_replication_role = replica) so no history/updated_at is written;
// foreign keys are therefore checked by hand at the end.
//
// User ids differ between projects: they are mapped by e-mail, else null.
// Documents are not moved (their files live in storage): references to them
// become null. Tables not listed in MOVED are left exactly as they are.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ident, loadEnv, makeQuery } from "./lib/supabase-api.mjs";

loadEnv();
const ORG = "bdad8677-f30f-5ee1-8da6-a8193b0b69b0";
// Replaced wholesale for ORG; an empty source simply deletes the target's rows.
const MOVED = [
  "account_balance_assertions", "accounts", "bank_import_profiles", "board_elements", "boards",
  "budget_lines", "categories", "contacts", "expected_income", "ingest_batches", "ingest_rows",
  "installment_plans", "liabilities", "project_activity", "project_messages", "project_milestones",
  "project_notes", "projects", "property_utilities", "tasks", "transaction_drafts",
  "transaction_history", "transactions",
];
// Rows with org_id null are shared presets, also replaced.
const WITH_GLOBAL = new Set(["bank_import_profiles"]);
const DOC_REFS = { transactions: "source_document_id", transaction_drafts: "document_id", ingest_rows: "document_id" };

const [target, ...args] = process.argv.slice(2);
const from = args[args.indexOf("--from") + 1];
const commit = args.includes("--commit");
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!target || !from || args.indexOf("--from") < 0 || !token) {
  console.error("usage: node scripts/move-org-data.mjs <target-ref> --from <source-ref | backup dir> [--commit]");
  process.exit(2);
}
const T = makeQuery(target, token);

// Columns of the target that can be written (no generated ones).
const colRows = await T(`
  select table_name t, column_name c from information_schema.columns
  where table_schema = 'public' and is_generated = 'NEVER' and table_name = any(array[${MOVED.map((t) => `'${t}'`).join(",")}])
  order by ordinal_position`);
const cols = {};
for (const { t, c } of colRows) (cols[t] ??= []).push(c);

const userCols = {};
for (const { t, c } of await T(`
  select conrelid::regclass::text t, a.attname c from pg_constraint k
  join pg_attribute a on a.attrelid = k.conrelid and a.attnum = k.conkey[1]
  where k.contype = 'f' and k.confrelid = 'auth.users'::regclass and k.connamespace = 'public'::regnamespace`))
  (userCols[t.replace(/^public\./, "")] ??= []).push(c);

// Source rows per table, plus a user-id map (source -> target, by e-mail).
const rows = {};
const userMap = new Map();
const targetUsers = new Map((await T(`select email, id::text id from auth.users`)).map((u) => [u.email, u.id]));
if (existsSync(from)) {
  for (const t of MOVED) {
    const f = join(from, `public.${t}.json`);
    rows[t] = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : [];
  }
  // A backup of the target itself: its user ids are already right.
  for (const id of targetUsers.values()) userMap.set(id, id);
} else {
  const S = makeQuery(from, token);
  for (const t of MOVED) rows[t] = (await S(`select coalesce(json_agg(x), '[]') j from public.${ident(t)} x`))[0].j;
  for (const u of await S(`select email, id::text id from auth.users`))
    if (targetUsers.has(u.email)) userMap.set(u.id, targetUsers.get(u.email));
}
for (const t of MOVED) {
  rows[t] = rows[t].filter((r) => r.org_id === ORG || (WITH_GLOBAL.has(t) && r.org_id == null));
  for (const r of rows[t]) {
    for (const c of userCols[t] ?? []) if (r[c] != null) r[c] = userMap.get(r[c]) ?? null;
    if (DOC_REFS[t]) r[DOC_REFS[t]] = null;
  }
}

const expectedBalances = await (async () => {
  if (existsSync(from)) return null; // undo: counts and orphans only
  const S = makeQuery(from, token);
  return S(`select id::text id, name, public.account_balance_as_of(id, athens_today())::text b
            from public.accounts where org_id = '${ORG}' order by name`);
})();

const tag = "$mv" + Math.random().toString(36).slice(2, 8) + "$";
const sql = [`set local session_replication_role = replica;`];
for (const t of MOVED) {
  const scope = WITH_GLOBAL.has(t) ? `(org_id = '${ORG}' or org_id is null)` : `org_id = '${ORG}'`;
  sql.push(`delete from public.${ident(t)} where ${scope};`);
  if (rows[t].length === 0) continue;
  const json = JSON.stringify(rows[t]);
  if (json.includes(tag)) throw new Error("quote tag collision, run again");
  const list = cols[t].filter((c) => c in rows[t][0]).map(ident).join(", ");
  sql.push(`insert into public.${ident(t)} (${list}) overriding system value
    select ${list} from jsonb_populate_recordset(null::public.${ident(t)}, ${tag}${json}${tag}::jsonb);`);
}
sql.push(`select setval(pg_get_serial_sequence('public.transaction_history', 'id'),
  greatest((select max(id) from public.transaction_history), 1));`);

const expectCounts = Object.fromEntries(MOVED.map((t) => [t, rows[t].length]));
sql.push(`do ${tag.replace("mv", "ck")}
declare
  report jsonb := '{}';
  failed text[] := '{}';
  n bigint;
  k record;
  e record;
begin
  for e in select key t, value::bigint want from jsonb_each_text(${tag}${JSON.stringify(expectCounts)}${tag}::jsonb) loop
    execute format('select count(*) from public.%I where org_id = %L ${""}' || case when e.t = any(array[${[...WITH_GLOBAL].map((t) => `'${t}'`).join(",")}]) then 'or org_id is null' else '' end, e.t, '${ORG}') into n;
    if n <> e.want then failed := failed || format('%s: %s rows, expected %s', e.t, n, e.want); end if;
  end loop;
  for k in
    select c.conrelid::regclass ch, a.attname col, c.confrelid::regclass par, b.attname pcol
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    join pg_attribute b on b.attrelid = c.confrelid and b.attnum = c.confkey[1]
    where c.contype = 'f' and c.connamespace = 'public'::regnamespace and cardinality(c.conkey) = 1
  loop
    execute format('select count(*) from %s x where x.%I is not null and not exists (select 1 from %s p where p.%I = x.%I)',
      k.ch, k.col, k.par, k.pcol, k.col) into n;
    if n > 0 then failed := failed || format('orphans: %s.%s -> %s: %s', k.ch, k.col, k.par, n); end if;
  end loop;
  ${
    expectedBalances
      ? `for e in select * from jsonb_to_recordset(${tag}${JSON.stringify(expectedBalances)}${tag}::jsonb) as x(id uuid, name text, b numeric) loop
    n := 0;
    report := report || jsonb_build_object(e.name, public.account_balance_as_of(e.id, athens_today()));
    if public.account_balance_as_of(e.id, athens_today()) is distinct from e.b then
      failed := failed || format('balance %s: %s, expected %s', e.name, public.account_balance_as_of(e.id, athens_today()), e.b);
    end if;
  end loop;`
      : ""
  }
  if cardinality(failed) > 0 then
    raise exception 'CHECKS FAILED: %', array_to_string(failed, ' | ');
  end if;
  ${commit ? "" : `raise exception 'REHEARSAL OK (rolled back): %', report::text;`}
end ${tag.replace("mv", "ck")};`);

console.log(`${commit ? "COMMIT" : "rehearsal"}: ${target} <- ${from}`);
for (const t of MOVED) if (rows[t].length) console.log(`  ${t}: ${rows[t].length}`);
try {
  await T(sql.join("\n"));
  console.log(commit ? "committed: all checks passed" : "unexpected: rehearsal did not roll back");
} catch (err) {
  let msg = String(err.message ?? err);
  try {
    msg = JSON.parse(msg.replace(/^\d+: /, "")).message;
  } catch {}
  const m = msg.match(/(REHEARSAL OK.*|CHECKS FAILED.*)/);
  console.log(m ? m[1] : msg.slice(0, 2000));
  process.exit(m && m[1].startsWith("REHEARSAL OK") ? 0 : 1);
}
