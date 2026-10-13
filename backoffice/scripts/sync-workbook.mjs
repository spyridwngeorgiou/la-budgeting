// One-off sync of the operational workbook (Επιχειρησιακό_Αρχείο_NNN.xlsx)
// into a hosted project, after which the app is the source of truth.
//
//   node scripts/sync-workbook.mjs <project-ref> <workbook.xlsx> [--apply] [--report <out.xlsx>]
//
// Dry run (default): read-only SELECTs through the Management API, computes
// the whole change set and writes a Greek report workbook (one sheet per
// change kind + «Σύνοψη»). Prints only counts -- the workbook holds real
// financial data, so amounts and names stay in the (git-ignored) report.
//
// --apply: needs a complete backup manifest younger than 24h
// (node scripts/backup-json.mjs <ref>), copies every row it will update into
// archive.<table>_sync<NNN>, then applies everything in ONE transaction.
// Every update is guarded by the values the plan was computed from (for a
// transaction: tx_date + net_amount + account); any mismatch aborts the whole
// run. Re-running is safe: inserts are keyed by legacy_excel_id /
// deterministic ids and the plan is recomputed from the live database.
//
// Mapping = archive/legacy-workbook-migration/tools (migrate_workbook.py,
// mappings.py, reconcile_workbook.py): same literal maps, same uuid5 ids, same
// credit-note flip, same «kiniseis-row-N» / «kathimerina-row-N» keys.
import { createHash } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import ExcelJS from "exceljs";
import { latestManifest, MAX_BACKUP_AGE_MS } from "./lib/destructive.mjs";
import { lit, loadEnv, makeQuery, root } from "./lib/supabase-api.mjs";

// ── Owner decisions for this sync (plan «2 · Συγχρονισμός με το αρχείο 184») ──
// Κινήσεις rows whose differing fields take the workbook value.
const EDIT_ROWS = new Set([8, 43, 51, 70, 78, 118]);
// Κινήσεις rows that go back to «Εκκρεμεί» (status pending, paid_on null).
const PENDING_ROWS = new Set([49, 50, 54, 71, 72]);
// Accounts whose opening balance/date follow the workbook. The others are
// plugs (see promote_staging.py) and are only reported.
// Owner decision 13/10: Μετρητά follows the workbook too.
const OPENING_ACCOUNTS = new Set(["Πειραιώς Προσωπικός", "Μετρητά"]);
// Projects whose budget lines follow «Προϋπολογισμοί».
const BUDGET_PROJECTS = ["Q003"];
// Καθημερινά: cash/app rows from the opening-balance month on; monthly bank
// aggregates («Τραπεζικό αρχείο») only from this month on -- the earlier ones
// were left out by the original import and are listed for a decision.
// Owner decision 13/10: the August aggregates (rows 88–98) are imported too.
const KATH_AGGREGATE_FROM_MONTH = "2026-08";
const KATH_CATEGORY = "Προσωπικά έξοδα";

// ── Literal maps (mirror of tools/mappings.py) ──
const DIRECTION = { "Έσοδο": "income", "Έξοδο": "expense" };
const STATUS = {
  "Πληρωμένο": "paid", "Εκκρεμεί": "pending", "Εκκρεμές": "pending", "Προγραμματισμένο": "scheduled",
  "Σε αναμονή": "pending", "Ακυρώθηκε": "cancelled", "Ακυρωμένο": "cancelled",
};
const ORIGIN = { AADE: "aade", "Χειρόγραφο": "manual", "Τραπεζικό αρχείο": "bank_file", "Εφαρμογή": "manual" };
const CERTAINTY = { "Βέβαιο": "certain", "Πιθανό": "probable" };
const PROPERTY_SHORT_NAME = {
  "ΗΛΙΟΥΠΟΛΗ": "Q001_ILIOUPOLI_P15_RESIDENCES",
  "ΛΑΖΑΡΑΚΗ": "Q003_LAZARAKI32_GLYFADA",
  "ΑΓ. ΚΩΝΣΤΑΝΤΙΝΟΥ": "Q004_AGIOU_KWNSTANTINOU20_GLYFADA",
  "ΑΓΙΟΥ ΚΩΝΣΤΑΝΤΙΝΟΥ": "Q004_AGIOU_KWNSTANTINOU20_GLYFADA",
  "ΚΑΒΟΥΡΙ": "Q006_KAVOURI_AKTIS2",
  "ΚΟΛΩΝΑΚΙ": "Q007_KOLONAKI_KARNEADOU37",
};
const MARK_RE = /^\d{15}$/;
const NAMESPACE = "6f6e0a4e-2f61-4e1a-9c1a-9f6b6f9a5b10";

// ── Small helpers ──
export function uuid5(name, ns = NAMESPACE) {
  const nsBytes = Buffer.from(ns.replace(/-/g, ""), "hex");
  const h = createHash("sha1").update(Buffer.concat([nsBytes, Buffer.from(name, "utf8")])).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
const stableId = (...parts) => uuid5(parts.join("|"));
const stripAccentsUpper = (s) => String(s).normalize("NFD").replace(/\p{Mn}/gu, "").toUpperCase().trim();
const normName = (v) => String(v ?? "").split(/\s+/).filter(Boolean).join(" ").toUpperCase();
const text = (v) => {
  const s = v == null ? "" : String(v).split(/\s+/).filter(Boolean).join(" ");
  return s || null;
};
const money = (v) => Math.round(Number(v || 0) * 100) / 100;
const sameMoney = (a, b) => Math.abs(money(a) - money(b)) < 0.005;
const normalizeAfm = (v) => {
  const d = String(v ?? "").replace(/\D/g, "");
  return d ? d.padStart(9, "0") : null;
};
const categoryCode = (name) => name.toUpperCase().replace(/ /g, "_").replace(/&/g, "AND");
const iso = (d) => d.toISOString().slice(0, 10);
function asDate(v) {
  if (v instanceof Date) return iso(v);
  if (typeof v === "number" && v > 20000 && v < 80000) return iso(new Date(Math.round((v - 25569) * 86400000)));
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  return null;
}
// A cell's cached value: formulas give their last result, rich text its text.
function cellValue(cell) {
  if (cell.isMerged && cell.master !== cell) return null;
  let v = cell.value;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    if ("result" in v) v = v.result;
    else if ("formula" in v || "sharedFormula" in v) v = null;
    else if (v.richText) v = v.richText.map((r) => r.text).join("");
    else if ("text" in v) v = v.text;
    else if ("error" in v) v = null;
  }
  if (v && typeof v === "object" && !(v instanceof Date) && "error" in v) v = null;
  return v ?? null;
}
function mapLiteral(map, value, column, row, problems) {
  const t = text(value);
  if (t == null) return null;
  if (!(t in map)) {
    problems.push({ sheet: column.sheet, row, reason: `Άγνωστη τιμή «${t}» στη στήλη ${column.name}` });
    return undefined;
  }
  return map[t];
}
function propertyCode(shortName) {
  const key = stripAccentsUpper(shortName);
  for (const [prefix, code] of Object.entries(PROPERTY_SHORT_NAME)) if (key.startsWith(prefix)) return code;
  return null;
}
const sqlNum = (v) => (v == null ? "null" : money(v).toFixed(2));
const sqlStr = (v) => (v == null ? "null" : lit(v));
const sqlDate = (v) => (v == null ? "null" : `${lit(v)}::date`);
const sqlUuid = (v) => (v == null ? "null" : `${lit(v)}::uuid`);

// ── Workbook ──
function sheetRows(wb, name, maxCol) {
  const ws = wb.getWorksheet(name);
  if (!ws) return null;
  const out = [];
  for (let r = 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const vals = [null];
    for (let c = 1; c <= maxCol; c++) vals.push(cellValue(row.getCell(c)));
    out.push({ r, v: vals });
  }
  return out;
}

function readKiniseis(wb, problems) {
  const sheet = { sheet: "Κινήσεις" };
  const out = new Map();
  for (const { r, v } of sheetRows(wb, "Κινήσεις", 37)) {
    if (r < 4 || v[1] == null || v[1] === "") continue;
    const p = [];
    let direction = mapLiteral(DIRECTION, v[9], { ...sheet, name: "Τύπος" }, r, p);
    const status = mapLiteral(STATUS, v[15], { ...sheet, name: "Κατάσταση" }, r, p);
    let origin = mapLiteral(ORIGIN, v[16], { ...sheet, name: "Προέλευση" }, r, p);
    const txDate = asDate(v[1]);
    if (!txDate) p.push({ sheet: "Κινήσεις", row: r, reason: "Χωρίς έγκυρη ημερομηνία παραστατικού" });
    if (!direction && direction !== undefined) p.push({ sheet: "Κινήσεις", row: r, reason: "Χωρίς τύπο (Έσοδο/Έξοδο)" });
    if (p.length) {
      problems.push(...p);
      continue;
    }
    // origin='aade' promises a real ΜΑΡΚ dedup; migrate_workbook.py downgrades it.
    origin = origin === "aade" || origin == null ? "manual" : origin;
    let net = money(v[10]), vat = money(v[11]), wh = money(v[12]);
    let gross = money(net + vat - wh);
    let flipped = false;
    if (gross < 0) {
      // credit notes: same flip as migrate_workbook.py
      direction = direction === "expense" ? "income" : "expense";
      [net, vat, wh, gross] = [-net, -vat, -wh, -gross];
      flipped = true;
    }
    const invoice = text(v[17]);
    const mark = invoice && MARK_RE.test(invoice) ? invoice : null;
    out.set(r, {
      row: r, key: `kiniseis-row-${r}`,
      tx_date: txDate, paid_on: asDate(v[2]), due_date: asDate(v[3]),
      counterparty_name: text(v[4]), afm: normalizeAfm(v[5]), project: text(v[6]), category: text(v[7]),
      description: text(v[8]), direction, net_amount: net, vat_amount: vat, withholding_amount: wh,
      gross_amount: gross, account: text(v[14]), status, origin,
      invoice_number: mark ? null : invoice, mydata_mark: mark, notes: text(v[18]), flipped,
      // Λογαριασμοί!C subtracts (Δόσεις Πληρωμένες − Δόσεις εντός βάσης) × Πληρωτέο of recurring expenses
      recurringPaid: text(v[19]) === "Ναι" && text(v[9]) === "Έξοδο"
        ? money((Number(v[21]) || 0) - (Number(v[37]) || 0)) * money(v[13]) : 0,
    });
  }
  return out;
}

