// Chart rows for the report tabs (BarChart). The SQL decides every figure;
// these only reshape rows the pages already read into plain chart data.
// Pure, so the shapes are tested (reportCharts.test.ts).

import type { PnlTableRow } from "./pnl";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Ταμείο: in/out bars side by side + the closing balance ──────────────────
export interface CashForecastRow {
  month: string; // 'YYYY-MM-DD'
  inflow: number | string | null;
  outflow: number | string | null;
  closing_balance: number | string | null;
}

export function cashChartRows(rows: CashForecastRow[], label: (monthKey: string) => string) {
  return rows.map((r) => ({
    label: label(r.month.slice(0, 7)),
    inflow: round2(Number(r.inflow ?? 0)),
    outflow: round2(Number(r.outflow ?? 0)),
    balance: round2(Number(r.closing_balance ?? 0)),
  }));
}

// ── Αποτελέσματα: revenue/cost per month, result, last year's result ─────────
export function pnlChartRows(
  table: { rows: PnlTableRow[] },
  lastYear: { rows: PnlTableRow[] } | null,
  months: string[],
  label: (monthKey: string) => string,
) {
  const line = (t: { rows: PnlTableRow[] } | null, key: string) => t?.rows.find((r) => r.line === key)?.values;
  const revenue = line(table, "revenue") ?? [];
  const result = line(table, "result") ?? [];
  const prev = line(lastYear, "result");
  return months.map((m, i) => {
    const rev = revenue[i] ?? 0;
    const res = result[i] ?? 0;
    return {
      label: label(m),
      revenue: round2(rev),
      // every cost line together, as a positive magnitude: revenue − result
      cost: round2(rev - res),
      result: round2(res),
      lastYear: prev ? round2(prev[i] ?? 0) : null,
    };
  });
}

// ── Αποτελέσματα: the largest cost categories of the year ────────────────────
export function topCostRows(rows: { name: string | null; amount: number | string | null }[], limit = 8) {
  return rows
    .map((r) => ({ label: r.name?.trim() || "—", amount: round2(Number(r.amount ?? 0)) }))
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}

// ── ΦΠΑ: payable (−) / credit (+) per period, and the next deadline ──────────
export interface VatPositionRow {
  period_start: string | null;
  payable_after_credit: number | string | null;
  credit_balance: number | string | null;
  filing_deadline: string | null;
}

export function vatChartRows(rows: VatPositionRow[], label: (periodStart: string) => string, today: string) {
  const sorted = rows.filter((r) => r.period_start).sort((a, b) => a.period_start!.localeCompare(b.period_start!));
  const data = sorted.map((r) => ({
    label: label(r.period_start!),
    payable: -round2(Number(r.payable_after_credit ?? 0)) || 0,
    // credit_balance is ≤ 0 in the view: the credit carried, shown upwards
    credit: round2(Math.abs(Number(r.credit_balance ?? 0))),
  }));
  // The first period whose filing deadline is still ahead: what comes next.
  const next = sorted.find((r) => r.filing_deadline && r.filing_deadline >= today && Number(r.payable_after_credit ?? 0) > 0);
  return { data, nextDeadline: next ? { x: label(next.period_start!), deadline: next.filing_deadline! } : null };
}

// ── Καθαρή θέση: what makes up the number ────────────────────────────────────
export function netWorthRows<C extends string>(
  amountOf: Record<C, number>,
  order: readonly C[],
  label: (component: C) => string,
) {
  return order
    .filter((c) => amountOf[c] !== 0)
    .map((c) => ({
      label: label(c),
      amount: round2(Math.abs(amountOf[c])),
      tone: amountOf[c] > 0 ? "navy" : "negative",
    }))
    .sort((a, b) => (a.tone === b.tone ? b.amount - a.amount : a.tone === "navy" ? -1 : 1));
}
