import { addDays, firstOfMonth, lastOfMonth, monthKeyOf, weekdayMonFirst } from "./dates";

// Month-grid shape shared by the dashboard's due-dates calendar and the
// planner's unified calendar: Monday-first, whole weeks, each cell knowing
// whether it belongs to the month on show.

export interface MonthCell {
  dateIso: string;
  day: number;
  inMonth: boolean;
}

export function monthGridRange(monthKey: string): { start: string; end: string } {
  const first = firstOfMonth(monthKey);
  const last = lastOfMonth(monthKey);
  return { start: addDays(first, -weekdayMonFirst(first)), end: addDays(last, 6 - weekdayMonFirst(last)) };
}

export function monthCells(monthKey: string): MonthCell[] {
  const { start, end } = monthGridRange(monthKey);
  const cells: MonthCell[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    cells.push({ dateIso: d, day: Number(d.slice(8, 10)), inMonth: monthKeyOf(d) === monthKey });
  }
  return cells;
}

// ── Unified calendar items (v_calendar_items, 0042) ───────────────────────

export const CALENDAR_SOURCES = [
  "task",
  "milestone",
  "phase",
  "project",
  "payment",
  "installment",
  "vat",
  "withholding",
  "lease",
  "loan",
] as const;
export type CalendarSource = (typeof CALENDAR_SOURCES)[number];

// Mirrors the view's is_financial column. Used to build the filter chips --
// a partner never sees these at all (RLS returns no rows), the org can
// switch them off to see just the work plan.
export const FINANCIAL_SOURCES: ReadonlySet<CalendarSource> = new Set<CalendarSource>([
  "payment",
  "installment",
  "vat",
  "withholding",
  "lease",
  "loan",
]);

export function isCalendarSource(value: unknown): value is CalendarSource {
  return typeof value === "string" && (CALENDAR_SOURCES as readonly string[]).includes(value);
}

export interface CalendarItem {
  item_key: string;
  source: CalendarSource;
  subkind: string | null;
  org_id: string;
  project_id: string | null;
  ref_id: string | null;
  starts_on: string;
  ends_on: string;
  title: string;
  status: string | null;
  is_done: boolean;
  is_financial: boolean;
  amount: number | null;
  direction: string | null;
}

// View rows come back with every column nullable (Postgres can't prove a
// UNION branch non-null); drop the few that lack the essentials.
export function toCalendarItems(
  rows: {
    item_key: string | null;
    source: string | null;
    subkind: string | null;
    org_id: string | null;
    project_id: string | null;
    ref_id: string | null;
    starts_on: string | null;
    ends_on: string | null;
    title: string | null;
    status: string | null;
    is_done: boolean | null;
    is_financial: boolean | null;
    amount: number | null;
    direction: string | null;
  }[],
): CalendarItem[] {
  const out: CalendarItem[] = [];
  for (const r of rows) {
    if (!r.item_key || !r.org_id || !r.starts_on || !isCalendarSource(r.source)) continue;
    out.push({
      item_key: r.item_key,
      source: r.source,
      subkind: r.subkind,
      org_id: r.org_id,
      project_id: r.project_id,
      ref_id: r.ref_id,
      starts_on: r.starts_on,
      ends_on: r.ends_on && r.ends_on >= r.starts_on ? r.ends_on : r.starts_on,
      title: r.title ?? "",
      status: r.status,
      is_done: Boolean(r.is_done),
      is_financial: Boolean(r.is_financial),
      amount: r.amount == null ? null : Number(r.amount),
      direction: r.direction,
    });
  }
  return out;
}

// Long ranges (a construction phase) would paint every cell of the month;
// on the grid they show on their first and last day only, and the agenda
// lists them once. Short ranges (a task over a few days) fill each day.
export const MAX_SPREAD_DAYS = 7;

const SOURCE_ORDER = new Map(CALENDAR_SOURCES.map((s, i) => [s, i]));

function compareItems(a: CalendarItem, b: CalendarItem): number {
  return (
    Number(a.is_done) - Number(b.is_done) ||
    (SOURCE_ORDER.get(a.source)! - SOURCE_ORDER.get(b.source)!) ||
    a.title.localeCompare(b.title, "el")
  );
}

// Items per day within [start, end], each day's list sorted open-first.
export function groupByDay(items: CalendarItem[], range: { start: string; end: string }): Map<string, CalendarItem[]> {
  const byDay = new Map<string, CalendarItem[]>();
  const put = (day: string, item: CalendarItem) => {
    if (day < range.start || day > range.end) return;
    const list = byDay.get(day) ?? [];
    list.push(item);
    byDay.set(day, list);
  };
  for (const item of items) {
    const spanDays = Math.round(
      (Date.parse(`${item.ends_on}T00:00:00Z`) - Date.parse(`${item.starts_on}T00:00:00Z`)) / 86_400_000,
    );
    if (spanDays === 0) {
      put(item.starts_on, item);
    } else if (spanDays < MAX_SPREAD_DAYS) {
      for (let d = item.starts_on; d <= item.ends_on; d = addDays(d, 1)) put(d, item);
    } else {
      put(item.starts_on, item);
      put(item.ends_on, item);
    }
  }
  for (const list of byDay.values()) list.sort(compareItems);
  return byDay;
}

// The mobile agenda: one entry per item on its start day (or the first day
// of the range, for something already under way), days in order.
export function agendaDays(
  items: CalendarItem[],
  range: { start: string; end: string },
): { dateIso: string; items: CalendarItem[] }[] {
  const byDay = new Map<string, CalendarItem[]>();
  for (const item of items) {
    if (item.ends_on < range.start || item.starts_on > range.end) continue;
    const day = item.starts_on < range.start ? range.start : item.starts_on;
    const list = byDay.get(day) ?? [];
    list.push(item);
    byDay.set(day, list);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([dateIso, list]) => ({ dateIso, items: list.sort(compareItems) }));
}

// The calendar's chip filter: explicit sources if any, minus the financial
// ones when they are hidden (or not allowed at all, for a partner).
export function filterCalendarItems(
  items: CalendarItem[],
  opts: { sources?: CalendarSource[]; showFinancial: boolean },
): CalendarItem[] {
  const only = opts.sources && opts.sources.length > 0 ? new Set(opts.sources) : null;
  return items.filter((i) => (only ? only.has(i.source) : true) && (opts.showFinancial || !i.is_financial));
}