function readKathimerina(wb, baseMonth, problems) {
  const expected = new Map();
  const excluded = [];
  for (const { r, v } of sheetRows(wb, "Καθημερινά", 15)) {
    if (r < 4) continue;
    const monthKey = text(v[2]);
    const key = `kathimerina-row-${r}`;
    if (!monthKey || !/^\d{4}-\d{2}$/.test(monthKey)) {
      if (text(v[3]) || v[4] != null) excluded.push({ row: r, key, reason: "Κενή γραμμή ή σύνολο (χωρίς μήνα)" });
      continue;
    }
    if (monthKey < baseMonth) continue; // inside the opening balances
    const originLit = text(v[7]);
    if (originLit === "Τραπεζικό αρχείο" && monthKey < KATH_AGGREGATE_FROM_MONTH) {
      excluded.push({ row: r, key, reason: "Μηνιαίο συγκεντρωτικό τράπεζας πριν από την απόφαση (εκτός εύρους)",
        month: monthKey, account: text(v[6]), amount: money(v[4]), description: text(v[3]) });
      continue;
    }
    const p = [];
    const origin = mapLiteral(ORIGIN, v[7], { sheet: "Καθημερινά", name: "Προέλευση" }, r, p) ?? "manual";
    const txDate = asDate(v[14]);
    if (!txDate) p.push({ sheet: "Καθημερινά", row: r, reason: "Χωρίς ημερομηνία (στήλη N)" });
    if (typeof v[4] !== "number") p.push({ sheet: "Καθημερινά", row: r, reason: "Μη αριθμητικό ποσό" });
    let property = null;
    if (text(v[13])) {
      property = propertyCode(v[13]);
      if (!property) p.push({ sheet: "Καθημερινά", row: r, reason: `Άγνωστο ακίνητο «${text(v[13])}»` });
    }
    if (p.length) {
      problems.push(...p);
      continue;
    }
    let amount = money(v[4]);
    let direction = "expense";
    if (amount < 0) {
      direction = "income";
      amount = -amount;
    }
    expected.set(r, {
      row: r, key, month_key: monthKey, tx_date: txDate, description: text(v[3]), gross_amount: amount,
      account: text(v[6]), origin: origin === "aade" ? "manual" : origin, notes: text(v[8]), property, direction,
    });
  }
  return { expected, excluded };
}

function readAccountsSheet(wb) {
  const rows = sheetRows(wb, "Λογαριασμοί", 10);
  const block = (header) => {
    const i = rows.findIndex((x) => text(x.v[1]) === header);
    if (i < 0) return [];
    const out = [];
    for (const x of rows.slice(i + 1)) {
      const name = text(x.v[1]);
      if (!name || name.startsWith("ΣΥΝΟΛΟ")) break;
      out.push(x);
    }
    return out;
  };
  return {
    accounts: block("Λογαριασμός").map(({ r, v }) => ({ row: r, name: text(v[1]), opening: v[2], current: v[4] })),
    expected: block("Πηγή").map(({ r, v }) => ({ row: r, source: text(v[1]), amount: v[2], certainty: text(v[3]), month: asDate(v[4]) })),
    liabilities: block("Δανειστής").map(({ r, v }) => ({ row: r, lender: text(v[1]), amount: v[2], maturity: asDate(v[3]) })),
  };
}

const BUDGET_ROWS = [
  [/^Απόκτηση/, "acquisition"],
  [/^Μελέτες/, "studies_permits_legal"],
  [/^Κατασκευή/, "construction_equipment"],
  [/^Εξοπλισμός & επίπλωση/, "construction_equipment"],
  [/^Λοιπά κόστη/, "other"],
];
function readBudgets(wb) {
  const rows = sheetRows(wb, "Προϋπολογισμοί", 9);
  const header = rows.find((x) => text(x.v[2]) === "ΕΡΓΟ");
  const out = [];
  if (!header) return out;
  for (const prefix of BUDGET_PROJECTS) {
    const col = header.v.findIndex((h) => typeof h === "string" && h.startsWith(prefix));
    if (col < 0) continue;
    const lines = {};
    const labels = {};
    let contingency = null, total = null;
    for (const { v } of rows) {
      const label = text(v[2]);
      if (!label) continue;
      const amount = typeof v[col] === "number" ? v[col] : null;
      for (const [re, code] of BUDGET_ROWS) {
        if (re.test(label) && amount != null) {
          lines[code] = money((lines[code] ?? 0) + amount);
          labels[code] ??= label;
        }
      }
      if (/^Απρόβλεπτα/.test(label)) contingency = amount ?? 0;
      if (/^ΚΑΘΑΡΟΣ ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ/.test(label)) total = amount;
    }
    out.push({ prefix, lines, labels, contingency, total });
  }
  return out;
}

const projectHeader = (label) => {
  const m = /^(Q\d{3})\b/.exec(label);
  return m ? m[1] : label === "Γενικά" ? "Q000" : null;
};
function utilityKind(label) {
  if (/Ρεύμα|ΔΕΗ/i.test(label)) return "electricity";
  if (/Νερό|ΕΥΔΑΠ/i.test(label)) return "water";
  if (/Internet|Cosmote/i.test(label)) return "internet";
  if (/Κινητό|Τηλέφωνο|Vodafone/i.test(label)) return "phone";
  return "other";
}
function readPagia(wb) {
  const rows = sheetRows(wb, "Πάγια", 6);
  if (!rows) return null;
  const out = [];
  let section = null, project = null;
  for (const { r, v } of rows) {
    const label = text(v[2]);
    if (!label) continue;
    if (label === "ΕΤΑΙΡΙΚΑ" || label === "ΠΡΟΣΩΠΙΚΑ") { section = label; continue; }
    if (label.startsWith("ΣΥΝΟΛΟ") || label.startsWith("ΓΕΝΙΚΟ")) { section = null; project = null; continue; }
    const head = projectHeader(label);
    if (head) { project = head; continue; }
    if (!section || !project) continue;
    const amount = typeof v[3] === "number" ? money(v[3]) : null;
    out.push({ row: r, section, project, label, amount });
  }
  return out;
}
function readUtilities(wb) {
  const rows = sheetRows(wb, "Ακίνητα & Παροχές", 8);
  if (!rows) return null;
  const out = [];
  let project = null;
  for (const { r, v } of rows) {
    const label = text(v[2]);
    if (!label) continue;
    const m = /^(Q\d{3})\s*·/.exec(label);
    if (m) { project = m[1]; continue; }
    if (label === "ΕΚΤΟΣ ΑΚΙΝΗΤΩΝ" || label === "Πώς χρησιμοποιείται") { project = null; continue; }
    if (!project || label === "Κατηγορία") continue;
    const notes = text(v[8]);
    out.push({
      row: r, project, label, supply: text(v[3]), amount: typeof v[4] === "number" ? money(v[4]) : null,
      frequency: text(v[5]), extrait: text(v[6]), notes,
    });
  }
  return out;
}
const FREQ = { "μηνιαίο": "monthly", "τρίμηνο": "quarterly", "εξάμηνο": "semiannual", "ετήσιο": "annual" };
const FREQ_MONTHS = { monthly: 1, quarterly: 3, semiannual: 6, annual: 12 };
function parseUtilityIds(notes) {
  const n = notes ?? "";
  const contract = /λογ\.\s*([0-9A-ZΑ-Ω]+)/.exec(n)?.[1] ?? /[Μμ]ητρώο\s*([0-9][0-9-]*[0-9])/.exec(n)?.[1] ?? null;
  const meter = /μετρητής\s*([0-9A-ZΑ-Ω]+)/.exec(n)?.[1] ?? null;
  const rf = /\b(RF\d{2}\d{5,})\b/.exec(n)?.[1] ?? null;
  return { contract_account: contract, meter_number: meter, rf_code: rf };
}
const PROVIDERS = ["ΔΕΗ", "ΕΥΔΑΠ", "Cosmote", "Vodafone"];
const providerOf = (label, extrait) => PROVIDERS.find((p) => label.toUpperCase().includes(p.toUpperCase())) ?? extrait;
const matchKey = (s) => String(s ?? "").toUpperCase().replace(/[^0-9A-ZΑ-Ω]/g, "");

function readContactsSheet(wb) {
  const map = new Map();
  for (const { r, v } of sheetRows(wb, "Επαφές", 2)) {
    if (r < 4) continue;
    const name = text(v[1]);
    if (!name || name === "ΣΥΝΟΛΟ") continue;
    map.set(normName(name), normalizeAfm(v[2]));
  }
  return map;
}

