// Staging-only helper: inspect the staging database and load a workbook into it.
//
// Usage:
//   node scripts/staging.cjs inspect | balances | refs
//   node scripts/staging.cjs add <entry.json>
//   node scripts/staging.cjs load <workbook.xlsx> [--write]
//   node scripts/staging.cjs files <project code> <drive inventory.json> [--write]
//
// Reads keys from .env.staging.local and refuses to run unless they point at the
// staging project, so it can never touch the live database.

const fs = require("fs");
const path = require("path");
const { createClient } = require("@supabase/supabase-js");

const STAGING_REF = "jpxxixhiudwjbzagidmn";

function loadEnv() {
  const file = path.join(__dirname, "..", ".env.staging.local");
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trimStart().startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return env;
}

// With --own anywhere on the command line, every command runs against OUR OWN
// project (.env.own.local) instead of staging.
const OWN = process.argv.includes("--own");
if (OWN) process.argv = process.argv.filter((a) => a !== "--own");
let TARGET = `staging ${STAGING_REF}`;

function ownClient() {
  const file = path.join(__dirname, "..", ".env.own.local");
  const env = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0 && !line.trimStart().startsWith("#")) env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const url = env.OWN_SUPABASE_URL || "";
  if (new URL(url).hostname !== `${env.OWN_PROJECT_REF}.supabase.co` || ["hjypszddhwohgvubirkc", STAGING_REF].includes(env.OWN_PROJECT_REF)) {
    throw new Error(`Άρνηση: το .env.own.local δεν δείχνει στη δική μας βάση (${url}).`);
  }
  TARGET = `δική μας βάση ${env.OWN_PROJECT_REF}`;
  return createClient(url, env.OWN_SECRET_KEY, {
    auth: { persistSession: false },
    global: { headers: { "x-actor-email": env.ACTOR_EMAIL || "create@chriskansha.com" } },
  });
}

function stagingClient() {
  if (OWN) return ownClient();
  const env = loadEnv();
  const url = env.NEXT_PUBLIC_SUPABASE_URL || "";
  if (new URL(url).hostname !== `${STAGING_REF}.supabase.co`) {
    throw new Error(`Άρνηση: το .env.local δείχνει στο ${url}, όχι στο staging (${STAGING_REF}).`);
  }
  if (!env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("Λείπει το SUPABASE_SERVICE_ROLE_KEY από το .env.local.");
  // Everything this script writes is done on the owner's behalf; the activity
  // log (0024) records it as "via Claude" for this email.
  const actor = env.ACTOR_EMAIL || "create@chriskansha.com";
  return createClient(url, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
    global: { headers: { "x-actor-email": actor } },
  });
}

const TABLES = [
  "orgs", "org_members", "accounts", "projects", "categories", "contacts", "transactions",
  "installment_plans", "assets", "liabilities", "expected_income", "loans",
  "project_budgets", "project_leases", "revenue_plans", "agent_changes",
];

async function inspect(sb) {
  console.log(`${TARGET}\n`);
  for (const t of TABLES) {
    const { count, error } = await sb.from(t).select("*", { count: "exact", head: true });
    console.log(`  ${t.padEnd(18)} ${error ? "— " + error.message : count}`);
  }
  const { data: orgs } = await sb.from("orgs").select("id, name, own_afm, created_at").order("created_at");
  console.log("\nΕπιχειρήσεις:");
  for (const o of orgs ?? []) console.log(`  ${o.id}  ${o.name}  ΑΦΜ ${o.own_afm}`);

  const { data: bal, error: be } = await sb.from("v_account_balances").select("name, opening_balance, opening_balance_date, current_balance");
  console.log("\nΥπόλοιπα:");
  if (be) console.log("  — " + be.message);
  let total = 0;
  for (const b of bal ?? []) {
    total += Number(b.current_balance);
    console.log(`  ${b.name.padEnd(22)} έναρξη ${b.opening_balance} (${b.opening_balance_date})  τρέχον ${b.current_balance}`);
  }
  if (bal?.length) console.log(`  ΣΥΝΟΛΟ ${total.toFixed(2)}`);

  const { data: last } = await sb.from("transactions").select("tx_date, description, legacy_excel_id, origin").order("created_at", { ascending: false }).limit(5);
  console.log("\nΤελευταίες κινήσεις:");
  for (const t of last ?? []) console.log(`  ${t.tx_date}  ${t.legacy_excel_id ?? t.origin}  ${String(t.description ?? "").slice(0, 60)}`);

  const { data: users, error: ue } = await sb.auth.admin.listUsers();
  console.log("\nΧρήστες:", ue ? "— " + ue.message : users.users.map((u) => u.email).join(", ") || "κανένας");

  // Where the ledger rows came from: the workbook (legacy id), an instalment
  // plan, or typed into the app -- the last group is not in any workbook.
  const { data: tx } = await sb.from("transactions").select("tx_date, description, gross_amount, direction, status, origin, legacy_excel_id, plan_id").limit(5000);
  const fromWorkbook = tx.filter((t) => t.legacy_excel_id);
  const fromPlans = tx.filter((t) => !t.legacy_excel_id && t.plan_id);
  const fromApp = tx.filter((t) => !t.legacy_excel_id && !t.plan_id);
  console.log(`\nΚινήσεις: από Excel ${fromWorkbook.length} · από πλάνα δόσεων ${fromPlans.length} · από την εφαρμογή ${fromApp.length}`);
  for (const t of fromApp) console.log(`  εφαρμογή: ${t.tx_date} ${t.direction} ${t.status} ${t.gross_amount} ${t.origin} — ${String(t.description ?? "").slice(0, 60)}`);
}

