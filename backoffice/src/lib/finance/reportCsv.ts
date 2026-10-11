// The «Εξαγωγή CSV» tables of the report tabs (/api/reports/*/export): the
// same rows the pages lay out, as header + rows for lib/csv toCsv(). Amounts
// stay plain numbers (2 decimals, dot) so a spreadsheet can sum them. Pure,
// so tested (reportCsv.test.ts).

import { el } from "@/lib/i18n/el";
import type { PnlTableRow } from "./pnl";

type Cell = string | number | null | undefined;
export interface CsvTable {
  header: string[];
  rows: Cell[][];
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const amount = (v: number | string | null | undefined) => {
  const n = round2(Number(v ?? 0));
  return Object.is(n, -0) ? 0 : n;
};

// ── Αποτελέσματα: one row per P&L line, one column per bucket + the total ────
export function pnlCsv(table: { rows: PnlTableRow[] }, buckets: string[], bucketLabel: (b: string) => string): CsvTable {
  const t = el.reports;
  return {
    header: ["Γραμμή", ...buckets.map(bucketLabel), t.total],
    rows: table.rows.map((r) => [t.lines[r.line], ...buckets.map((_, i) => amount(r.values[i])), amount(r.total)]),
  };
}

// ── Ταμείο & Πρόβλεψη: one row per month of cash_forecast() ──────────────────
export interface CashCsvRow {
  month: string; // 'YYYY-MM-DD'
  opening_balance: number | string | null;
  inflow: number | string | null;
  uncertain_inflow: number | string | null;
  outflow: number | string | null;
  net: number | string | null;
  closing_balance: number | string | null;
  min_buffer: number | string | null;
  below_buffer: boolean | null;
}

export function cashCsv(rows: CashCsvRow[]): CsvTable {
  const t = el.reports;
  return {
    header: [t.month, t.opening, t.inflow, t.uncertainPart, t.outflow, t.net, t.closing, t.buffer, "Κάτω από το απόθεμα"],
    rows: rows.map((r) => [
      r.month.slice(0, 7),
      amount(r.opening_balance),
      amount(r.inflow),
      amount(r.uncertain_inflow),
      amount(r.outflow),
      amount(r.net),
      amount(r.closing_balance),
      amount(r.min_buffer),
      r.below_buffer ? el.common.yes : el.common.no,
    ]),
  };
}

// ── Καθαρή θέση: each component's total, then its items, then the total ──────
export interface NetWorthCsvItem {
  component: string | null;
  label: string | null;
  owner_scope: string | null;
  amount: number | string | null;
}

export function netWorthCsv(
  components: readonly string[],
  amountOf: Record<string, number>,
  items: NetWorthCsvItem[],
  netWorth: number,
): CsvTable {
  const t = el.netWorth;
  const label = (c: string) => (t.components as Record<string, string>)[c] ?? c;
  const owner = (s: string | null) => (s ? ((el.account.ownerValues as Record<string, string>)[s] ?? s) : "");
  const rows: Cell[][] = [];
  for (const c of components) {
    const list = items.filter((i) => i.component === c);
    if (amount(amountOf[c]) === 0 && list.length === 0) continue;
    rows.push([label(c), "Σύνολο", "", amount(amountOf[c])]);
    for (const i of list) rows.push([label(c), i.label?.trim() || "—", owner(i.owner_scope), amount(i.amount)]);
  }
  rows.push([t.total, "", "", amount(netWorth)]);
  return { header: ["Ενότητα", "Στοιχείο", "Πεδίο", "Ποσό"], rows };
}
