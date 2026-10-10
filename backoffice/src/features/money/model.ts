import { diffDays } from "@/lib/dates";
import type { PnlTableRow } from "@/lib/finance/pnl";

// Small pure rules of the «Χρήματα» screens. No finance math lives here:
// balances, forecasts, P&L and VAT all come from SQL (views and
// functions); these only sign, sum what is on screen, and classify.

// A ledger row as a signed amount: + income, − expense.
export const signedAmount = (direction: string, gross: number | null) =>
  direction === "income" ? Number(gross ?? 0) : -Number(gross ?? 0);

export function onScreenTotals(rows: { direction: string; gross_amount: number | null }[]) {
  let income = 0;
  let expense = 0;
  for (const r of rows) {
    const v = Number(r.gross_amount ?? 0);
    if (r.direction === "income") income += v;
    else expense += v;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  return { income: round(income), expense: round(expense), net: round(income - expense) };
}

// Open (pending / scheduled) and past its due date.
export const isOverdue = (row: { status: string; due_date: string | null }, today: string) =>
  (row.status === "pending" || row.status === "scheduled") && !!row.due_date && row.due_date < today;

// An account's reconciliation state from its latest balance check
// (v_balance_checks): a gap of a euro or more is a drift; no check, or one
// older than 35 days, asks for a new one.
export type AccountStatus = "drift" | "never" | "stale" | "ok";
export const STALE_DAYS = 35;

export function accountStatus(latest: { as_of_date: string; total_gap: number } | null, today: string): AccountStatus {
  if (!latest) return "never";
  if (Math.abs(latest.total_gap) >= 1) return "drift";
  return diffDays(latest.as_of_date, today) > STALE_DAYS ? "stale" : "ok";
}

export const ACCOUNT_STATUS_ORDER: Record<AccountStatus, number> = { drift: 0, never: 1, stale: 2, ok: 3 };

// The P&L rows worth a line: the subtotals and revenue always, the other
// lines only when they carry something.
export function visiblePnlRows(rows: PnlTableRow[]): PnlTableRow[] {
  return rows.filter((r) => r.line === "revenue" || r.line === "gross_profit" || r.line === "result" || r.total !== 0);
}
