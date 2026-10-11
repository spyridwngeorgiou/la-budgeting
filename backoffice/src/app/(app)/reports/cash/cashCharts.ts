// Chart rows for Ταμείο & Πρόβλεψη. The SQL (cash_forecast /
// cash_forecast_items, 0066/0090) decides every figure; these only reshape
// rows the page already read. Pure, so the shapes are tested.

const round2 = (n: number) => Math.round(n * 100) / 100;
const num = (v: number | string | null | undefined) => {
  const n = Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
};

// ── The closing balance per scenario, one datum per month ───────────────────
export interface BalanceRow {
  month: string; // 'YYYY-MM-DD'
  closing_balance: number | string | null;
}

// rowsByKey: { base: rows, optimistic: rows, … } (all the same months).
// The first key's months set the x axis.
export function scenarioBalanceRows(
  rowsByKey: Record<string, BalanceRow[]>,
  label: (monthKey: string) => string,
): Record<string, string | number | null>[] {
  const keys = Object.keys(rowsByKey);
  const axis = keys.length ? rowsByKey[keys[0]] : [];
  return axis.map((r) => {
    const m = r.month.slice(0, 7);
    const datum: Record<string, string | number | null> = { label: label(m) };
    for (const k of keys) {
      const hit = rowsByKey[k].find((x) => x.month.slice(0, 7) === m);
      datum[k] = hit ? round2(num(hit.closing_balance)) : null;
    }
    return datum;
  });
}

// ── «Τι κινεί το ταμείο»: outflows per month by source, ≤6 groups ───────────
export const OUTFLOW_GROUPS = ["open", "installment", "loan", "vat", "withholding", "other"] as const;
export type OutflowGroup = (typeof OUTFLOW_GROUPS)[number];

// cash_forecast_items.source -> the group it is stacked in.
export function outflowGroupOf(source: string | null | undefined): OutflowGroup {
  switch (source) {
    case "open":
    case "future_paid":
    case "expected":
      return "open";
    case "installment":
    case "lease":
      return "installment";
    case "loan":
    case "liability":
    case "drawdown":
      return "loan";
    case "vat":
      return "vat";
    case "withholding":
      return "withholding";
    default:
      return "other";
  }
}

export interface OutflowItem {
  month: string | null; // 'YYYY-MM-DD'
  source: string | null;
  weighted_amount: number | string | null;
}

export interface OutflowMonth {
  month: string; // 'YYYY-MM-DD'
  outflow: number | string | null;
}

// One datum per forecast month: { label, open, installment, … }. The items
// are grouped by source; whatever the forecast's outflow has that the items
// did not cover (a capped response) goes to «other», so every column adds
// up to the table's «Εκροές». Returns the groups that are non-zero
// anywhere, in OUTFLOW_GROUPS order.
export function outflowBySourceRows(
  months: OutflowMonth[],
  items: OutflowItem[],
  label: (monthKey: string) => string,
): { data: Record<string, string | number>[]; groups: OutflowGroup[] } {
  const sums = new Map<string, Record<OutflowGroup, number>>();
  const empty = (): Record<OutflowGroup, number> => ({ open: 0, installment: 0, loan: 0, vat: 0, withholding: 0, other: 0 });
  for (const m of months) sums.set(m.month.slice(0, 7), empty());
  for (const i of items) {
    const row = i.month ? sums.get(i.month.slice(0, 7)) : undefined;
    if (row) row[outflowGroupOf(i.source)] += num(i.weighted_amount);
  }
  const used = new Set<OutflowGroup>();
  const data = months.map((m) => {
    const key = m.month.slice(0, 7);
    const row = sums.get(key) ?? empty();
    const covered = OUTFLOW_GROUPS.reduce((s, g) => s + row[g], 0);
    const rest = num(m.outflow) - covered;
    if (rest > 0.5) row.other += rest;
    const datum: Record<string, string | number> = { label: label(key) };
    for (const g of OUTFLOW_GROUPS) {
      datum[g] = round2(row[g]);
      if (Math.abs(row[g]) >= 0.005) used.add(g);
    }
    return datum;
  });
  return { data, groups: OUTFLOW_GROUPS.filter((g) => used.has(g)) };
}

// The single largest outflow of one month: why the low point is low.
export function largestOutflow<T extends OutflowItem & { label: string | null }>(items: T[], monthKey: string): T | null {
  let best: T | null = null;
  for (const i of items) {
    if (!i.month || i.month.slice(0, 7) !== monthKey) continue;
    if (num(i.weighted_amount) <= 0) continue;
    if (!best || num(i.weighted_amount) > num(best.weighted_amount)) best = i;
  }
  return best;
}
