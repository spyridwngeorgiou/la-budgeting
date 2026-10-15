// Σενάρια «τι θα γινόταν αν» (/reports/scenarios): the cash forecast re-run
// in memory with a few changes on top. The changes live in the URL (?c=…,
// one per change) and, once named, in forecast_scenarios (0098) in the same
// text form -- never in the forecast itself. The items and the opening
// balances are the SQL's (cash_forecast_items / cash_forecast_by_kind,
// 0066/0097), so the run with no changes is the forecast /reports/cash
// shows, banks and cash kept apart the same way (rows with no account count
// as bank). Pure, so the arithmetic is tested.

import { addMonths } from "@/lib/dates";

export interface WhatIfItem {
  item_key: string;
  source: string;
  ref_id: string;
  label: string;
  month: string; // 'YYYY-MM-DD' (or 'YYYY-MM')
  direction: string; // 'income' | 'expense'
  weighted_amount: number | string;
  cash: boolean; // sits on a «Μετρητά» account
  project_id?: string | null;
  probability?: number | string | null;
}

// A change, as kept in the URL:
//   shift   s.<group>.<months>               the group moves N months (− earlier)
//   drop    d.<group>                        the group does not happen
//   add     a.<YYYY-MM>.<signed cents>.<b|c>.<label>   a new amount, bank or cash
//   move    w.<YYYY-MM>.<signed cents>       + withdrawal bank → cash, − deposit cash → bank
//   rule    r.<i|e|a>.<project|->.<u|a>.<s|d|p>.<n>    many rows at once: income /
//           expense / all, of one project or any, uncertain only or all;
//           shift N months, drop, or change by N %
//   monthly m.<from>.<to|->.<signed cents>.<b|c>.<label>  every month from…to
//           (− to the end of the horizon)
//   goal    g.c.<cents>                      cash never below this
//           g.b.<YYYY-MM>.<cents>            banks at least this at the end of the month
// Amounts in whole cents, so the dots only ever separate fields. Goals move
// no money: they are checked against the run, each with a suggested fix.
export type RuleDir = "i" | "e" | "a";
export type RuleChange = { t: "rule"; dir: RuleDir; project: string | null; uncertain: boolean; op: "s" | "d" | "p"; n: number };
export type MoveChange = { t: "move"; m: string; amount: number };
export type GoalChange = { t: "cashFloor"; amount: number } | { t: "bankGoal"; m: string; amount: number };
export type Change =
  | { t: "shift"; g: string; n: number }
  | { t: "drop"; g: string }
  | { t: "add"; m: string; amount: number; cash: boolean; label: string }
  | MoveChange
  | RuleChange
  | { t: "monthly"; from: string; to: string | null; amount: number; cash: boolean; label: string }
  | GoalChange;

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// ── Groups: what a shift or a drop applies to ────────────────────────────────
// A loan's drawdowns and its grace-period interest move together; otherwise
// rows of one series (same source, same label: instalments of a plan, a
// lease, the loan's payments) are one group, and a one-off row is its own.
export function groupKeyOf(i: Pick<WhatIfItem, "source" | "ref_id" | "label">): string {
  if (i.source === "drawdown" || i.source === "loan_interest") return `loan:${i.ref_id}`;
  return `${i.source}:${i.label}`;
}