// ── Database snapshot (SELECT only) ──
async function snapshot(query) {
  const j = async (sql) => (await query(`select coalesce(json_agg(t), '[]'::json) as rows from (${sql}) t`))[0].rows;
  // The org the workbook was migrated into: the one that owns the legacy rows
  // (staging also holds throwaway smoke-test orgs).
  const orgs = await j("select org_id as id from transactions where legacy_excel_id is not null group by 1");
  if (orgs.length !== 1) throw new Error(`expected the legacy rows in one org, found ${orgs.length}`);
  const o = lit(orgs[0].id);
  return {
    orgId: orgs[0].id,
    projects: await j(`select id, code from projects where org_id = ${o}`),
    categories: await j(`select id, code, name from categories where org_id = ${o}`),
    accounts: await j(`select id, name, opening_balance, opening_balance_date from accounts where org_id = ${o}`),
    contacts: await j(`select id, name, afm, aliases from contacts where org_id = ${o}`),
    txs: await j(`select t.id, t.legacy_excel_id, t.plan_id, t.loan_id, t.lease_id, t.origin, t.tx_date, t.paid_on,
      t.due_date, t.counterparty_name, t.counterparty_afm, t.contact_id, t.description, t.direction, t.net_amount,
      t.vat_amount, t.withholding_amount, t.gross_amount, t.status, t.invoice_number, t.mydata_mark, t.notes,
      t.month_key, t.account_id, t.project_id, t.category_id, t.property_project_id, t.signed_amount
      from transactions t where t.org_id = ${o}`),
    liabilities: await j(`select id, lender, principal, maturity_date from liabilities where org_id = ${o}`),
    expected: await j(`select id, source, amount, certainty, expected_month, status from expected_income where org_id = ${o}`),
    budgets: await j(`select b.id budget_id, b.project_id, b.contingency_pct, l.id line_id, l.line_code, l.label, l.amount
      from project_budgets b left join budget_lines l on l.budget_id = b.id where b.is_current and b.org_id = ${o}`),
    utilities: await j(`select id, project_id, kind, provider, supply_number, contract_account, rf_code, meter_number,
      notes, is_active from property_utilities where org_id = ${o}`),
    utilityCols: (await j(`select column_name from information_schema.columns
      where table_schema = 'public' and table_name = 'property_utilities'`)).map((c) => c.column_name),
    plans: await j(`select id, label, project_id, amount_per_installment, frequency, status, obligation_kind
      from installment_plans where org_id = ${o}`),
  };
}

