// Calendar-date arithmetic for the planner. Every value is an ISO
// `YYYY-MM-DD` string (what Postgres `date` columns arrive as) and all maths
// runs in UTC on midnight-of-that-day, so a Worker in UTC and a browser in
// Athens agree on which day a task is due. "Today" is the one thing that
// depends on where you are -- it is always Athens, the business's clock.

const ATHENS = "Europe/Athens";
const DAY_MS = 86_400_000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_KEY = /^\d{4}-(0[1-9]|1[0-2])$/;

const athensParts = new Intl.DateTimeFormat("en-GB", {
  timeZone: ATHENS,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

// Today's calendar date in Athens. At 01:30 Athens time on the 10th the UTC
// clock still says the 9th; new Date().toISOString() would be a day behind.
export function todayAthens(now: Date = new Date()): string {
  const parts = Object.fromEntries(athensParts.formatToParts(now).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) return false;
  return toIso(parseIso(value)) === value; // rejects 2026-02-30
}

export function parseIso(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

export function toIso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number): string {
  return toIso(new Date(parseIso(iso).getTime() + days * DAY_MS));
}

// Whole days from a to b (b - a); negative when b is earlier.
export function diffDays(a: string, b: string): number {
  return Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / DAY_MS);
}

// Monday = 0 ... Sunday = 6, the Greek week.
export function weekdayMonFirst(iso: string): number {
  return (parseIso(iso).getUTCDay() + 6) % 7;
}

// ── Months, as `YYYY-MM` keys ──────────────────────────────────────────────

export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

export function isMonthKey(value: unknown): value is string {
  return typeof value === "string" && MONTH_KEY.test(value);
}

export function firstOfMonth(monthKey: string): string {
  return `${monthKey}-01`;
}

export function lastOfMonth(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return toIso(new Date(Date.UTC(y, m, 0)));
}

export function addMonths(monthKey: string, months: number): string {
  const [y, m] = monthKey.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + months, 1));
  return toIso(d).slice(0, 7);
}

// ?month=2026-10 from the URL, falling back to the current Athens month for
// anything missing or malformed.
export function parseMonthParam(value: string | string[] | undefined, today: string): string {
  const v = Array.isArray(value) ? value[0] : value;
  return isMonthKey(v) ? v : monthKeyOf(today);
}

const monthLabelFormatter = new Intl.DateTimeFormat("el-GR", { month: "long", year: "numeric", timeZone: "UTC" });
const shortMonthFormatter = new Intl.DateTimeFormat("el-GR", { month: "short", timeZone: "UTC" });
const dayMonthFormatter = new Intl.DateTimeFormat("el-GR", { day: "numeric", month: "short", timeZone: "UTC" });

// «Οκτώβριος 2026» -- nominative, unlike the genitive el-GR uses with a day.
export function monthLabel(monthKey: string): string {
  return monthLabelFormatter.format(parseIso(firstOfMonth(monthKey)));
}

export function shortMonthLabel(monthKey: string): string {
  return shortMonthFormatter.format(parseIso(firstOfMonth(monthKey)));
}

// «9 Οκτ» for compact card and agenda labels.
export function dayMonthLabel(iso: string): string {
  return dayMonthFormatter.format(parseIso(iso));
}