// ---------------------------------------------------------------------------
// Workbook -> model. Same mapping as scripts/workbook-to-seed.cjs.
const { loadWorkbook, cell, categoryCode, afmOrNull, round2 } = require("./workbook-to-seed.cjs");

const TREATMENT = {
  ΥΛΙΚΆ: "capex", ΕΡΓΑΤΙΚΆ: "capex", ΥΠΕΡΓΟΛΆΒΟΙ: "capex", ΕΞΟΠΛΙΣΜΌΣ: "capex", ΜΕΤΑΦΟΡΙΚΆ: "capex",
  ΆΔΕΙΕΣ_AND_ΜΕΛΈΤΕΣ: "capex", ΑΓΟΡΆ_ΑΚΙΝΉΤΟΥ: "capex", ΑΜΟΙΒΉ_ΜΕΣΙΤΕΊΑΣ: "capex",
  ΕΝΟΊΚΙΑ_AND_ΜΙΣΘΏΜΑΤΑ: "rent", ΛΕΙΤΟΥΡΓΙΚΆ: "opex", ΑΜΟΙΒΉ_ΔΙΑΧΕΊΡΙΣΗΣ: "opex", ΛΟΓΙΣΤΙΚΆ_AND_ΝΟΜΙΚΆ: "opex",
  ΤΡΑΠΕΖΙΚΆ: "financing", ΦΌΡΟΙ_AND_ΡΥΘΜΊΣΕΙΣ: "tax", ΕΝΦΙΑ: "tax",
  ΠΏΛΗΣΗ_ΑΚΙΝΉΤΟΥ: "income", ΈΣΟΔΑ_ΦΙΛΟΞΕΝΊΑΣ: "income", ΑΝΑΧΡΈΩΣΗ_ΚΌΣΤΟΥΣ: "income", ΡΕΥΣΤΟΠΟΊΗΣΗ_ΠΕΡΙΟΥΣΊΑΣ: "income",
};