// ── Plan ──
function buildPlan(wbData, db) {
  const P = {
    categories: [], contacts: [], kinInserts: [], kathInserts: [], links: [], ambiguous: [],
    edits: [], pending: [], keptDiffs: [], accounts: [], accountsInfo: [], liabilities: [], expected: [],
    budgets: [], utilities: [], utilityAmounts: [], pagia: [], orphans: [], unmapped: [...wbData.problems],
    excludedKath: wbData.kath.excluded, balances: [], balanceRule: [], migrations: [], notes: [],
  };
  const org = db.orgId;
  const projectByCode = new Map(db.projects.map((p) => [p.code, p]));
  const projectByPrefix = (prefix) => db.projects.find((p) => p.code.startsWith(`${prefix}_`) || p.code === prefix);
  const accountByName = new Map(db.accounts.map((a) => [a.name.trim(), a]));
  const categoryByName = new Map(db.categories.map((c) => [c.name.trim(), c]));
  const categoryById = new Map(db.categories.map((c) => [c.id, c]));
  const accountById = new Map(db.accounts.map((a) => [a.id, a]));
  const projectById = new Map(db.projects.map((p) => [p.id, p]));
  const byLegacy = new Map(db.txs.filter((t) => t.legacy_excel_id).map((t) => [t.legacy_excel_id, t]));

  // contacts: afm and name index (name + aliases)
  const contactByAfm = new Map(), contactByName = new Map(), contactAfm = new Map();
  for (const c of db.contacts) {
    if (c.afm) { contactByAfm.set(normalizeAfm(c.afm), c.id); contactAfm.set(c.id, normalizeAfm(c.afm)); }
    contactByName.set(normName(c.name), c.id);
    for (const a of c.aliases ?? []) contactByName.set(normName(a), c.id);
  }
  const resolveContact = (name, afm) => {
    const a = normalizeAfm(afm);
    if (a && contactByAfm.has(a)) return contactByAfm.get(a);
    if (name && contactByName.has(normName(name))) return contactByName.get(normName(name));
    return null;
  };
  const ensureContact = (name, afm, row) => {
    if (!name) return null;
    const found = resolveContact(name, afm);
    if (found) return found;
    const a = normalizeAfm(afm) ?? wbData.contactsSheet.get(normName(name)) ?? null;
    const id = stableId("contact", a ?? normName(name));
    const c = { id, name, afm: a, row, inSheet: wbData.contactsSheet.has(normName(name)) };
    P.contacts.push(c);
    contactByName.set(normName(name), id);
    if (a) { contactByAfm.set(a, id); contactAfm.set(id, a); }
    return id;
  };
  const ensureCategory = (name, row) => {
    if (!name) return null;
    const found = categoryByName.get(name);
    if (found) return found.id;
    const code = categoryCode(name);
    const existingCode = db.categories.find((c) => c.code === code);
    if (existingCode) return existingCode.id;
    // migrate_workbook.py: «Δάνειο» is financing; «Δανεισμός» is the same thing
    // (a loan drawdown is not income for the P&L).
    const isFinancing = /^ΔΑΝΕΙ/.test(stripAccentsUpper(name));
    const c = { id: stableId("category", code), code, name, is_financing: isFinancing, row };
    P.categories.push(c);
    categoryByName.set(name, c);
    return c.id;
  };
  const resolveAccount = (name, sheet, row) => {
    if (!name) return null;
    const a = accountByName.get(name);
    if (!a) P.unmapped.push({ sheet, row, reason: `Άγνωστος λογαριασμός «${name}»` });
    return a ? a.id : undefined;
  };

  // duplicate guard for new rows: an app row (no legacy id) with the same
  // account, direction, gross and date (tx_date or paid_on).
  const claimed = new Set();
  const findExisting = (accountId, direction, gross, dates) =>
    db.txs.filter((t) => !t.legacy_excel_id && !claimed.has(t.id) && t.account_id === accountId && t.direction === direction
      && sameMoney(t.gross_amount, gross) && (dates.includes(t.tx_date) || dates.includes(t.paid_on)));

  // ── Κινήσεις ──
  for (const [row, w] of wbData.kin) {
    const projectId = w.project ? projectByCode.get(w.project)?.id : null;
    if (w.project && !projectId) { P.unmapped.push({ sheet: "Κινήσεις", row, reason: `Άγνωστο έργο «${w.project}»` }); continue; }
    const accountId = resolveAccount(w.account, "Κινήσεις", row);
    if (accountId === undefined) continue;
    const tx = byLegacy.get(w.key);
    if (!tx) {
      const dates = [w.tx_date, w.paid_on].filter(Boolean);
      const hits = findExisting(accountId, w.direction, w.gross_amount, dates);
      if (hits.length === 1) {
        claimed.add(hits[0].id);
        P.links.push({ sheet: "Κινήσεις", row, key: w.key, tx: hits[0], w });
        continue;
      }
      if (hits.length > 1) {
        P.ambiguous.push({ sheet: "Κινήσεις", row, key: w.key, w, n: hits.length });
        continue;
      }
      const contactId = ensureContact(w.counterparty_name, w.afm, row);
      const categoryId = ensureCategory(w.category, row);
      P.kinInserts.push({
        ...w, id: stableId("tx", "kiniseis-row", String(row)), project_id: projectId, account_id: accountId,
        category_id: categoryId, contact_id: contactId,
        counterparty_afm: w.afm ?? (contactId ? contactAfm.get(contactId) ?? null : null),
        has_invoice: w.vat_amount !== 0 || w.withholding_amount !== 0,
      });
      continue;
    }
    // existing row: field diff
    const dbv = {
      tx_date: tx.tx_date, paid_on: tx.paid_on, due_date: tx.due_date, counterparty_name: text(tx.counterparty_name),
      project: projectById.get(tx.project_id)?.code ?? null, category: categoryById.get(tx.category_id)?.name ?? null,
      description: text(tx.description), direction: tx.direction, net_amount: money(tx.net_amount),
      vat_amount: money(tx.vat_amount), withholding_amount: money(tx.withholding_amount),
      gross_amount: money(tx.gross_amount), account: accountById.get(tx.account_id)?.name ?? null, status: tx.status,
      invoice_number: text(tx.invoice_number), mydata_mark: text(tx.mydata_mark), notes: text(tx.notes),
    };
    const diffs = [];
    for (const f of Object.keys(dbv)) {
      const a = w[f], b = dbv[f];
      let same;
      if (a == null && (b == null || b === "")) same = true;
      else if (f.endsWith("_amount")) same = sameMoney(a, b);
      else if (f === "counterparty_name") same = normName(a) === normName(b);
      else if (f === "notes") same = a == null || (b != null && normName(b).includes(normName(a)));
      else same = a === b;
      if (!same) diffs.push({ field: f, db: b, wb: a });
    }
    if (PENDING_ROWS.has(row)) {
      const flip = { row, key: w.key, tx, from: { status: tx.status, paid_on: tx.paid_on } };
      if (tx.status !== "pending" || tx.paid_on != null) P.pending.push(flip);
      for (const d of diffs.filter((d) => d.field !== "status" && d.field !== "paid_on")) P.keptDiffs.push({ row, key: w.key, ...d, plan: !!tx.plan_id });
      continue;
    }
    if (EDIT_ROWS.has(row) && !diffs.length) {
      P.notes.push({ key: w.key, note: w.flipped
        ? "Καμία διαφορά: το πιστωτικό είναι ήδη στην εφαρμογή με αντίθετη κατεύθυνση και θετικά ποσά (κανόνας της αρχικής μετάβασης)"
        : "Καμία διαφορά με την αντιστοίχιση της αρχικής μετάβασης (π.χ. κενά/στρογγυλοποίηση)" });
    }
    if (EDIT_ROWS.has(row) && diffs.length) {
      const set = {};
      for (const d of diffs) {
        if (d.field === "project") set.project_id = projectId;
        else if (d.field === "category") set.category_id = ensureCategory(w.category, row);
        else if (d.field === "account") set.account_id = accountId;
        else if (d.field === "counterparty_name") {
          set.counterparty_name = w.counterparty_name;
          set.contact_id = ensureContact(w.counterparty_name, w.afm, row);
        } else set[d.field] = w[d.field];
      }
      if ("vat_amount" in set || "withholding_amount" in set) set.has_invoice = w.vat_amount !== 0 || w.withholding_amount !== 0;
      P.edits.push({ row, key: w.key, tx, diffs, set });
      continue;
    }
    for (const d of diffs) P.keptDiffs.push({ row, key: w.key, ...d, plan: !!tx.plan_id });
  }

  // ── Καθημερινά ──
  const kathCategory = categoryByName.get(KATH_CATEGORY);
  if (!kathCategory) P.unmapped.push({ sheet: "Καθημερινά", row: null, reason: `Λείπει η κατηγορία «${KATH_CATEGORY}»` });
  for (const [row, w] of wbData.kath.expected) {
    const accountId = resolveAccount(w.account, "Καθημερινά", row);
    if (accountId === undefined) continue;
    const tx = byLegacy.get(w.key);
    if (tx) {
      const checks = [
        ["tx_date", tx.tx_date, w.tx_date], ["gross_amount", money(tx.gross_amount), w.gross_amount],
        ["account", accountById.get(tx.account_id)?.name ?? null, w.account], ["description", text(tx.description), w.description],
      ];
      for (const [field, b, a] of checks) {
        const same = field === "gross_amount" ? sameMoney(a, b) : a === b;
        if (!same) P.keptDiffs.push({ row, key: w.key, field, db: b, wb: a, plan: false });
      }
      continue;
    }
    const hits = findExisting(accountId, w.direction, w.gross_amount, [w.tx_date]);
    if (hits.length === 1) {
      claimed.add(hits[0].id);
      P.links.push({ sheet: "Καθημερινά", row, key: w.key, tx: hits[0], w });
      continue;
    }
    if (hits.length > 1) {
      P.ambiguous.push({ sheet: "Καθημερινά", row, key: w.key, w, n: hits.length });
      continue;
    }
    const property = w.property ? projectByCode.get(w.property)?.id ?? null : null;
    P.kathInserts.push({
      ...w, id: stableId("tx", "kathimerina-row", String(row)), account_id: accountId,
      category_id: kathCategory?.id ?? null, property_project_id: property,
    });
  }

  // orphans: legacy ids the workbook no longer has
  const wbKeys = new Set([...[...wbData.kin.values()].map((w) => w.key), ...[...wbData.kath.expected.values()].map((w) => w.key),
    ...wbData.kath.excluded.map((x) => x.key)]);
  for (const t of db.txs) {
    if (t.legacy_excel_id && /^(kiniseis|kathimerina)-row-\d+$/.test(t.legacy_excel_id) && !wbKeys.has(t.legacy_excel_id)) {
      P.orphans.push({ key: t.legacy_excel_id, tx: t });
    }
  }

  // ── Λογαριασμοί ──
  for (const a of wbData.accounts.accounts) {
    const d = accountByName.get(a.name);
    if (!d) { P.unmapped.push({ sheet: "Λογαριασμοί", row: a.row, reason: `Άγνωστος λογαριασμός «${a.name}»` }); continue; }
    if (typeof a.opening !== "number") continue;
    const same = sameMoney(a.opening, d.opening_balance) && d.opening_balance_date === wbData.baseDate;
    if (same) continue;
    const item = { name: a.name, id: d.id, from: { opening: money(d.opening_balance), date: d.opening_balance_date },
      to: { opening: money(a.opening), date: wbData.baseDate }, row: a.row };
    (OPENING_ACCOUNTS.has(a.name) ? P.accounts : P.accountsInfo).push(item);
  }
  for (const l of wbData.accounts.liabilities) {
    if (typeof l.amount !== "number") continue;
    const d = db.liabilities.filter((x) => normName(x.lender) === normName(l.lender));
    if (d.length !== 1) { P.unmapped.push({ sheet: "Λογαριασμοί", row: l.row, reason: `Υποχρέωση «${l.lender}»: ${d.length} αντιστοιχίες στη βάση` }); continue; }
    const set = {};
    if (!sameMoney(d[0].principal, l.amount)) set.principal = money(l.amount);
    if (l.maturity && l.maturity !== d[0].maturity_date) set.maturity_date = l.maturity;
    if (Object.keys(set).length) P.liabilities.push({ lender: l.lender, row: l.row, id: d[0].id, from: d[0], set });
  }
  for (const e of wbData.accounts.expected) {
    if (typeof e.amount !== "number") continue;
    const d = db.expected.filter((x) => normName(x.source) === normName(e.source) && x.status === "expected");
    if (d.length !== 1) { P.unmapped.push({ sheet: "Λογαριασμοί", row: e.row, reason: `Αναμενόμενο «${e.source}»: ${d.length} αντιστοιχίες στη βάση` }); continue; }
    const set = {};
    if (!sameMoney(d[0].amount, e.amount)) set.amount = money(e.amount);
    const cert = CERTAINTY[e.certainty];
    if (cert && cert !== d[0].certainty) set.certainty = cert;
    if (e.month && e.month !== d[0].expected_month) set.expected_month = e.month;
    if (Object.keys(set).length) P.expected.push({ source: e.source, row: e.row, id: d[0].id, from: d[0], set });
  }

  // ── Προϋπολογισμοί ──
  for (const b of wbData.budgets) {
    const project = projectByPrefix(b.prefix);
    const lines = db.budgets.filter((x) => x.project_id === project?.id);
    if (!project || !lines.length) { P.unmapped.push({ sheet: "Προϋπολογισμοί", row: null, reason: `${b.prefix}: χωρίς τρέχοντα προϋπολογισμό στη βάση` }); continue; }
    const budgetId = lines[0].budget_id;
    const sum = money(Object.values(b.lines).reduce((s, x) => s + x, 0) * (1 + (b.contingency ?? 0)));
    if (b.total != null && !sameMoney(sum, b.total)) {
      P.unmapped.push({ sheet: "Προϋπολογισμοί", row: null, reason: `${b.prefix}: οι γραμμές δεν αθροίζουν στον καθαρό προϋπολογισμό` });
      continue;
    }
    const dbTotal = money(lines.reduce((s, x) => s + Number(x.amount ?? 0), 0));
    const codes = new Set([...Object.keys(b.lines), ...lines.filter((x) => x.line_code).map((x) => x.line_code)]);
    for (const code of codes) {
      const have = lines.find((x) => x.line_code === code);
      const want = b.lines[code] ?? 0;
      if (have && sameMoney(have.amount, want)) continue;
      if (!have && want === 0) continue;
      P.budgets.push({ project: project.code, budgetId, code, line: have ?? null, from: have ? money(have.amount) : null,
        to: want, label: b.labels[code] ?? have?.label ?? null, dbTotal, wbTotal: b.total });
    }
    if (b.contingency != null && !sameMoney(Number(lines[0].contingency_pct) * 10000, b.contingency * 10000)) {
      P.budgets.push({ project: project.code, budgetId, code: "contingency_pct", from: Number(lines[0].contingency_pct),
        to: b.contingency, dbTotal, wbTotal: b.total });
    }
  }

  // ── Ακίνητα & Παροχές → property_utilities ──
  const hasAmountCols = db.utilityCols.includes("monthly_amount") && db.utilityCols.includes("billing_frequency");
  if (!hasAmountCols) {
    P.migrations.push({
      what: "property_utilities: ποσό και συχνότητα πληρωμής",
      sql: "alter table property_utilities add column monthly_amount numeric(14,2) check (monthly_amount is null or monthly_amount >= 0), add column billing_frequency plan_frequency;",
      why: "Τα «Πάγια» και η στήλη «Ποσό/Συχνότητα» του «Ακίνητα & Παροχές» δεν έχουν πού να γραφτούν· οι αριθμοί παροχής/λογαριασμού χωράνε ήδη (supply_number, contract_account, rf_code, meter_number).",
    });
  }
  const utilByKey = new Map(db.utilities.filter((u) => u.supply_number).map((u) => [`${u.kind}|${matchKey(u.supply_number)}`, u]));
  const amountTargets = []; // {project, kind, utilityId|new, monthly, frequency, source}
  for (const u of wbData.utilities ?? []) {
    const project = projectByPrefix(u.project);
    if (!project) { P.unmapped.push({ sheet: "Ακίνητα & Παροχές", row: u.row, reason: `Άγνωστο έργο ${u.project}` }); continue; }
    if (/^Ρυθμίσεις/.test(u.label)) {
      P.utilities.push({ action: "skip", row: u.row, project: project.code, label: u.label, reason: "Ρυθμίσεις εφορίας — καλύπτονται από τα πλάνα δόσεων" });
      continue;
    }
    if (!u.supply) continue; // ΛΕΙΠΕΙ / no identifier: nothing to recognise by
    const kind = utilityKind(u.label);
    const ids = parseUtilityIds(u.notes);
    const provider = providerOf(u.label, u.extrait);
    const isActive = !/ΔΕΝ πληρώνεται|ΜΗΝ καταχωρείται/i.test(`${u.label} ${u.notes ?? ""}`);
    const have = utilByKey.get(`${kind}|${matchKey(u.supply)}`);
    const frequency = FREQ[u.frequency] ?? null;
    // rent is already an installment plan: its IBAN is kept for recognition only
    const carriesAmount = isActive && u.amount != null && frequency && !/Ενοίκιο/i.test(u.label);
    if (!have) {
      const id = stableId("property_utility", kind, matchKey(u.supply));
      P.utilities.push({ action: "insert", row: u.row, id, project: project.code, project_id: project.id, kind, provider,
        supply_number: u.supply, ...ids, notes: u.notes, is_active: isActive, label: u.label });
      if (carriesAmount) amountTargets.push({ utilityId: id, project: project.code, label: u.label, bill: u.amount, frequency });
      continue;
    }
    const set = {};
    if (have.project_id !== project.id) set.project_id = project.id;
    for (const f of ["contract_account", "rf_code", "meter_number"]) if (ids[f] && ids[f] !== have[f]) set[f] = ids[f];
    if (provider && !have.provider) set.provider = provider;
    if (have.is_active !== isActive) set.is_active = isActive;
    if (Object.keys(set).length) P.utilities.push({ action: "update", row: u.row, id: have.id, project: project.code, kind, label: u.label, from: have, set });
    if (carriesAmount) amountTargets.push({ utilityId: have.id, project: project.code, label: u.label, bill: u.amount, frequency });
  }
  const pagiaUtilities = new Set();

  // ── Πάγια ──
  const activePlans = db.plans.filter((p) => p.status === "active" && p.frequency === "monthly");
  for (const g of wbData.pagia ?? []) {
    const project = projectByPrefix(g.project);
    const base = { row: g.row, section: g.section, project: project?.code ?? g.project, label: g.label, amount: g.amount };
    if (g.amount == null) { P.pagia.push({ ...base, target: "—", status: "Χωρίς ποσό (δεν τρέχει ακόμη)" }); continue; }
    if (!project) { P.pagia.push({ ...base, target: "—", status: "Άγνωστο έργο" }); continue; }
    let obligation = null;
    if (/Ενοίκιο/i.test(g.label)) obligation = "rent";
    else if (/Ρυθμίσεις/i.test(g.label)) obligation = "third_party_tax_settlement";
    if (obligation || /Λογιστ/i.test(g.label)) {
      const plans = activePlans.filter((p) => p.project_id === project.id
        && (obligation ? p.obligation_kind === obligation : /Λογιστ/i.test(p.label)));
      const total = money(plans.reduce((s, p) => s + Number(p.amount_per_installment), 0));
      P.pagia.push({ ...base, target: `πλάνα δόσεων (${plans.length})`, dbAmount: plans.length ? total : null,
        status: !plans.length ? "Δεν υπάρχει πλάνο — δημιουργήστε το από την εφαρμογή" : sameMoney(total, g.amount) ? "Ταιριάζει" : "Διαφορά — ελέγξτε το πλάνο" });
      continue;
    }
    const kind = utilityKind(g.label);
    const utils = db.utilities.filter((u) => u.project_id === project.id && u.kind === kind && u.is_active)
      .concat(P.utilities.filter((u) => u.action === "insert" && u.project_id === project.id && u.kind === kind && u.is_active));
    const target = utils.length === 1 ? utils[0].id : null;
    const monthly = g.amount;
    const fromSheet = amountTargets.find((t) => t.utilityId === target);
    const item = { ...base, target: utils.length === 1 ? `παροχή ${kind}` : utils.length ? `${utils.length} παροχές ${kind}` : `νέα παροχή ${kind}`,
      utilityId: target, kind, project_id: project.id, monthly, frequency: fromSheet?.frequency ?? "monthly" };
    if (!hasAmountCols) item.status = "Απαιτείται migration (ποσό παροχής)";
    else if (utils.length > 1) item.status = "Πολλές παροχές — δεν αποδίδεται αυτόματα";
    else item.status = "Θα γραφτεί";
    P.pagia.push(item);
    if (target) pagiaUtilities.add(target);
    if (hasAmountCols && utils.length <= 1) P.utilityAmounts.push(item);
  }
  // utilities with an amount in «Ακίνητα & Παροχές» but no «Πάγια» line
  for (const t of amountTargets) {
    if (pagiaUtilities.has(t.utilityId)) continue;
    const item = { row: null, section: "Ακίνητα & Παροχές", project: t.project, label: t.label, amount: t.bill,
      target: "παροχή", utilityId: t.utilityId, monthly: money(t.bill / FREQ_MONTHS[t.frequency]), frequency: t.frequency,
      status: hasAmountCols ? "Θα γραφτεί" : "Απαιτείται migration (ποσό παροχής)" };
    P.pagia.push(item);
    if (hasAmountCols) P.utilityAmounts.push(item);
  }

  // ── Υπόλοιπα: the app's balance rule (v_account_balances) after the sync vs the workbook ──
  const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10); // Athens, close enough
  const after = new Map(db.txs.map((t) => [t.id, { account_id: t.account_id, status: t.status, tx_date: t.tx_date,
    paid_on: t.paid_on, signed: Number(t.signed_amount ?? 0), plan: !!t.plan_id }]));
  const signed = (direction, gross) => (direction === "income" ? gross : -gross);
  for (const e of P.edits) {
    const t = after.get(e.tx.id);
    const w = wbData.kin.get(e.row);
    Object.assign(t, { account_id: e.set.account_id ?? t.account_id, status: e.set.status ?? t.status,
      tx_date: e.set.tx_date ?? t.tx_date, paid_on: "paid_on" in e.set ? e.set.paid_on : t.paid_on,
      signed: signed(w.direction, w.gross_amount) });
  }
  for (const f of P.pending) Object.assign(after.get(f.tx.id), { status: "pending", paid_on: null });
  for (const r of P.kinInserts) after.set(r.id, { account_id: r.account_id, status: r.status, tx_date: r.tx_date, paid_on: r.paid_on, signed: signed(r.direction, r.gross_amount) });
  for (const r of P.kathInserts) after.set(r.id, { account_id: r.account_id, status: "paid", tx_date: r.tx_date, paid_on: r.tx_date, signed: signed(r.direction, r.gross_amount) });
  for (const a of wbData.accounts.accounts) {
    const d = accountByName.get(a.name);
    if (!d || typeof a.current !== "number") continue;
    const acc = P.accounts.find((x) => x.id === d.id);
    const opening = acc ? acc.to.opening : money(d.opening_balance);
    const since = acc ? acc.to.date : d.opening_balance_date;
    let bal = opening, ruleDiff = 0, planApp = 0;
    for (const [id, t] of after) {
      if (t.account_id !== d.id || t.status !== "paid") continue;
      const paid = t.paid_on ?? t.tx_date;
      const inApp = t.tx_date >= since && paid <= today;
      const inWorkbook = paid > wbData.baseDate; // Λογαριασμοί!C: paid after Ρυθμίσεις!C28, no "today" cut
      if (inApp) bal += t.signed;
      // instalment rows: the workbook counts them through the recurring term instead
      if (t.plan) { if (inApp) planApp += t.signed; continue; }
      if (inApp !== inWorkbook) {
        ruleDiff += inApp ? t.signed : -t.signed;
        const tx = db.txs.find((x) => x.id === id);
        P.balanceRule.push({ account: a.name, key: tx?.legacy_excel_id ?? "(εφαρμογή)", tx_date: t.tx_date, paid_on: paid,
          amount: money(t.signed), reason: inApp ? "Μετρά στην εφαρμογή, όχι στο 184" : t.tx_date < since
            ? "Ημ. παραστατικού πριν την έναρξη, πληρωμή μετά: το 184 τη μετρά, η εφαρμογή όχι"
            : "Πληρωμή μετά από σήμερα: το 184 τη μετρά ήδη" });
      }
    }
    const left = money(P.excludedKath.filter((x) => x.account === a.name).reduce((s, x) => s + (x.amount ?? 0), 0));
    // app − workbook from instalments: the workbook subtracts (paid − in-base) × amount, the app its paid plan rows
    const recurring = money([...wbData.kin.values()].filter((w) => w.account === a.name).reduce((s, w) => s + w.recurringPaid, 0) + planApp);
    P.balances.push({ name: a.name, workbook: money(a.current), app: money(bal), diff: money(bal - a.current),
      rule: money(ruleDiff), excluded: left, recurring, residual: money(bal - a.current - ruleDiff - left - recurring) });
  }
  return P;
}

