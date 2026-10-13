// The read-only insights of every report tab (the «± έναντι προηγ. μήνα»
// line under a KPI, σε σχέση με τον στόχο, αξιοπιστία, κάλυψη): pure
// functions on rows the page already fetched, so a tab adds at most one
// query. Amounts in euros; a percentage only on a positive base (a % on a
// loss or a zero reads as nonsense).

import { formatPercent, formatSignedMoney } from "@/lib/format";

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// ── Μεταβολή ─────────────────────────────────────────────────────────────
export interface Change {
  current: number;
  previous: number | null;
  delta: number | null;
  // delta / previous, only when previous > 0.
  pct: number | null;
}

export function change(current: number, previous: number | null | undefined): Change {
  const cur = round2(num(current));
  if (previous == null || !Number.isFinite(Number(previous))) return { current: cur, previous: null, delta: null, pct: null };
  const prev = round2(Number(previous));
  const delta = round2(cur - prev);
  return { current: cur, previous: prev, delta, pct: prev > 0 ? delta / prev : null };
}

// The line under a KPI: «+1.200,00 € (+5%) έναντι προηγ. μήνα» -- the
// percentage only on a positive base -- or null with nothing to compare.
export function vsPrevText(ch: Change, against = "προηγ. μήνα"): string | null {
  if (ch.delta == null) return null;
  const pct = ch.pct != null ? ` (${formatPercent(ch.pct, { digits: 0, signed: true })})` : "";
  return `${formatSignedMoney(ch.delta)}${pct} έναντι ${against}`;
}

export interface Part {
  key: string;
  label: string;
  amount: number;
}

const IDS_MAX = 100;

// /transactions?ids=… for the given rows (deduplicated, at most 100), or
// null when there is none.
export function txIdsHref(ids: (string | null | undefined)[]): string | null {
  const unique = [...new Set(ids.filter((x): x is string => !!x))].slice(0, IDS_MAX);
  return unique.length > 0 ? `/transactions?ids=${unique.join(",")}` : null;
}

// ── Σε σχέση με τον στόχο ────────────────────────────────────────────────
export interface Target {
  // actual − target (> 0 above it).
  gap: number | null;
  // actual / target, only on a positive target.
  share: number | null;
}

export function vsTarget(actual: number, target: number | null | undefined): Target {
  if (target == null || !Number.isFinite(Number(target))) return { gap: null, share: null };
  const t = Number(target);
  return { gap: round2(num(actual) - t), share: t > 0 ? num(actual) / t : null };
}

// ── Αξιοπιστία ───────────────────────────────────────────────────────────
// Which v_worklist checks (0090) touch each report's figures. ΦΠΑ carries
// the withholding checks too (the withholding table lives on that tab).
export const RELIABILITY_CODES = {
  cash: [
    "account_drift",
    "account_uncounted",
    "forecast_stale",
    "schedule_stale",
    "expected_vs_scheduled",
    "duplicate_fingerprints",
    "missing_project_or_account",
  ],
  pnl: [
    "spend_without_treatment",
    "loan_without_interest",
    "duplicate_fingerprints",
    "amount_identity_mismatch",
    "future_dated",
    "non_positive_amounts",
  ],
  "net-worth": ["account_drift", "account_uncounted", "duplicate_fingerprints", "missing_project_or_account"],
  vat: [
    "vat_mismatch",
    "vat_unfiled",
    "amount_identity_mismatch",
    "duplicate_invoice_numbers",
    "afm_mismatch",
    "uninvoiced_large_expenses",
    "withholding_on_income",
    "duplicate_fingerprints",
  ],
  portfolio: ["projects_without_budget", "spend_without_treatment", "capex_to_lessor", "missing_project_or_account"],
} as const satisfies Record<string, readonly string[]>;

export type ReportKey = keyof typeof RELIABILITY_CODES;

export interface WorklistRow {
  code: string | null;
  count: number | null;
  href: string | null;
}

export interface Reliability {
  count: number;
  codes: string[];
  // The one check's own page when a single check is open, else the
  // quality report.
  href: string;
}

export function reliability(rows: WorklistRow[], report: ReportKey): Reliability | null {
  const wanted = new Set<string>(RELIABILITY_CODES[report]);
  const hit = rows.filter((r) => r.code && wanted.has(r.code) && num(r.count) > 0);
  const count = hit.reduce((s, r) => s + num(r.count), 0);
  if (count === 0) return null;
  const codes = [...new Set(hit.map((r) => r.code!))];
  const href = codes.length === 1 && hit[0].href ? hit[0].href : "/reports/quality";
  return { count, codes, href };
}

// ── Χρονική κάλυψη ───────────────────────────────────────────────────────
// The latest date (ISO 'YYYY-MM-DD' or month key 'YYYY-MM') not after
// today, or null: «δεδομένα έως …».
export function latestUpTo(values: (string | null | undefined)[], today: string): string | null {
  let best: string | null = null;
  for (const v of values) {
    if (!v) continue;
    const limit = v.length === 7 ? today.slice(0, 7) : today;
    if (v > limit) continue;
    if (!best || v.slice(0, 10) > best.slice(0, 10)) best = v;
  }
  return best;
}

// ── Μηνιαία υπόλοιπα ανά λογαριασμό ──────────────────────────────────────
export interface BalanceAccount {
  account_id: string | null;
  name: string | null;
  current_balance: number | string | null;
  opening_balance_date: string | null;
}

export interface BalanceLedgerMonth {
  account_id: string | null;
  month: string | null; // 'YYYY-MM'
  inflow: number | string | null;
  outflow: number | string | null;
}

// Each account's balance at the end of `month` (today's balance minus the
// movements paid after it), as liquidMonthEnds does for the total. An
// account opened after that month counts 0 there.
export function accountBalancesAt(
  accounts: BalanceAccount[],
  ledger: BalanceLedgerMonth[],
  month: string,
  thisMonth: string,
): Part[] {
  const after = new Map<string, number>();
  for (const r of ledger) {
    if (!r.account_id || !r.month) continue;
    const m = r.month.slice(0, 7);
    if (m <= month || m > thisMonth) continue;
    after.set(r.account_id, (after.get(r.account_id) ?? 0) + num(r.inflow) - num(r.outflow));
  }
  return accounts
    .filter((a): a is BalanceAccount & { account_id: string } => !!a.account_id)
    .map((a) => ({
      key: a.account_id,
      label: a.name ?? "—",
      amount:
        a.opening_balance_date && a.opening_balance_date.slice(0, 7) > month ? 0 : round2(num(a.current_balance) - (after.get(a.account_id) ?? 0)),
    }));
}

export const sumParts = (parts: Part[]) => round2(parts.reduce((s, p) => s + num(p.amount), 0));