async function parseWorkbook(file) {
  const wb = await loadWorkbook(file);
  const rs = wb.getWorksheet("Ρυθμίσεις");
  const ls = wb.getWorksheet("Λογαριασμοί");
  const cs = wb.getWorksheet("Επαφές");
  const ks = wb.getWorksheet("Κινήσεις");
  const ds = wb.getWorksheet("Καθημερινά");
  const openingDate = cell(rs, 28, 3);
  const dayAfterOpening = new Date(Date.parse(openingDate) + 86400000).toISOString().slice(0, 10);
  const m = { openingDate, dayAfterOpening, categories: [], accounts: [], assets: [], expected: [], liabilities: [], contacts: [], tx: [], daily: [], recurring: [] };

  for (let r = 4; r <= 22; r++) {
    const name = cell(rs, r, 3);
    if (name) m.categories.push({ name, code: categoryCode(name), cost_treatment: TREATMENT[categoryCode(name)] ?? null });
  }
  for (let r = 4; r <= 9; r++) {
    const name = cell(ls, r, 1);
    if (!name) continue;
    m.accounts.push({
      name, kind: name === "Μετρητά" ? "cash" : "bank", owner_scope: cell(ls, r, 5) === "Εταιρικός" ? "corporate" : "personal",
      opening_balance: round2(cell(ls, r, 2)), opening_balance_date: openingDate, notes: cell(ls, r, 6),
    });
  }
  const assetCategory = (n) => (/χρυσ/i.test(n) ? "metal" : /κρυπτ/i.test(n) ? "crypto" : /ακίνητ/i.test(n) ? "property" : /ρολόι/i.test(n) ? "watch" : /μηχαν/i.test(n) ? "vehicle" : null);
  for (let r = 14; r <= 21; r++) {
    const name = cell(ls, r, 1);
    const value = cell(ls, r, 2);
    if (name && typeof value === "number") {
      m.assets.push({ name, category: assetCategory(name), estimated_value: value, ownership_pct: cell(ls, r, 3) ?? 1, owner_scope: cell(ls, r, 5) === "Εταιρικός" ? "corporate" : "personal", state: "held", notes: cell(ls, r, 6) });
    }
  }
  for (let r = 26; r <= 29; r++) {
    const source = cell(ls, r, 1);
    const amount = cell(ls, r, 2);
    if (source && typeof amount === "number") {
      const notes = cell(ls, r, 6);
      m.expected.push({ source, amount, certainty: cell(ls, r, 3) === "Βέβαιο" ? "certain" : "probable", expected_month: cell(ls, r, 4), creates_liability: /δάνει/i.test(notes || ""), notes });
    }
  }
  for (let r = 36; r <= 40; r++) {
    const lender = cell(ls, r, 1);
    const principal = cell(ls, r, 2);
    if (lender && !/^ΣΥΝΟΛΟ/.test(lender) && typeof principal === "number") {
      const rate = cell(ls, r, 4);
      m.liabilities.push({ lender, kind: "private", principal, interest_rate: typeof rate === "number" ? rate : 0, maturity_date: cell(ls, r, 3), state: "disbursed", owner_scope: "personal", terms: cell(ls, r, 6) });
    }
  }
  const kindOf = (t) => (!t ? null : /πελάτ/i.test(t) && /προμηθ/i.test(t) ? "both" : /πελάτ/i.test(t) ? "client" : /προμηθ/i.test(t) ? "supplier" : /δημόσ|αρχή|εφορ/i.test(t) ? "authority" : null);
  for (let r = 4; r <= cs.rowCount; r++) {
    const name = cell(cs, r, 1);
    if (name) m.contacts.push({ name: String(name), afm: afmOrNull(cell(cs, r, 2)), kind: kindOf(cell(cs, r, 3)), phone: cell(cs, r, 4), email: cell(cs, r, 5) });
  }

  const statusMap = { Πληρωμένο: "paid", Εκκρεμεί: "pending", Προγραμματισμένο: "scheduled", Ακυρωμένο: "cancelled" };
  for (let r = 4; r <= ks.rowCount; r++) {
    const txDate = cell(ks, r, 1);
    if (!txDate) continue;
    let direction = cell(ks, r, 9) === "Έσοδο" ? "income" : "expense";
    let net = round2(cell(ks, r, 10));
    let vat = round2(cell(ks, r, 11));
    let wh = round2(cell(ks, r, 12));
    if (net < 0) {
      direction = direction === "income" ? "expense" : "income";
      net = -net; vat = Math.abs(vat); wh = Math.abs(wh);
    }
    const status = statusMap[cell(ks, r, 15)] ?? "pending";
    const originLabel = cell(ks, r, 16);
    const name = cell(ks, r, 4);
    const afm = afmOrNull(cell(ks, r, 5));
    if (name && !m.contacts.some((c) => c.name === name || (afm && c.afm === afm))) m.contacts.push({ name: String(name), afm, kind: null, phone: null, email: null });
    const notes = [cell(ks, r, 18), originLabel ? `Προέλευση: ${originLabel}` : null, cell(ks, r, 19) === "Ναι" ? `Επαναλαμβανόμενο: ${cell(ks, r, 20) ?? "?"} δόσεις, πληρωμένες ${cell(ks, r, 21) ?? 0}` : null].filter(Boolean).join(" · ");
    m.tx.push({
      legacy_excel_id: "kiniseis-row-" + r,
      tx_date: txDate, paid_on: cell(ks, r, 2) ?? (status === "paid" ? txDate : null), due_date: cell(ks, r, 3),
      counterparty_name: name ? String(name) : null, counterparty_afm: afm,
      project_code: cell(ks, r, 6), category_code: cell(ks, r, 7) ? categoryCode(cell(ks, r, 7)) : null, account_name: cell(ks, r, 14),
      direction, scope: "business", status, origin: originLabel === "Τραπεζικό αρχείο" ? "bank_file" : "manual",
      gross_amount: round2(net + vat - wh), net_amount: net, vat_amount: vat, withholding_amount: wh,
      has_invoice: vat > 0 || wh > 0 || originLabel === "AADE",
      invoice_number: cell(ks, r, 17) != null ? String(cell(ks, r, 17)) : null, description: cell(ks, r, 8), notes: notes || null,
    });
    if (cell(ks, r, 19) === "Ναι" && cell(ks, r, 20)) {
      m.recurring.push({ legacy_excel_id: "kiniseis-row-" + r, desc: String(cell(ks, r, 8)), count: Number(cell(ks, r, 20)), paid: Number(cell(ks, r, 21) || 0), base: Number(cell(ks, r, 37) || 0), net, vat, wh });
    }
  }

  for (let r = 4; r <= ds.rowCount; r++) {
    const month = cell(ds, r, 2);
    const amount = cell(ds, r, 4);
    if (!month || month < openingDate.slice(0, 7) || !["Μετρητά", "Πειραιώς Προσωπικός"].includes(cell(ds, r, 6)) || typeof amount !== "number") continue;
    const note = cell(ds, r, 8) ? String(cell(ds, r, 8)) : "";
    const d = [...note.matchAll(/(\d{2})\/(\d{2})\/(\d{4})/g)].pop();
    let date = d ? `${d[3]}-${d[2]}-${d[1]}` : `${month}-01`;
    if (date <= openingDate) date = dayAfterOpening;
    m.daily.push({
      legacy_excel_id: "kathimerina-row-" + r, tx_date: date, paid_on: date, account_name: cell(ds, r, 6), category_code: "ΠΡΟΣΩΠΙΚΆ_ΈΞΟΔΑ",
      direction: "expense", scope: "personal", status: "paid", origin: "manual", gross_amount: round2(amount), net_amount: round2(amount),
      description: cell(ds, r, 3), notes: note || null,
    });
  }
  return m;
}