// ── Report workbook ──
async function writeReport(path, P, meta) {
  const wb = new ExcelJS.Workbook();
  const add = (name, columns, rows) => {
    const ws = wb.addWorksheet(name);
    ws.columns = columns.map(([header, key, width]) => ({ header, key, width: width ?? 18 }));
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: "frozen", ySplit: 1 }];
    for (const r of rows) ws.addRow(r);
    if (!rows.length) ws.addRow({ [columns[0][1]]: "(καμία)" });
    return ws;
  };
  const counts = summaryCounts(P);
  const sum = wb.addWorksheet("Σύνοψη");
  sum.columns = [{ width: 46 }, { width: 14 }, { width: 90 }];
  sum.addRow([`Αντιπαραβολή ${meta.workbook} → ${meta.env} (${meta.ref})`]).font = { bold: true, size: 13 };
  sum.addRow([`Ημερομηνία: ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${meta.apply ? "ΕΦΑΡΜΟΓΗ" : "στεγνό τρέξιμο — τίποτα δεν γράφτηκε"}`]);
  sum.addRow([`Ημερομηνία υπολοίπων έναρξης (Ρυθμίσεις C28): ${meta.baseDate}`]);
  sum.addRow([]);
  sum.addRow(["Είδος αλλαγής", "Πλήθος", "Τι γίνεται"]).font = { bold: true };
  for (const [label, n, what] of counts) sum.addRow([label, n, what]);
  if (P.migrations.length) {
    sum.addRow([]);
    sum.addRow(["Απαιτούμενο migration (δεν εφαρμόζεται από το script)"]).font = { bold: true };
    for (const m of P.migrations) { sum.addRow([m.what, "", m.why]); sum.addRow(["", "", m.sql]); }
  }

  const txCols = [["Γραμμή", "row", 8], ["Κλειδί", "key", 22], ["Ημ/νία", "tx_date", 12], ["Πληρωμή", "paid_on", 12],
    ["Επαφή", "counterparty_name", 28], ["Έργο", "project", 30], ["Κατηγορία", "category", 22], ["Περιγραφή", "description", 40],
    ["Τύπος", "direction", 9], ["Καθαρό", "net_amount", 12], ["ΦΠΑ", "vat_amount", 10], ["Παρακράτηση", "withholding_amount", 10],
    ["Μικτό", "gross_amount", 12], ["Λογαριασμός", "account", 20], ["Κατάσταση", "status", 11], ["Προέλευση", "origin", 10],
    ["ΜΑΡΚ", "mydata_mark", 18], ["Σημειώσεις", "notes", 50]];
  add("Νέες κινήσεις", txCols, P.kinInserts.map((r) => ({ ...r, notes: r.flipped ? `[πιστωτικό → αντίθετη κατεύθυνση] ${r.notes ?? ""}` : r.notes })));
  add("Νέα καθημερινά", [["Γραμμή", "row", 8], ["Κλειδί", "key", 24], ["Μήνας", "month_key", 9], ["Ημ/νία", "tx_date", 12],
    ["Κατηγορία (περιγραφή)", "description", 28], ["Ποσό", "gross_amount", 12], ["Λογαριασμός", "account", 20],
    ["Προέλευση", "origin", 10], ["Ακίνητο", "property", 30], ["Σημειώσεις", "notes", 60]], P.kathInserts);
  add("Σύνδεση με υπάρχουσες", [["Φύλλο", "sheet", 12], ["Γραμμή", "row", 8], ["Κλειδί", "key", 24], ["Ημ/νία", "date", 12],
    ["Ποσό", "amount", 12], ["Περιγραφή 184", "wdesc", 40], ["Περιγραφή εφαρμογής", "ddesc", 40], ["Τι γίνεται", "what", 50]],
  P.links.map((l) => ({ sheet: l.sheet, row: l.row, key: l.key, date: l.tx.tx_date, amount: money(l.tx.gross_amount),
    wdesc: l.w.description, ddesc: l.tx.description, what: "Υπάρχει ήδη στην εφαρμογή — παίρνει μόνο το κλειδί, όχι νέα εγγραφή" })));
  add("Πιθανά διπλά", [["Φύλλο", "sheet", 12], ["Γραμμή", "row", 8], ["Κλειδί", "key", 24], ["Ημ/νία", "date", 12],
    ["Ποσό", "amount", 12], ["Περιγραφή", "desc", 40], ["Υποψήφιες", "n", 10], ["Τι γίνεται", "what", 50]],
  P.ambiguous.map((a) => ({ sheet: a.sheet, row: a.row, key: a.key, date: a.w.tx_date, amount: a.w.gross_amount, desc: a.w.description,
    n: a.n, what: "Δεν εισάγεται — πολλές ίδιες κινήσεις στην εφαρμογή, χρειάζεται έλεγχος" })));
  add("Διορθώσεις", [["Γραμμή", "row", 8], ["Κλειδί", "key", 22], ["Πεδίο", "field", 20], ["Εφαρμογή σήμερα", "db", 40],
    ["Αρχείο 184 (νέα τιμή)", "wb", 40], ["Από πλάνο δόσεων", "plan", 10]],
  P.edits.flatMap((e) => e.diffs.map((d) => ({ row: e.row, key: e.key, field: d.field, db: d.db, wb: d.wb, plan: e.tx.plan_id ? "ναι" : "" }))));
  add("Εκκρεμεί", [["Γραμμή", "row", 8], ["Κλειδί", "key", 22], ["Κατάσταση σήμερα", "status", 16], ["Πληρώθηκε σήμερα", "paid_on", 14],
    ["Νέα κατάσταση", "to", 14], ["Από πλάνο δόσεων", "plan", 10]],
  P.pending.map((f) => ({ row: f.row, key: f.key, status: f.from.status, paid_on: f.from.paid_on, to: "pending · χωρίς ημ. πληρωμής", plan: f.tx.plan_id ? "ναι" : "" })));
  add("Διαφορές που μένουν", [["Γραμμή", "row", 8], ["Κλειδί", "key", 22], ["Πεδίο", "field", 20], ["Εφαρμογή (μένει)", "db", 40],
    ["Αρχείο 184", "wb", 40], ["Από πλάνο δόσεων", "plan", 10]], P.keptDiffs.map((d) => ({ ...d, plan: d.plan ? "ναι" : "" })));
  add("Επαφές", [["Όνομα", "name", 40], ["ΑΦΜ", "afm", 12], ["Στο φύλλο Επαφές", "inSheet", 14], ["Πρώτη γραμμή Κινήσεων", "row", 12]],
    P.contacts.map((c) => ({ ...c, inSheet: c.inSheet ? "ναι" : "όχι" })));
  add("Κατηγορίες", [["Όνομα", "name", 30], ["Κωδικός", "code", 30], ["Χρηματοδοτική", "fin", 14], ["Πρώτη γραμμή", "row", 12]],
    P.categories.map((c) => ({ ...c, fin: c.is_financing ? "ναι (εκτός αποτελεσμάτων)" : "όχι" })));
  const pos = [
    ...P.accounts.map((a) => ({ kind: "Λογαριασμός — άνοιγμα", name: a.name, field: "opening_balance / opening_balance_date",
      from: `${a.from.opening} @ ${a.from.date}`, to: `${a.to.opening} @ ${a.to.date}`, what: "Εφαρμόζεται" })),
    ...P.accountsInfo.map((a) => ({ kind: "Λογαριασμός — άνοιγμα", name: a.name, field: "opening_balance / opening_balance_date",
      from: `${a.from.opening} @ ${a.from.date}`, to: `${a.to.opening} @ ${a.to.date}`, what: "ΔΕΝ εφαρμόζεται (εκτός απόφασης)" })),
    ...P.liabilities.map((l) => ({ kind: "Υποχρέωση", name: l.lender, field: Object.keys(l.set).join(", "),
      from: Object.keys(l.set).map((k) => l.from[k]).join(" · "), to: Object.values(l.set).join(" · "), what: "Εφαρμόζεται" })),
    ...P.expected.map((e) => ({ kind: "Αναμενόμενο έσοδο", name: e.source, field: Object.keys(e.set).join(", "),
      from: Object.keys(e.set).map((k) => e.from[k]).join(" · "), to: Object.values(e.set).join(" · "), what: "Εφαρμόζεται" })),
  ];
  add("Λογαριασμοί & θέσεις", [["Είδος", "kind", 22], ["Όνομα", "name", 24], ["Πεδίο", "field", 30], ["Εφαρμογή σήμερα", "from", 30],
    ["Αρχείο 184", "to", 30], ["Τι γίνεται", "what", 46]], pos);
  add("Προϋπολογισμοί", [["Έργο", "project", 30], ["Γραμμή", "code", 24], ["Ετικέτα", "label", 34], ["Εφαρμογή σήμερα", "from", 16],
    ["Αρχείο 184", "to", 16], ["Σύνολο εφαρμογής", "dbTotal", 16], ["Καθαρός π/υ 184", "wbTotal", 16]], P.budgets);
  add("Παροχές", [["Γραμμή", "row", 8], ["Έργο", "project", 30], ["Παροχή", "label", 34], ["Ενέργεια", "action", 10], ["Είδος", "kind", 12],
    ["Αριθμός παροχής", "supply_number", 22], ["Λογαριασμός / μητρώο", "contract_account", 20], ["RF", "rf_code", 28],
    ["Μετρητής", "meter_number", 14], ["Ενεργή", "is_active", 8], ["Αλλαγές / σημείωση", "note", 60]],
  P.utilities.map((u) => ({ ...u, is_active: u.is_active === false ? "όχι" : u.is_active ? "ναι" : "",
    note: u.action === "update" ? Object.entries(u.set).map(([k, v]) => `${k}: ${u.from[k] ?? "—"} → ${v}`).join(" · ") : u.reason ?? u.notes,
    supply_number: u.supply_number ?? u.from?.supply_number, ...(u.action === "update" ? u.set : {}) })));
  add("Πάγια", [["Γραμμή", "row", 8], ["Ενότητα", "section", 12], ["Έργο", "project", 30], ["Γραμμή πάγιου", "label", 30],
    ["Μηνιαίο ποσό 184", "amount", 14], ["Στόχος στην εφαρμογή", "target", 26], ["Εφαρμογή", "dbAmount", 14], ["Αποτέλεσμα", "status", 46]], P.pagia);
  add("Υπόλοιπα", [["Λογαριασμός", "name", 24], ["Τρέχον 184 (στήλη D)", "workbook", 18], ["Εφαρμογή μετά τον συγχρονισμό", "app", 22],
    ["Διαφορά", "diff", 14], ["Από διαφορετικό κανόνα ημερομηνίας", "rule", 22], ["Από συγκεντρωτικά εκτός εύρους", "excluded", 22],
    ["Δόσεις πλάνων (184: πληρωμένες − εντός βάσης · εφαρμογή: πληρωμένες γραμμές)", "recurring", 30],
    ["Ανεξήγητο", "residual", 14]], P.balances);
  add("Υπόλοιπα — κανόνας", [["Λογαριασμός", "account", 22], ["Κλειδί", "key", 24], ["Ημ/νία", "tx_date", 12], ["Πληρωμή", "paid_on", 12],
    ["Ποσό (με πρόσημο)", "amount", 14], ["Γιατί", "reason", 70]], P.balanceRule);
  add("Εκτός εύρους", [["Γραμμή", "row", 8], ["Κλειδί", "key", 24], ["Μήνας", "month", 9], ["Λογαριασμός", "account", 20],
    ["Κατηγορία", "description", 28], ["Ποσό", "amount", 12], ["Αιτία", "reason", 60]], P.excludedKath);
  add("Ορφανές", [["Κλειδί", "key", 24], ["Ημ/νία", "date", 12], ["Ποσό", "amount", 12], ["Περιγραφή", "desc", 40], ["Τι γίνεται", "what", 40]],
    P.orphans.map((o) => ({ key: o.key, date: o.tx.tx_date, amount: money(o.tx.gross_amount), desc: o.tx.description, what: "Δεν υπάρχει πια στο αρχείο — δεν σβήνεται" })));
  add("Σημειώσεις", [["Κλειδί", "key", 24], ["Σημείωση", "note", 110]], P.notes);
  add("Δεν αντιστοιχίστηκαν", [["Φύλλο", "sheet", 18], ["Γραμμή", "row", 8], ["Αιτία", "reason", 90]], P.unmapped);
  await wb.xlsx.writeFile(path);
}

