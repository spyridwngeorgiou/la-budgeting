// The home's arithmetic, pure (tested in model.test.ts): the due window,
// the agenda, month-on-month by business line and the project health dot.
import { addDays, diffDays, parseIso } from "@/lib/dates";
import type { Severity } from "@/components/ui";

export const DUE_HORIZON_DAYS = 14;

// What is due up to `today + days`, with NO lower bound: an overdue row
// from any earlier month stays in view until it is settled. (The old
// dashboard bounded this by the calendar grid's first day, so a bill
// overdue since last month silently dropped out of its count.)
export function dueWindow(today: string, days = DUE_HORIZON_DAYS): { until: string } {
  return { until: addDays(today, days) };
}

export interface AgendaItem {
  key: string;
  label: string;
  meta: string | null;
  dueDate: string;
  // Signed: + money in, − money out.
  amount: number;
  // < 1 for expected income, deals, receivables at a collection probability.
  probability: number;
  href: string;
}

export interface AgendaRow extends AgendaItem {
  overdue: boolean;
  severity: Severity;
}

// Overdue first (oldest first), then by due date; ΕΠΕΙΓΟΝ for overdue,
// ΠΡΟΣΟΧΗ within three days, ΕΝΗΜΕΡΩΣΗ after that.
export function buildAgenda(items: AgendaItem[], today: string, until: string): AgendaRow[] {
  return items
    .filter((i) => i.dueDate <= until)
    .map((i) => {
      const overdue = i.dueDate < today;
      const severity: Severity = overdue ? "urgent" : diffDays(today, i.dueDate) <= 3 ? "attention" : "info";
      return { ...i, overdue, severity };
    })
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.dueDate.localeCompare(b.dueDate) || a.key.localeCompare(b.key));
}

export const signed = (direction: string | null, amount: number | null) =>
  direction === "income" ? Number(amount ?? 0) : -Number(amount ?? 0);

// pnl_summary(…, 'business_line') rows of two months -> one row per line.
export interface PnlRow {
  bucket: string;
  line: string;
  amount: number | string;
}
export interface LineMonth {
  line: string;
  revenue: number;
  cost: number;
  result: number;
  previous: number;
  delta: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function monthByLine(current: PnlRow[], previous: PnlRow[], order: readonly string[]): LineMonth[] {
  const acc = new Map<string, LineMonth>();
  const get = (line: string) => {
    let row = acc.get(line);
    if (!row) acc.set(line, (row = { line, revenue: 0, cost: 0, result: 0, previous: 0, delta: 0 }));
    return row;
  };
  for (const r of current) {
    const row = get(r.bucket);
    const v = Number(r.amount);
    if (r.line === "revenue") row.revenue += v;
    else row.cost += v;
    row.result += v;
  }
  for (const r of previous) get(r.bucket).previous += Number(r.amount);
  return [...acc.values()]
    .map((r) => ({
      ...r,
      revenue: round2(r.revenue),
      cost: round2(r.cost),
      result: round2(r.result),
      previous: round2(r.previous),
      delta: round2(r.result - r.previous),
    }))
    .sort((a, b) => order.indexOf(a.line) - order.indexOf(b.line));
}

export type Health = "ok" | "overrun" | "lineOverrun" | "overdue";

// Worst first: over the total budget, a budget line over, a milestone late.
export function projectHealth(p: {
  totalBudget: number;
  remaining: number;
  lineOverrun: boolean;
  overdueMilestone: boolean;
}): Health {
  if (p.totalBudget > 0 && p.remaining < 0) return "overrun";
  if (p.lineOverrun) return "lineOverrun";
  if (p.overdueMilestone) return "overdue";
  return "ok";
}

const longDate = new Intl.DateTimeFormat("el-GR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

// «Σάββατο 10 Οκτωβρίου 2026»
export const longDateLabel = (iso: string) => longDate.format(parseIso(iso));