// ---------------------------------------------------------------------------
// Load: diff the model against staging, print the plan, write only with --write.
async function fetchAll(sb, table, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await sb.from(table).select(columns).range(from, from + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}

const must = ({ data, error }, what) => {
  if (error) throw new Error(`${what}: ${error.message}`);
  return data;
};

async function load(sb, file, write) {
  const m = await parseWorkbook(file);
  const log = [];
  const say = (s) => { log.push(s); console.log(s); };
  say(`${write ? "ΦΟΡΤΩΣΗ" : "ΔΟΚΙΜΑΣΤΙΚΗ ΕΚΤΕΛΕΣΗ (δεν γράφεται τίποτα)"} — ${path.basename(file)} → ${TARGET}\n`);

  const orgs = must(await sb.from("orgs").select("id").order("created_at"), "orgs");
  if (orgs.length !== 1) throw new Error(`Περίμενα 1 επιχείρηση στη βάση, βρήκα ${orgs.length}.`);
  const org_id = orgs[0].id;

  // Categories (by code)
  let categories = await fetchAll(sb, "categories", "id, code, cost_treatment");
  const wantedCats = [...m.categories, { name: "Προσωπικά έξοδα", code: "ΠΡΟΣΩΠΙΚΆ_ΈΞΟΔΑ", kind: "expense", scope: "personal", cost_treatment: null }];
  const newCats = wantedCats.filter((c) => !categories.some((x) => x.code === c.code));
  say(`Κατηγορίες: ${newCats.length} νέες${newCats.length ? " (" + newCats.map((c) => c.name).join(", ") + ")" : ""}`);
  if (write && newCats.length) must(await sb.from("categories").insert(newCats.map((c) => ({ org_id, code: c.code, name: c.name, kind: c.kind ?? null, scope: c.scope ?? "business", cost_treatment: c.cost_treatment }))), "categories insert");
  if (write) categories = await fetchAll(sb, "categories", "id, code");
  const catId = (code) => categories.find((c) => c.code === code)?.id ?? null;

  // Projects (by code) -- must already exist
  const projects = await fetchAll(sb, "projects", "id, code");
  const projId = (code) => projects.find((p) => p.code === code)?.id ?? null;
  const missingProj = [...new Set(m.tx.map((t) => t.project_code).filter((c) => c && !projId(c)))];
  if (missingProj.length) say(`ΠΡΟΣΟΧΗ: έργα που δεν υπάρχουν στο staging: ${missingProj.join(", ")}`);

  // Accounts (by name)
  let accounts = await fetchAll(sb, "accounts", "id, name, opening_balance, opening_balance_date, notes");
  for (const a of m.accounts) {
    const ex = accounts.find((x) => x.name === a.name);
    if (!ex) {
      say(`Λογαριασμός νέος: ${a.name} έναρξη ${a.opening_balance}`);
      if (write) must(await sb.from("accounts").insert({ org_id, ...a, is_liquid: true }), "accounts insert");
    } else if (Number(ex.opening_balance) !== a.opening_balance || ex.opening_balance_date !== a.opening_balance_date || (ex.notes ?? null) !== (a.notes ?? null)) {
      say(`Λογαριασμός ${a.name}: υπόλοιπο έναρξης ${ex.opening_balance} → ${a.opening_balance}${ex.opening_balance_date !== a.opening_balance_date ? ` (ημ/νία ${ex.opening_balance_date} → ${a.opening_balance_date})` : ""}`);
      if (write) must(await sb.from("accounts").update({ opening_balance: a.opening_balance, opening_balance_date: a.opening_balance_date, notes: a.notes }).eq("id", ex.id), "accounts update");
    }
  }
  if (write) accounts = await fetchAll(sb, "accounts", "id, name");
  const accId = (name) => accounts.find((a) => a.name === name)?.id ?? null;

  // Contacts (by ΑΦΜ, else name)
  let contacts = await fetchAll(sb, "contacts", "id, name, afm");
  const findContact = (name, afm) => contacts.find((c) => afm && c.afm === afm) ?? contacts.find((c) => c.name === name);
  const newContacts = m.contacts.filter((c) => !findContact(c.name, c.afm));
  say(`Επαφές: ${newContacts.length} νέες`);
  if (write && newContacts.length) must(await sb.from("contacts").insert(newContacts.map((c) => ({ org_id, ...c }))), "contacts insert");
  if (write) contacts = await fetchAll(sb, "contacts", "id, name, afm");

  // Assets / expected income / private loans (by name)
  for (const [table, key, rows] of [["assets", "name", m.assets], ["expected_income", "source", m.expected], ["liabilities", "lender", m.liabilities]]) {
    const existing = await fetchAll(sb, table, `id, ${key}`);
    const fresh = rows.filter((r) => !existing.some((e) => e[key] === r[key]));
    const upd = rows.filter((r) => existing.some((e) => e[key] === r[key]));
    say(`${table}: ${fresh.length} νέα, ${upd.length} ενημερώσεις`);
    if (write) {
      if (fresh.length) must(await sb.from(table).insert(fresh.map((r) => ({ org_id, ...r }))), `${table} insert`);
      for (const r of upd) must(await sb.from(table).update(r).eq("id", existing.find((e) => e[key] === r[key]).id), `${table} update`);
    }
  }

  // Ledger rows (by legacy_excel_id)
  const existingTx = await fetchAll(sb, "transactions", "id, legacy_excel_id, plan_id, tx_date, paid_on, due_date, status, account_id, direction, gross_amount, net_amount, vat_amount, withholding_amount, description, notes");
  const byLegacy = new Map(existingTx.filter((t) => t.legacy_excel_id).map((t) => [t.legacy_excel_id, t]));
  const COMPARE = ["tx_date", "paid_on", "due_date", "status", "account_id", "direction", "gross_amount", "net_amount", "vat_amount", "withholding_amount", "description", "notes"];
  let inserted = 0;
  let updated = 0;
  let ex2;
  for (const t of [...m.tx, ...m.daily]) {
    const row = {
      tx_date: t.tx_date, paid_on: t.paid_on, due_date: t.due_date ?? null, status: t.status, account_id: accId(t.account_name),
      direction: t.direction, gross_amount: t.gross_amount, net_amount: t.net_amount, vat_amount: t.vat_amount ?? 0,
      withholding_amount: t.withholding_amount ?? 0, description: t.description, notes: t.notes,
    };
    const ex = byLegacy.get(t.legacy_excel_id);
    if (ex) {
      // A row adopted into an instalment plan keeps the plan's status; the
      // plan step below marks its paid instalments.
      if (ex.plan_id) { delete row.status; delete row.paid_on; delete row.tx_date; delete row.due_date; }
      const diffs = Object.keys(row).filter((k) => (k.endsWith("amount") ? Number(ex[k]) !== Number(row[k]) : (ex[k] ?? null) !== (row[k] ?? null)));
      if (!diffs.length) continue;
      updated++;
      say(`  αλλαγή ${t.legacy_excel_id} «${String(t.description).slice(0, 40)}»: ${diffs.map((k) => `${k} ${ex[k]} → ${row[k]}`).join("; ")}`);
      if (write) must(await sb.from("transactions").update(row).eq("id", ex.id), `update ${t.legacy_excel_id}`);
    } else if ((ex2 = existingTx.find((x) => !x.legacy_excel_id && !x.plan_id && !x._claimed && x.tx_date === row.tx_date && x.direction === row.direction && Number(x.gross_amount) === Number(row.gross_amount) && x.account_id === row.account_id))) {
      // Already entered from the chat: adopt the workbook row id instead of
      // inserting a duplicate.
      ex2._claimed = true;
      updated++;
      say(`  ήδη καταχωρημένη από το chat → ${t.legacy_excel_id} «${String(t.description).slice(0, 45)}»`);
      if (write) must(await sb.from("transactions").update({ legacy_excel_id: t.legacy_excel_id, notes: row.notes ?? ex2.notes }).eq("id", ex2.id), `adopt ${t.legacy_excel_id}`);
    } else {
      inserted++;
      say(`  νέα ${t.legacy_excel_id} ${t.tx_date} ${t.direction} ${t.gross_amount} «${String(t.description).slice(0, 45)}»`);
      if (write) {
        const c = t.counterparty_name ? findContact(t.counterparty_name, t.counterparty_afm) : null;
        must(await sb.from("transactions").insert({
          org_id, ...row, legacy_excel_id: t.legacy_excel_id, scope: t.scope, origin: t.origin,
          project_id: projId(t.project_code), category_id: catId(t.category_code), contact_id: c?.id ?? null,
          counterparty_name: t.counterparty_name ?? null, counterparty_afm: t.counterparty_afm ?? null,
          has_invoice: t.has_invoice ?? false, invoice_number: t.invoice_number ?? null,
        }), `insert ${t.legacy_excel_id}`);
      }
    }
  }
  const wanted = new Set([...m.tx, ...m.daily].map((t) => t.legacy_excel_id));
  const orphans = [...byLegacy.keys()].filter((k) => !wanted.has(k));
  say(`Κινήσεις: ${inserted} νέες, ${updated} αλλαγές${orphans.length ? `, ${orphans.length} υπάρχουν στο staging αλλά όχι στο Excel: ${orphans.join(", ")}` : ""}`);

  // Instalment plans for recurring rows, with paid instalments marked.
  const plans = await fetchAll(sb, "installment_plans", "id, label");
  let txNow = write ? await fetchAll(sb, "transactions", "id, legacy_excel_id, plan_id, installment_no, due_date, status, paid_on") : existingTx;
  for (const p of m.recurring) {
    const aa = (p.desc.match(/Α\/Α\s*([0-9]+)/) || [])[1];
    const adopted = txNow.find((t) => t.legacy_excel_id === p.legacy_excel_id);
    let plan = (aa && plans.find((x) => x.label.includes("Α/Α " + aa))) || (adopted?.plan_id && plans.find((x) => x.id === adopted.plan_id));
    if (!plan) {
      say(`Πλάνο νέο: «${p.desc.slice(0, 50)}» ${p.count} δόσεις, πληρωμένες ${p.paid}`);
      if (!write) continue;
      const src = must(await sb.from("transactions").select("*").eq("legacy_excel_id", p.legacy_excel_id).single(), "plan source");
      const kind = /ενοίκιο/i.test(p.desc) ? "rent" : /ρύθμιση/i.test(p.desc) ? "third_party_tax_settlement" : /λογιστ/i.test(p.desc) ? "supplier" : "other";
      plan = must(await sb.from("installment_plans").insert({
        org_id, label: p.desc, direction: src.direction, scope: src.scope, project_id: src.project_id, category_id: src.category_id,
        account_id: src.account_id, contact_id: src.contact_id, amount_per_installment: p.net, vat_per_installment: p.vat,
        withholding_per_installment: p.wh, frequency: "monthly", first_due_date: src.tx_date, installment_count: p.count,
        obligation_kind: kind, status: "active", notes: `Από το Επιχειρησιακό Αρχείο (${p.legacy_excel_id}).`,
      }).select("id, label").single(), "plan insert");
      must(await sb.from("transactions").update({ plan_id: plan.id, installment_no: 1 }).eq("id", src.id), "plan adopt");
      must(await sb.rpc("regenerate_plan", { p_plan_id: plan.id }), "regenerate_plan");
      txNow = await fetchAll(sb, "transactions", "id, legacy_excel_id, plan_id, installment_no, due_date, status, paid_on");
    }
    const inst = txNow.filter((t) => t.plan_id === plan.id && t.installment_no <= p.paid);
    const toMark = inst.filter((t) => t.status !== "paid");
    if (plan && toMark.length) say(`  «${plan.label.slice(0, 45)}»: σημειώνω πληρωμένες τις δόσεις ${toMark.map((t) => t.installment_no).join(", ")}`);
    if (write) {
      for (const t of toMark) {
        const paid_on = t.installment_no <= p.base ? m.openingDate : (t.due_date > m.dayAfterOpening ? t.due_date : m.dayAfterOpening);
        must(await sb.from("transactions").update({ status: "paid", paid_on }).eq("id", t.id), "mark paid");
      }
    }
  }
  if (!write) say("\nΤίποτα δεν γράφτηκε. Για φόρτωση: node scripts/staging.cjs load <αρχείο> --write");
}

// Balances under the current view (0011: tx_date >= opening) and under 0022
// (payment date strictly after opening), computed from the rows themselves.
async function balances(sb) {
  const accounts = await fetchAll(sb, "accounts", "id, name, opening_balance, opening_balance_date");
  const tx = await fetchAll(sb, "transactions", "account_id, status, tx_date, paid_on, signed_amount");
  let t11 = 0;
  let t22 = 0;
  for (const a of accounts) {
    const paid = tx.filter((t) => t.account_id === a.id && t.status === "paid");
    const b11 = Number(a.opening_balance) + paid.filter((t) => t.tx_date >= a.opening_balance_date).reduce((s, t) => s + Number(t.signed_amount), 0);
    const b22 = Number(a.opening_balance) + paid.filter((t) => (t.paid_on ?? t.tx_date) > a.opening_balance_date).reduce((s, t) => s + Number(t.signed_amount), 0);
    t11 += b11;
    t22 += b22;
    console.log(`  ${a.name.padEnd(22)} σήμερα ${b11.toFixed(2).padStart(11)}   με 0022 ${b22.toFixed(2).padStart(11)}`);
  }
  console.log(`  ${"ΣΥΝΟΛΟ".padEnd(22)} σήμερα ${t11.toFixed(2).padStart(11)}   με 0022 ${t22.toFixed(2).padStart(11)}`);
}

// Reference lists used to classify a new entry.
async function refs(sb) {
  const [projects, categories, accounts] = await Promise.all([
    fetchAll(sb, "projects", "code, display_name"),
    fetchAll(sb, "categories", "code, name, scope"),
    fetchAll(sb, "accounts", "name, owner_scope"),
  ]);
  console.log("Έργα:", projects.map((p) => `${p.code} (${p.display_name})`).join(" · "));
  console.log("Κατηγορίες:", categories.map((c) => `${c.code}${c.scope === "personal" ? "*" : ""}`).join(" · "));
  console.log("Λογαριασμοί:", accounts.map((a) => a.name).join(" · "));
}

// Record one entry from a JSON file (a payment sent in the chat):
// { tx_date, paid_on?, due_date?, direction: "expense"|"income", status?: "paid",
//   net, vat?, wh?, description, counterparty_name?, afm?, project_code?,
//   category_code?, account_name?, scope?: "business"|"personal",
//   invoice_number?, notes?, photo?: "<path to image or pdf>",
//   allow_duplicate?: true  (only after the user said it is a second, separate payment) }
async function add(sb, file) {
  const e = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  const orgs = must(await sb.from("orgs").select("id").order("created_at"), "orgs");
  const org_id = orgs[0].id;
  const one = async (table, col, val) => (val ? must(await sb.from(table).select("id").eq(col, val).limit(1), table)[0]?.id ?? null : null);
  const project_id = await one("projects", "code", e.project_code);
  const category_id = await one("categories", "code", e.category_code);
  const account_id = await one("accounts", "name", e.account_name);
  if (e.project_code && !project_id) throw new Error(`Άγνωστο έργο ${e.project_code}`);
  if (e.category_code && !category_id) throw new Error(`Άγνωστη κατηγορία ${e.category_code}`);
  if (e.account_name && !account_id) throw new Error(`Άγνωστος λογαριασμός ${e.account_name}`);

  // Same duplicate check as the Claude connector (0030): same direction and
  // amount, date ±7 days. Refuse unless the entry says it is a second one.
  {
    const gross = round2(round2(e.net) + round2(e.vat ?? 0) - round2(e.wh ?? 0));
    const day = e.paid_on ?? e.due_date ?? e.tx_date;
    const dups = must(await sb.rpc("possible_duplicates", { p_org: org_id, p_date: day, p_amount: gross, p_direction: e.direction ?? "expense" }), "possible_duplicates");
    if (dups.length && !e.allow_duplicate) {
      console.log("ΣΤΟΠ — υπάρχει ήδη ίδιο ποσό ±7 ημέρες. Ίδια ή δύο; (για δεύτερη εγγραφή: \"allow_duplicate\": true)");
      for (const d of dups) console.log(`  ${d.paid_on ?? d.due_date ?? d.tx_date} ${d.gross_amount} ${d.status} · ${d.account ?? ""} · ${d.project ?? ""} · ${d.description ?? ""}`);
      process.exitCode = 2;
      return;
    }
  }

  const afm = afmOrNull(e.afm);
  let contact_id = afm ? await one("contacts", "afm", afm) : null;
  if (!contact_id && e.counterparty_name) contact_id = await one("contacts", "name", e.counterparty_name);
  if (!contact_id && e.counterparty_name) {
    contact_id = must(await sb.from("contacts").insert({ org_id, name: e.counterparty_name, afm }).select("id").single(), "contact insert").id;
  }

  let source_document_id = null;
  if (e.photo) {
    const ext = path.extname(e.photo).toLowerCase();
    const mime = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".pdf": "application/pdf", ".heic": "image/heic" }[ext] ?? "application/octet-stream";
    const bytes = fs.readFileSync(e.photo);
    const [y, mo] = e.tx_date.split("-");
    const storage_path = `${org_id}/${y}/${mo}/${require("crypto").randomUUID()}${ext}`;
    must(await sb.storage.from("documents").upload(storage_path, bytes, { contentType: mime }), "photo upload");
    source_document_id = must(await sb.from("documents").insert({ org_id, storage_path, mime_type: mime, byte_size: bytes.length }).select("id").single(), "document insert").id;
  }

  const net = round2(e.net);
  const vat = round2(e.vat ?? 0);
  const wh = round2(e.wh ?? 0);
  const status = e.status ?? "paid";
  const row = must(await sb.from("transactions").insert({
    org_id, tx_date: e.tx_date, paid_on: e.paid_on ?? (status === "paid" ? e.tx_date : null), due_date: e.due_date ?? null,
    direction: e.direction ?? "expense", scope: e.scope ?? "business", status, origin: e.photo ? "ai_document" : "ai_nl",
    gross_amount: round2(net + vat - wh), net_amount: net, vat_amount: vat, withholding_amount: wh, has_invoice: vat > 0 || wh > 0 || !!e.invoice_number,
    vat_rate: net && vat ? round2(vat / net) : null,
    project_id, category_id, account_id, contact_id, counterparty_name: e.counterparty_name ?? null, counterparty_afm: afm,
    invoice_number: e.invoice_number ?? null, description: e.description, notes: e.notes ?? null, source_document_id,
  }).select("id, tx_date, gross_amount").single(), "transaction insert");
  console.log(`Καταχωρήθηκε ${row.id}: ${row.tx_date} ${row.gross_amount} €${source_document_id ? " (με φωτογραφία)" : ""}`);
}