function summaryCounts(P) {
  return [
    ["Νέες κινήσεις (Κινήσεις)", P.kinInserts.length, "insert ως kiniseis-row-N"],
    ["Νέα καθημερινά", P.kathInserts.length, "insert ως kathimerina-row-N"],
    ["Σύνδεση με υπάρχουσες", P.links.length, "υπάρχουν ήδη στην εφαρμογή: παίρνουν μόνο legacy_excel_id"],
    ["Πιθανά διπλά", P.ambiguous.length, "δεν εισάγονται — έλεγχος"],
    ["Διορθώσεις (γραμμές)", P.edits.length, "ενημέρωση με τις τιμές του 184"],
    ["Διορθώσεις (πεδία)", P.edits.reduce((s, e) => s + e.diffs.length, 0), ""],
    ["Επιστροφή σε «Εκκρεμεί»", P.pending.length, "status pending, paid_on κενό"],
    ["Διαφορές που μένουν", P.keptDiffs.length, "μόνο αναφορά — μένει η τιμή της εφαρμογής"],
    ["Νέες επαφές", P.contacts.length, "insert"],
    ["Νέες κατηγορίες", P.categories.length, "insert"],
    ["Λογαριασμοί (άνοιγμα)", P.accounts.length, "ενημέρωση"],
    ["Λογαριασμοί (διαφορά, όχι αλλαγή)", P.accountsInfo.length, "μόνο αναφορά"],
    ["Υποχρεώσεις", P.liabilities.length, "ενημέρωση"],
    ["Αναμενόμενα έσοδα", P.expected.length, "ενημέρωση"],
    ["Γραμμές προϋπολογισμού", P.budgets.length, "insert/ενημέρωση"],
    ["Παροχές — νέες", P.utilities.filter((u) => u.action === "insert").length, "insert"],
    ["Παροχές — ενημέρωση", P.utilities.filter((u) => u.action === "update").length, "ενημέρωση"],
    ["Πάγια — γραμμές", P.pagia.length, "βλ. φύλλο (ποσά παροχών μόνο με migration)"],
    ["Πάγια — ποσά που γράφονται", P.utilityAmounts.length, ""],
    ["Καθημερινά εκτός εύρους", P.excludedKath.length, "δεν εισάγονται"],
    ["Ορφανές (στη βάση, όχι στο αρχείο)", P.orphans.length, "δεν σβήνονται"],
    ["Δεν αντιστοιχίστηκαν", P.unmapped.length, "δεν εισάγονται"],
    ["Απαιτούμενα migrations", P.migrations.length, ""],
  ];
}