// Short, URL-safe and stable for the same key (FNV-1a, base 36).
export function groupId(key: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

export interface WhatIfGroup {
  id: string;
  source: string;
  label: string;
  count: number;
  firstMonth: string; // 'YYYY-MM'
  income: number; // weighted, in the horizon
  expense: number;
}

// The groups of the items, in the order of their first month, then size.
export function whatIfGroups(items: WhatIfItem[]): WhatIfGroup[] {
  const map = new Map<string, WhatIfGroup>();
  for (const i of items) {
    const key = groupKeyOf(i);
    const id = groupId(key);
    const amount = Number(i.weighted_amount) || 0;
    const loan = key.startsWith("loan:");
    const g = map.get(id) ?? {
      id,
      source: loan ? "drawdown" : i.source,
      label: loan ? i.label.replace(/ — τόκοι$/, "") : i.label,
      count: 0,
      firstMonth: i.month.slice(0, 7),
      income: 0,
      expense: 0,
    };
    g.count += 1;
    if (i.month.slice(0, 7) < g.firstMonth) g.firstMonth = i.month.slice(0, 7);
    if (i.direction === "income") g.income += amount;
    else g.expense += amount;
    map.set(id, g);
  }
  return [...map.values()].sort(
    (a, b) => a.firstMonth.localeCompare(b.firstMonth) || b.income + b.expense - (a.income + a.expense),
  );
}

// ── URL ⇄ changes ────────────────────────────────────────────────────────────
const cents = (amount: number) => Math.round(amount * 100);

export function encodeChange(c: Change): string {
  switch (c.t) {
    case "shift":
      return `s.${c.g}.${c.n}`;
    case "drop":
      return `d.${c.g}`;
    case "add":
      return `a.${c.m}.${cents(c.amount)}.${c.cash ? "c" : "b"}.${c.label}`;
    case "move":
      return `w.${c.m}.${cents(c.amount)}`;
    case "rule":
      return `r.${c.dir}.${c.project ?? "-"}.${c.uncertain ? "u" : "a"}.${c.op}.${c.n}`;
    case "monthly":
      return `m.${c.from}.${c.to ?? "-"}.${cents(c.amount)}.${c.cash ? "c" : "b"}.${c.label}`;
    case "cashFloor":
      return `g.c.${cents(c.amount)}`;
    case "bankGoal":
      return `g.b.${c.m}.${cents(c.amount)}`;
  }
}

// Anything malformed is dropped, never guessed.
export function decodeChange(raw: string): Change | null {
  const [t, ...p] = raw.split(".");
  const amount = (s: string | undefined) => {
    const n = Number(s);
    return s && Number.isInteger(n) && n !== 0 ? n / 100 : null;
  };
  if (t === "s") {
    const n = Number(p[1]);
    return p[0] && Number.isInteger(n) && n !== 0 && Math.abs(n) <= 36 ? { t: "shift", g: p[0], n } : null;
  }
  if (t === "d") return p[0] ? { t: "drop", g: p[0] } : null;
  if (t === "a") {
    const a = amount(p[1]);
    if (!MONTH.test(p[0] ?? "") || a === null || (p[2] !== "b" && p[2] !== "c")) return null;
    return { t: "add", m: p[0], amount: a, cash: p[2] === "c", label: p.slice(3).join(".").trim() };
  }
  if (t === "w") {
    const a = amount(p[1]);
    return MONTH.test(p[0] ?? "") && a !== null ? { t: "move", m: p[0], amount: a } : null;
  }
  if (t === "r") {
    const [dir, project, scope, op, nRaw] = p;
    if (dir !== "i" && dir !== "e" && dir !== "a") return null;
    if (!project || (project !== "-" && !UUID.test(project)) || (scope !== "u" && scope !== "a")) return null;
    const base = { t: "rule" as const, dir: dir as RuleDir, project: project === "-" ? null : project, uncertain: scope === "u" };
    if (op === "d") return { ...base, op, n: 0 };
    const n = Number(nRaw);
    if (!Number.isInteger(n) || n === 0) return null;
    if (op === "s" && Math.abs(n) <= 36) return { ...base, op, n };
    if (op === "p" && n >= -100 && n <= 500) return { ...base, op, n };
    return null;
  }
  if (t === "m") {
    const a = amount(p[2]);
    const to = p[1] === "-" ? null : p[1];
    if (!MONTH.test(p[0] ?? "") || (to !== null && (!MONTH.test(to) || to < p[0])) || a === null) return null;
    if (p[3] !== "b" && p[3] !== "c") return null;
    return { t: "monthly", from: p[0], to, amount: a, cash: p[3] === "c", label: p.slice(4).join(".").trim() };
  }
  if (t === "g" && p[0] === "c") {
    const a = amount(p[1]);
    return a !== null && a > 0 ? { t: "cashFloor", amount: a } : null;
  }
  if (t === "g" && p[0] === "b") {
    const a = amount(p[2]);
    return MONTH.test(p[1] ?? "") && a !== null && a > 0 ? { t: "bankGoal", m: p[1], amount: a } : null;
  }
  return null;
}

export function decodeChanges(raw: string | string[] | undefined): Change[] {
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return list.map(decodeChange).filter((c): c is Change => c !== null);
}

export const isGoal = (c: Change): c is GoalChange => c.t === "cashFloor" || c.t === "bankGoal";

// ── Rules ────────────────────────────────────────────────────────────────────
function ruleMatches(r: RuleChange, it: WhatIfItem): boolean {
  if (r.dir === "i" && it.direction !== "income") return false;
  if (r.dir === "e" && it.direction !== "expense") return false;
  if (r.project && it.project_id !== r.project) return false;
  if (r.uncertain && !(Number(it.probability ?? 1) < 1)) return false;
  return true;
}

// How many forecast rows a rule touches (for its line in the list).
export function ruleCount(r: RuleChange, items: WhatIfItem[]): number {
  return items.filter((it) => ruleMatches(r, it)).length;
}

// ── The run ──────────────────────────────────────────────────────────────────
export interface WhatIfRow {
  month: string; // 'YYYY-MM'
  bank: number;
  cash: number;
  total: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Month-end balances over `months` months from `firstMonth`, starting from
// the opening balances, with the changes applied. A shift past the horizon
// takes the item out of it; a shift before the first month lands on it.
// Rules apply on top of a group's own shift/drop: shifts add up, a drop
// wins, percentages multiply.
export function runWhatIf(input: {
  firstMonth: string; // 'YYYY-MM'
  months: number;
  openingBank: number;
  openingCash: number;
  items: WhatIfItem[];
  changes: Change[];
}): WhatIfRow[] {
  const { firstMonth, months } = input;
  const keys = Array.from({ length: months }, (_, i) => addMonths(firstMonth, i));
  const index = new Map(keys.map((k, i) => [k, i]));
  const bank = new Array<number>(months).fill(0);
  const cash = new Array<number>(months).fill(0);

  const dropped = new Set(input.changes.filter((c) => c.t === "drop").map((c) => c.g));
  const shiftBy = new Map<string, number>();
  for (const c of input.changes) if (c.t === "shift") shiftBy.set(c.g, (shiftBy.get(c.g) ?? 0) + c.n);
  const rules = input.changes.filter((c): c is RuleChange => c.t === "rule");

  const place = (month: string, amount: number, isCash: boolean) => {
    const m = month < firstMonth ? firstMonth : month;
    const i = index.get(m);
    if (i === undefined) return;
    (isCash ? cash : bank)[i] += amount;
  };

  for (const it of input.items) {
    const g = groupId(groupKeyOf(it));
    if (dropped.has(g)) continue;
    let shift = shiftBy.get(g) ?? 0;
    let factor = 1;
    let drop = false;
    for (const r of rules) {
      if (!ruleMatches(r, it)) continue;
      if (r.op === "d") drop = true;
      else if (r.op === "s") shift += r.n;
      else factor *= 1 + r.n / 100;
    }
    if (drop) continue;
    const amount = (Number(it.weighted_amount) || 0) * factor;
    place(addMonths(it.month.slice(0, 7), shift), it.direction === "income" ? amount : -amount, it.cash);
  }
  for (const c of input.changes) {
    if (c.t === "add") place(c.m, c.amount, c.cash);
    if (c.t === "move") {
      place(c.m, -c.amount, false);
      place(c.m, c.amount, true);
    }
    if (c.t === "monthly") {
      for (const k of keys) if (k >= c.from && (c.to === null || k <= c.to)) place(k, c.amount, c.cash);
    }
  }

  let b = input.openingBank;
  let k = input.openingCash;
  return keys.map((month, i) => {
    b += bank[i];
    k += cash[i];
    return { month, bank: round2(b), cash: round2(k), total: round2(b + k) };
  });
}

// The lowest month-end total, and the first month cash goes below zero.
export function whatIfSummary(rows: WhatIfRow[]): {
  lowest: WhatIfRow | null;
  cashOut: WhatIfRow | null;
  end: WhatIfRow | null;
} {
  const lowest = rows.reduce<WhatIfRow | null>((lo, r) => (!lo || r.total < lo.total ? r : lo), null);
  return { lowest, cashOut: rows.find((r) => r.cash < 0) ?? null, end: rows.at(-1) ?? null };
}

// ── Goals: checked against the run, each with a suggested fix ───────────────
export interface GoalResult {
  goal: GoalChange;
  met: boolean;
  // Cash floor: the month cash is lowest; bank goal: that month (null when
  // the month is outside the horizon).
  at: WhatIfRow | null;
  gap: number; // how much is missing (0 when met)
  // One move of money that meets it -- bank → cash for the floor, cash →
  // bank for the bank goal -- or null when met or out of reach.
  fix: MoveChange | null;
  // With the fix: banks (floor) or cash (goal) at their lowest from then on.
  afterFix: number | null;
}

const roundUp = (n: number, step = 1000) => Math.ceil(n / step) * step;

export function checkGoals(rows: WhatIfRow[], changes: Change[]): GoalResult[] {
  const floor = changes.find((c): c is Extract<GoalChange, { t: "cashFloor" }> => c.t === "cashFloor");
  return changes.filter(isGoal).map((goal): GoalResult => {
    if (goal.t === "cashFloor") {
      const at = rows.reduce<WhatIfRow | null>((lo, r) => (!lo || r.cash < lo.cash ? r : lo), null);
      const first = rows.findIndex((r) => r.cash < goal.amount);
      if (!at || first < 0) return { goal, met: true, at, gap: 0, fix: null, afterFix: null };
      // One transfer by the first month under the floor lifts every later month.
      const gap = goal.amount - at.cash;
      const amount = roundUp(gap);
      const afterFix = Math.min(...rows.slice(first).map((r) => r.bank)) - amount;
      return { goal, met: false, at, gap, fix: { t: "move", m: rows[first].month, amount }, afterFix };
    }
    const i = rows.findIndex((r) => r.month === goal.m);
    if (i < 0) return { goal, met: false, at: null, gap: 0, fix: null, afterFix: null };
    const at = rows[i];
    const gap = Math.max(0, goal.amount - at.bank);
    if (gap === 0) return { goal, met: true, at, gap: 0, fix: null, afterFix: null };
    // A deposit from cash by that month, if cash can spare it from then on
    // (and stay above the cash floor, when one is set).
    const amount = roundUp(gap);
    const lowestCash = Math.min(...rows.slice(i).map((r) => r.cash));
    const ok = lowestCash - amount >= (floor?.amount ?? 0);
    return { goal, met: false, at, gap, fix: ok ? { t: "move", m: goal.m, amount: -amount } : null, afterFix: ok ? lowestCash - amount : null };
  });
}