// Catalogue a Drive folder inventory (JSON: { files: [{ id, title, mimeType,
// fileSize, modifiedTime, viewUrl, path, duplicateOf? }] }) as project files.
// Idempotent: rows are matched on the Drive file id.
async function files(sb, projectCode, file, write) {
  const inv = JSON.parse(fs.readFileSync(file, "utf8").replace(/^﻿/, ""));
  const project = must(await sb.from("projects").select("id, org_id, display_name").eq("code", projectCode).single(), `project ${projectCode}`);
  const { data: existing, error } = await sb.from("project_files").select("id, external_id").eq("project_id", project.id).eq("source", "google_drive");
  if (error) throw new Error(`Ο πίνακας project_files δεν υπάρχει ακόμα στο staging (χρειάζεται το migration 0023): ${error.message}`);
  const byExt = new Map(existing.map((r) => [r.external_id, r.id]));
  const row = (f) => ({
    org_id: project.org_id, project_id: project.id, folder: f.path ?? [], title: f.title, mime_type: f.mimeType ?? null,
    size_bytes: f.fileSize != null ? Number(f.fileSize) : null, source: "google_drive", external_id: f.id, url: f.viewUrl,
    file_modified_at: f.modifiedTime ?? null,
  });
  const canonical = inv.files.filter((f) => !f.duplicateOf);
  const dups = inv.files.filter((f) => f.duplicateOf);
  const fresh = canonical.filter((f) => !byExt.has(f.id)).length + dups.filter((f) => !byExt.has(f.id)).length;
  console.log(`${project.display_name}: ${canonical.length} αρχεία + ${dups.length} διπλότυπα · ${fresh} νέα, ${inv.files.length - fresh} ήδη καταχωρημένα`);
  if (!write) return console.log("Τίποτα δεν γράφτηκε. Για καταχώρηση: node scripts/staging.cjs files <κωδικός έργου> <inventory.json> --write");
  for (const pass of [canonical, dups]) {
    for (const f of pass) {
      const r = row(f);
      if (f.duplicateOf) r.duplicate_of = byExt.get(f.duplicateOf) ?? null;
      if (byExt.has(f.id)) must(await sb.from("project_files").update(r).eq("id", byExt.get(f.id)), `update ${f.title}`);
      else byExt.set(f.id, must(await sb.from("project_files").insert(r).select("id").single(), `insert ${f.title}`).id);
    }
  }
  console.log("Καταχωρήθηκαν.");
}

