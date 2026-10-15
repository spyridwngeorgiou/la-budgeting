import { describe, expect, it } from "vitest";
import {
  decodeChange,
  decodeChanges,
  encodeChange,
  groupId,
  groupKeyOf,
  runWhatIf,
  whatIfGroups,
  whatIfSummary,
  type Change,
  type WhatIfItem,
} from "./whatIf";

const item = (p: Partial<WhatIfItem>): WhatIfItem => ({
  item_key: "tx:1",
  source: "open",
  ref_id: "r1",
  label: "x",
  month: "2026-10-01",
  direction: "expense",
  weighted_amount: 0,
  cash: false,
  ...p,
});

const loanDraw = item({ item_key: "drawdown:1", source: "drawdown", ref_id: "L", label: "Δάνειο", month: "2026-11-01", direction: "income", weighted_amount: 1000 });
const loanInt = item({ item_key: "loan_interest:L:2026-12", source: "loan_interest", ref_id: "L", label: "Δάνειο — τόκοι", month: "2026-12-01", weighted_amount: "10" });
const cashPay = item({ item_key: "tx:2", label: "Ανακαίνιση", month: "2026-10-01", weighted_amount: 300, cash: true });
const LOAN = groupId(groupKeyOf(loanDraw));

const run = (changes: Change[], items = [loanDraw, loanInt, cashPay]) =>
  runWhatIf({ firstMonth: "2026-10", months: 4, openingBank: 500, openingCash: 200, items, changes });

describe("groups", () => {
  it("keeps a loan's drawdowns and interest together", () => {
    expect(groupId(groupKeyOf(loanInt))).toBe(LOAN);
    const groups = whatIfGroups([loanDraw, loanInt, cashPay]);
    expect(groups.map((g) => [g.label, g.count])).toEqual([
      ["Ανακαίνιση", 1],
      ["Δάνειο", 2],
    ]);
    expect(groups[1]).toMatchObject({ income: 1000, expense: 10, firstMonth: "2026-11" });
  });
});

describe("URL", () => {
  it("round-trips every change", () => {
    const changes: Change[] = [
      { t: "shift", g: LOAN, n: -2 },
      { t: "drop", g: "abc" },
      { t: "add", m: "2027-05", amount: -300000.5, cash: false, label: "Οικόπεδο Α.Ε." },
      { t: "move", m: "2027-02", amount: 50000 },
    ];
    expect(changes.map((c) => decodeChange(encodeChange(c)))).toEqual(changes);
  });
  it("drops malformed changes", () => {
    expect(decodeChanges(["s.x.0", "s.x.abc", "a.2027-13.5.b.x", "a.2027-01.0.b.x", "w.2027-01.-5", "q.1", "d."])).toEqual([]);
  });
});

describe("runWhatIf", () => {
  it("with no changes, runs the forecast, banks and cash apart", () => {
    expect(run([])).toEqual([
      { month: "2026-10", bank: 500, cash: -100, total: 400 },
      { month: "2026-11", bank: 1500, cash: -100, total: 1400 },
      { month: "2026-12", bank: 1490, cash: -100, total: 1390 },
      { month: "2027-01", bank: 1490, cash: -100, total: 1390 },
    ]);
  });
  it("shifts a group, out of the horizon when far enough", () => {
    expect(run([{ t: "shift", g: LOAN, n: 2 }]).map((r) => r.bank)).toEqual([500, 500, 500, 1500]);
    expect(run([{ t: "shift", g: LOAN, n: 12 }]).map((r) => r.bank)).toEqual([500, 500, 500, 500]);
  });
  it("lands an earlier shift on the first month", () => {
    expect(run([{ t: "shift", g: LOAN, n: -5 }]).map((r) => r.bank)).toEqual([1490, 1490, 1490, 1490]);
  });
  it("drops, adds and moves bank → cash", () => {
    const rows = run([
      { t: "drop", g: LOAN },
      { t: "add", m: "2026-11", amount: -50, cash: false, label: "" },
      { t: "move", m: "2026-10", amount: 150 },
    ]);
    expect(rows[0]).toEqual({ month: "2026-10", bank: 350, cash: 50, total: 400 });
    expect(rows[3]).toEqual({ month: "2027-01", bank: 300, cash: 50, total: 350 });
  });
  it("summarises the lowest point and when cash runs out", () => {
    const s = whatIfSummary(run([]));
    expect(s.lowest?.month).toBe("2026-10");
    expect(s.cashOut?.month).toBe("2026-10");
    expect(s.end?.total).toBe(1390);
  });
});