// ── Apply SQL ──
function setClause(set) {
  const col = (k, v) => {
    if (v == null) return `${k} = null`;
    if (/_id$/.test(k) && k !== "legacy_excel_id") return `${k} = ${sqlUuid(v)}`;
    if (/(_date|_on|_month)$/.test(k)) return `${k} = ${sqlDate(v)}`;
    if (/(amount|principal|_balance|_pct)$/.test(k)) return `${k} = ${typeof v === "number" ? String(v) : sqlNum(v)}`;
    if (typeof v === "boolean") return `${k} = ${v}`;
    if (k === "direction") return `${k} = ${lit(v)}::tx_direction`;
    if (k === "status") return `${k} = ${lit(v)}::tx_status`;
    if (k === "certainty") return `${k} = ${lit(v)}::certainty`;
    if (k === "billing_frequency") return `${k} = ${lit(v)}::plan_frequency`;
    return `${k} = ${lit(v)}`;
  };
  return Object.entries(set).map(([k, v]) => col(k, v)).join(", ");
}
const guarded = (table, id, where, set, label) => `
do $g$ declare n int; begin
  update public.${table} set ${setClause(set)} where id = ${sqlUuid(id)}${where ? ` and ${where}` : ""};
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'sync: % changed since the plan was computed -- nothing applied', ${lit(label)}; end if;
end $g$;`;
const txGuard = (t) => `tx_date = ${sqlDate(t.tx_date)} and net_amount is not distinct from ${t.net_amount == null ? "null" : sqlNum(t.net_amount)}
  and account_id is not distinct from ${sqlUuid(t.account_id)}`;