// What the scenario page will read: open obligations by month, expected
// income, loans and their drawdowns.
async function forecastData(sb) {
  const month = new Date().toISOString().slice(0, 7);
  const tx = await fetchAll(sb, "transactions", "tx_date, due_date, direction, status, gross_amount, collection_probability, description, project_id");
  const open = tx.filter((t) => t.status === "pending" || t.status === "scheduled");
  const byMonth = {};
  for (const t of open) {
    const m = ((t.due_date ?? t.tx_date) < month ? month : (t.due_date ?? t.tx_date)).slice(0, 7);
    byMonth[m] ??= { out: 0, in: 0, n: 0 };
    byMonth[m][t.direction === "expense" ? "out" : "in"] += Number(t.gross_amount);
    byMonth[m].n++;
  }
  console.log("Ανοιχτές κινήσεις ανά μήνα (εκροές / εισροές / πλήθος):");
  for (const m of Object.keys(byMonth).sort().slice(0, 18)) console.log(`  ${m}  ${byMonth[m].out.toFixed(2).padStart(12)}  ${byMonth[m].in.toFixed(2).padStart(10)}  ${byMonth[m].n}`);
  const big = open.filter((t) => t.direction === "expense").sort((a, b) => b.gross_amount - a.gross_amount).slice(0, 8);
  console.log("Μεγαλύτερες μελλοντικές πληρωμές:");
  for (const t of big) console.log(`  ${t.due_date ?? t.tx_date}  ${t.gross_amount}  ${t.status}  ${String(t.description).slice(0, 60)}`);
  console.log("Αναμενόμενα:", JSON.stringify(must(await sb.from("expected_income").select("source, amount, certainty, expected_month, creates_liability"), "expected")));
  console.log("Δάνεια:", JSON.stringify(must(await sb.from("loans").select("label, principal, interest_rate, term_years, grace_years, first_amortisation_month, state, loan_drawdowns(scheduled_month, amount, actual_date)"), "loans")));
  console.log("Ρυθμίσεις org:", JSON.stringify(must(await sb.from("orgs").select("settings"), "orgs")));
}

