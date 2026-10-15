// Σενάρια «τι θα γινόταν αν» (/reports/scenarios): the cash forecast re-run
// in memory with a few changes on top -- nothing is stored, the changes live
// in the URL (?c=…, one per change). The items and the opening balances are
// the SQL's (cash_forecast_items / cash_forecast_by_kind, 0066/0097), so the
// run with no changes is the forecast /reports/cash shows, banks and cash
// kept apart the same way (rows with no account count as bank). Pure, so
// the arithmetic is tested.

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
}

// A change, as kept in the URL:
//   shift  s.<group>.<months>               the group moves N months (− earlier)
//   drop   d.<group>                        the group does not happen
//   add    a.<YYYY-MM>.<signed cents>.<b|c>.<label>   a new amount, bank or cash
//   move   w.<YYYY-MM>.<cents>              withdrawal: bank → cash
// Amounts in whole cents, so the dots only ever separate fields.
export type Change =
  | { t: "shift"; g: string; n: number }
  | { t: "drop"; g: string }
  | { t: "add"; m: string; amount: number; cash: boolean; label: string }
  | { t: "move"; m: string; amount: number };

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

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
export function encodeChange(c: Change): string {
  switch (c.t) {
    case "shift":
      return `s.${c.g}.${c.n}`;
    case "drop":
      return `d.${c.g}`;
    case "add":
      return `a.${c.m}.${Math.round(c.amount * 100)}.${c.cash ? "c" : "b"}.${c.label}`;
    case "move":
      return `w.${c.m}.${Math.round(c.amount * 100)}`;
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
    return MONTH.test(p[0] ?? "") && a !== null && a > 0 ? { t: "move", m: p[0], amount: a } : null;
  }
  return null;
}

export function decodeChanges(raw: string | string[] | undefined): Change[] {
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  return list.map(decodeChange).filter((c): c is Change => c !== null);
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

  const place = (month: string, amount: number, isCash: boolean) => {
    const m = month < firstMonth ? firstMonth : month;
    const i = index.get(m);
    if (i === undefined) return;
    (isCash ? cash : bank)[i] += amount;
  };

  for (const it of input.items) {
    const g = groupId(groupKeyOf(it));
    if (dropped.has(g)) continue;
    const amount = Number(it.weighted_amount) || 0;
    const signed = it.direction === "income" ? amount : -amount;
    place(addMonths(it.month.slice(0, 7), shiftBy.get(g) ?? 0), signed, it.cash);
  }
  for (const c of input.changes) {
    if (c.t === "add") place(c.m, c.amount, c.cash);
    if (c.t === "move") {
      place(c.m, -c.amount, false);
      place(c.m, c.amount, true);
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