function buildSql(P, org, tag) {
  const s = ["begin;", "create schema if not exists archive;"];
  const archive = (table, ids) => {
    if (!ids.length) return;
    const a = `archive.${table}_sync${tag}`;
    s.push(`create table if not exists ${a} (like public.${table});`,
      `alter table ${a} add column if not exists sync_archived_at timestamptz;`,
      `insert into ${a} select t.*, now() from public.${table} t where t.id in (${ids.map(sqlUuid).join(", ")});`);
  };
  archive("transactions", [...P.edits.map((e) => e.tx.id), ...P.pending.map((f) => f.tx.id), ...P.links.map((l) => l.tx.id)]);
  archive("accounts", P.accounts.map((a) => a.id));
  archive("liabilities", P.liabilities.map((l) => l.id));
  archive("expected_income", P.expected.map((e) => e.id));
  archive("budget_lines", P.budgets.filter((b) => b.line).map((b) => b.line.line_id));
  archive("project_budgets", [...new Set(P.budgets.filter((b) => b.code === "contingency_pct").map((b) => b.budgetId))]);
  archive("property_utilities", [...P.utilities.filter((u) => u.action === "update").map((u) => u.id),
    ...P.utilityAmounts.filter((u) => u.utilityId && !P.utilities.some((x) => x.action === "insert" && x.id === u.utilityId)).map((u) => u.utilityId)]);

  for (const c of P.categories) {
    s.push(`insert into public.categories (id, org_id, code, name, is_financing) values (${sqlUuid(c.id)}, ${sqlUuid(org)}, ${lit(c.code)}, ${lit(c.name)}, ${c.is_financing}) on conflict do nothing;`);
  }
  for (const c of P.contacts) {
    s.push(`insert into public.contacts (id, org_id, name, afm) values (${sqlUuid(c.id)}, ${sqlUuid(org)}, ${lit(c.name)}, ${sqlStr(c.afm)}) on conflict do nothing;`);
  }
  for (const r of P.kinInserts) {
    s.push(`insert into public.transactions (id, org_id, tx_date, paid_on, due_date, contact_id, counterparty_afm, counterparty_name,
  project_id, category_id, account_id, direction, scope, status, origin, gross_amount, net_amount, vat_amount, withholding_amount,
  has_invoice, description, invoice_number, mydata_mark, notes, legacy_excel_id) values (
  ${sqlUuid(r.id)}, ${sqlUuid(org)}, ${sqlDate(r.tx_date)}, ${sqlDate(r.paid_on)}, ${sqlDate(r.due_date)}, ${sqlUuid(r.contact_id)},
  ${sqlStr(r.counterparty_afm)}, ${sqlStr(r.counterparty_name)}, ${sqlUuid(r.project_id)}, ${sqlUuid(r.category_id)}, ${sqlUuid(r.account_id)},
  ${lit(r.direction)}, 'business', ${lit(r.status)}, ${lit(r.origin)}, ${sqlNum(r.gross_amount)}, ${sqlNum(r.net_amount)},
  ${sqlNum(r.vat_amount)}, ${sqlNum(r.withholding_amount)}, ${r.has_invoice}, ${sqlStr(r.description)}, ${sqlStr(r.invoice_number)},
  ${sqlStr(r.mydata_mark)}, ${sqlStr(r.notes)}, ${lit(r.key)})
on conflict (org_id, legacy_excel_id) where legacy_excel_id is not null do nothing;`);
  }
  for (const r of P.kathInserts) {
    s.push(`insert into public.transactions (id, org_id, tx_date, paid_on, category_id, account_id, property_project_id, direction,
  scope, status, origin, gross_amount, net_amount, vat_amount, withholding_amount, has_invoice, description, notes, legacy_excel_id) values (
  ${sqlUuid(r.id)}, ${sqlUuid(org)}, ${sqlDate(r.tx_date)}, ${sqlDate(r.tx_date)}, ${sqlUuid(r.category_id)}, ${sqlUuid(r.account_id)},
  ${sqlUuid(r.property_project_id)}, ${lit(r.direction)}, 'personal', 'paid', ${lit(r.origin)}, ${sqlNum(r.gross_amount)},
  ${sqlNum(r.gross_amount)}, 0, 0, false, ${sqlStr(r.description)}, ${sqlStr(r.notes)}, ${lit(r.key)})
on conflict (org_id, legacy_excel_id) where legacy_excel_id is not null do nothing;`);
  }
  for (const l of P.links) s.push(guarded("transactions", l.tx.id, `legacy_excel_id is null and ${txGuard(l.tx)}`, { legacy_excel_id: l.key }, l.key));
  for (const e of P.edits) s.push(guarded("transactions", e.tx.id, txGuard(e.tx), e.set, e.key));
  for (const f of P.pending) s.push(guarded("transactions", f.tx.id, txGuard(f.tx), { status: "pending", paid_on: null }, f.key));
  for (const a of P.accounts) {
    s.push(guarded("accounts", a.id, `opening_balance = ${sqlNum(a.from.opening)} and opening_balance_date = ${sqlDate(a.from.date)}`,
      { opening_balance: a.to.opening, opening_balance_date: a.to.date }, `account ${a.name}`));
  }
  for (const l of P.liabilities) s.push(guarded("liabilities", l.id, `principal = ${sqlNum(l.from.principal)}`, l.set, `liability ${l.lender}`));
  for (const e of P.expected) s.push(guarded("expected_income", e.id, `amount = ${sqlNum(e.from.amount)}`, e.set, `expected ${e.source}`));
  for (const b of P.budgets) {
    if (b.code === "contingency_pct") {
      s.push(guarded("project_budgets", b.budgetId, `contingency_pct = ${b.from}`, { contingency_pct: b.to }, `budget ${b.project}`));
    } else if (b.line) {
      s.push(guarded("budget_lines", b.line.line_id, `amount = ${sqlNum(b.from)}`, { amount: b.to, label: b.label }, `budget ${b.project} ${b.code}`));
    } else {
      s.push(`insert into public.budget_lines (org_id, budget_id, line_code, label, amount) values (${sqlUuid(org)}, ${sqlUuid(b.budgetId)},
  ${lit(b.code)}::budget_line_code, ${sqlStr(b.label)}, ${sqlNum(b.to)}) on conflict (budget_id, line_code) do nothing;`);
    }
  }
  for (const u of P.utilities) {
    if (u.action === "insert") {
      s.push(`insert into public.property_utilities (id, org_id, project_id, kind, provider, supply_number, contract_account, rf_code,
  meter_number, notes, is_active) values (${sqlUuid(u.id)}, ${sqlUuid(org)}, ${sqlUuid(u.project_id)}, ${lit(u.kind)}::utility_kind,
  ${sqlStr(u.provider)}, ${sqlStr(u.supply_number)}, ${sqlStr(u.contract_account)}, ${sqlStr(u.rf_code)}, ${sqlStr(u.meter_number)},
  ${sqlStr(u.notes)}, ${u.is_active}) on conflict do nothing;`);
    } else if (u.action === "update") {
      s.push(guarded("property_utilities", u.id, `supply_number = ${lit(u.from.supply_number)}`, u.set, `utility ${u.project} ${u.kind}`));
    }
  }
  for (const u of P.utilityAmounts) {
    if (u.utilityId) {
      s.push(guarded("property_utilities", u.utilityId, "", { monthly_amount: u.monthly, billing_frequency: u.frequency }, `utility amount ${u.project}`));
    } else {
      s.push(`insert into public.property_utilities (id, org_id, project_id, kind, notes, monthly_amount, billing_frequency) values (
  ${sqlUuid(stableId("property_utility", u.project, u.kind, "pagia"))}, ${sqlUuid(org)}, ${sqlUuid(u.project_id)}, ${lit(u.kind)}::utility_kind,
  ${lit(`Από τα «Πάγια»: ${u.label}`)}, ${sqlNum(u.monthly)}, ${lit(u.frequency)}::plan_frequency) on conflict do nothing;`);
    }
  }
  s.push("commit;");
  return s.join("\n");
}

// ── Main ──
async function main() {
  const args = process.argv.slice(2);
  const flag = (f) => args.includes(f);
  const opt = (f) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : null; };
  const positional = args.filter((a, i) => !a.startsWith("--") && args[i - 1] !== "--report" && args[i - 1] !== "--sql");
  const [ref, xlsx] = positional;
  if (!ref || !xlsx || !existsSync(xlsx)) {
    console.error("usage: node scripts/sync-workbook.mjs <project-ref> <workbook.xlsx> [--apply] [--report <out.xlsx>]");
    process.exit(2);
  }
  loadEnv();
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  if (!token) { console.error("SUPABASE_ACCESS_TOKEN missing (env or .env.migrate)"); process.exit(2); }
  const apply = flag("--apply");
  const tag = /(\d+)/.exec(basename(xlsx).replace(/\.xlsx$/i, ""))?.[1] ?? "wb";
  const env = { hjypszddhwohgvubirkc: "production", jpxxixhiudwjbzagidmn: "staging" }[ref] ?? ref;
  const report = opt("--report") ?? join(root, "..", `Αντιπαραβολή_${tag}_Kansha${env === "production" ? "" : `_${env}`}.xlsx`);

  if (apply) {
    const manifest = latestManifest(join(root, "backups"), ref);
    const age = manifest ? Date.now() - Date.parse(manifest.createdAt) : Infinity;
    if (!(age >= 0 && age < MAX_BACKUP_AGE_MS)) {
      console.error(`--apply needs a backup < 24h: run node scripts/backup-json.mjs ${ref} first`);
      process.exit(1);
    }
  }

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(xlsx);
  const problems = [];
  const baseDate = asDate(cellValue(wb.getWorksheet("Ρυθμίσεις").getCell("C28")));
  if (!baseDate) throw new Error("Ρυθμίσεις!C28 (ημερομηνία υπολοίπων έναρξης) is not a date");
  const wbData = {
    baseDate, problems,
    kin: readKiniseis(wb, problems),
    kath: readKathimerina(wb, baseDate.slice(0, 7), problems),
    accounts: readAccountsSheet(wb),
    budgets: readBudgets(wb),
    pagia: readPagia(wb),
    utilities: readUtilities(wb),
    contactsSheet: readContactsSheet(wb),
  };

  const query = makeQuery(ref, token);
  const db = await snapshot(query);
  const P = buildPlan(wbData, db);
  await writeReport(report, P, { workbook: basename(xlsx), env, ref, apply, baseDate });

  console.log(`${env}: ${apply ? "apply" : "dry run (read-only)"}`);
  for (const [label, n] of summaryCounts(P)) console.log(`  ${label}: ${n}`);
  console.log(`  report: ${report}`);

  // --sql <file>: write the transaction --apply would run, for review (real data: keep it local)
  if (opt("--sql")) writeFileSync(opt("--sql"), buildSql(P, db.orgId, tag));
  if (!apply) return;
  if (P.ambiguous.length || P.unmapped.length) {
    console.log("  note: ambiguous/unmapped rows are left out (see report)");
  }
  const sql = buildSql(P, db.orgId, tag);
  await query(sql);
  const again = buildPlan(wbData, await snapshot(query));
  const left = again.kinInserts.length + again.kathInserts.length + again.links.length + again.edits.length + again.pending.length
    + again.accounts.length + again.liabilities.length + again.expected.length + again.budgets.length
    + again.utilities.filter((u) => u.action !== "skip").length + again.contacts.length + again.categories.length;
  console.log(`  applied in one transaction; changes left after re-check: ${left}`);
}

main().catch((e) => {
  console.error(`sync-workbook: ${e.message.split("\n")[0].slice(0, 300)}`);
  process.exit(1);
});