// Ledger rows with no project in a date range, with where they came from.
async function noProject(sb, from, to) {
  const rows = must(await sb.from("transactions")
    .select("tx_date, direction, status, scope, gross_amount, description, notes, legacy_excel_id, plan_id, origin, accounts(name)")
    .is("project_id", null).gte("tx_date", from).lte("tx_date", to).order("tx_date"), "no-project");
  const by = {};
  for (const r of rows) {
    const src = r.legacy_excel_id?.split("-row-")[0] ?? (r.plan_id ? "πλάνο" : r.origin);
    by[src] = (by[src] ?? 0) + 1;
    console.log(`${r.tx_date} ${r.scope.padEnd(8)} ${String(r.gross_amount).padStart(9)} ${(r.accounts?.name ?? "—").padEnd(20)} ${src.padEnd(11)} ${String(r.description).slice(0, 45)} | ${String(r.notes ?? "").slice(0, 60)}`);
  }
  console.log(`\nΣύνολο ${rows.length}:`, JSON.stringify(by));
}

async function main() {
  const [cmd, file, flag, flag2] = process.argv.slice(2);
  if (cmd === "no-project") return noProject(stagingClient(), file, flag);
  if (cmd === "forecast-data") return forecastData(stagingClient());
  if (cmd === "files") return files(stagingClient(), file, flag, flag2 === "--write");
  const sb = stagingClient();
  if (cmd === "inspect") return inspect(sb);
  if (cmd === "balances") return balances(sb);
  if (cmd === "refs") return refs(sb);
  if (cmd === "add" && file) return add(sb, file);
  if (cmd === "load" && file) return load(sb, file, flag === "--write");
  console.error("usage: node scripts/staging.cjs inspect | balances | refs | add <entry.json> | load <workbook.xlsx> [--write] | files <project code> <inventory.json> [--write]");
  process.exit(1);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
