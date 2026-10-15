import { describe, expect, it } from "vitest";
import {
  checkGoals,
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
    expect(decodeChanges(["s.x.0", "s.x.abc", "a.2027-13.5.b.x", "a.2027-01.0.b.x", "w.2027-01.0", "q.1", "d."])).toEqual([]);
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
  it("applies a rule to many rows: by direction, project, uncertainty", () => {
    const P = "11111111-2222-3333-4444-555555555555";
    const items = [
      item({ item_key: "e:1", label: "a", project_id: P, weighted_amount: 100 }),
      item({ item_key: "e:2", label: "b", project_id: null, weighted_amount: 100 }),
      item({ item_key: "i:1", label: "c", direction: "income", probability: 0.5, weighted_amount: 50 }),
    ];
    const at = (changes: Change[]) => run(changes, items).map((r) => r.bank);
    expect(at([])).toEqual([350, 350, 350, 350]);
    expect(at([{ t: "rule", dir: "e", project: P, uncertain: false, op: "s", n: 2 }])).toEqual([450, 450, 350, 350]);
    expect(at([{ t: "rule", dir: "e", project: null, uncertain: false, op: "p", n: 10 }])).toEqual([330, 330, 330, 330]);
    expect(at([{ t: "rule", dir: "a", project: null, uncertain: true, op: "d", n: 0 }])).toEqual([300, 300, 300, 300]);
  });
  it("adds a monthly amount from…to (or to the end)", () => {
    expect(run([{ t: "monthly", from: "2026-11", to: "2026-12", amount: -10, cash: true, label: "x" }], []).map((r) => r.cash)).toEqual([200, 190, 180, 180]);
    expect(run([{ t: "monthly", from: "2026-12", to: null, amount: 5, cash: false, label: "" }], []).map((r) => r.bank)).toEqual([500, 500, 505, 510]);
  });
  it("summarises the lowest point and when cash runs out", () => {
    const s = whatIfSummary(run([]));
    expect(s.lowest?.month).toBe("2026-10");
    expect(s.cashOut?.month).toBe("2026-10");
    expect(s.end?.total).toBe(1390);
  });
});

describe("more changes in the URL", () => {
  it("round-trips rules, monthly amounts, deposits and goals", () => {
    const changes: Change[] = [
      { t: "rule", dir: "e", project: "11111111-2222-3333-4444-555555555555", uncertain: false, op: "s", n: 3 },
      { t: "rule", dir: "i", project: null, uncertain: true, op: "d", n: 0 },
      { t: "rule", dir: "a", project: null, uncertain: false, op: "p", n: -20 },
      { t: "monthly", from: "2026-11", to: null, amount: -3000, cash: true, label: "Προσωπικά" },
      { t: "monthly", from: "2026-11", to: "2027-02", amount: 500, cash: false, label: "" },
      { t: "move", m: "2027-01", amount: -20000 },
      { t: "cashFloor", amount: 20000 },
      { t: "bankGoal", m: "2026-11", amount: 400000 },
    ];
    expect(changes.map((c) => decodeChange(encodeChange(c)))).toEqual(changes);
  });
  it("drops malformed rules and goals", () => {
    expect(decodeChanges(["r.x.-.a.s.1", "r.e.notauuid.a.s.1", "r.e.-.a.p.900", "m.2027-02.2027-01.5.b.x", "g.c.-5", "g.b.2026-13.5"])).toEqual([]);
  });
});

describe("checkGoals", () => {
  const rows = [
    { month: "2026-10", bank: 1000, cash: 50, total: 1050 },
    { month: "2026-11", bank: 900, cash: 10, total: 910 },
    { month: "2026-12", bank: 800, cash: -500, total: 300 },
  ];
  it("suggests one transfer to keep cash above its floor", () => {
    const [g] = checkGoals(rows, [{ t: "cashFloor", amount: 20 }]);
    expect(g).toMatchObject({ met: false, gap: 520, fix: { t: "move", m: "2026-11", amount: 1000 }, afterFix: -200 });
  });
  it("suggests a deposit from cash for a bank goal, only if cash can spare it", () => {
    const ok = checkGoals(
      [
        { month: "2026-10", bank: 100, cash: 5000, total: 5100 },
        { month: "2026-11", bank: 100, cash: 4000, total: 4100 },
      ],
      [{ t: "bankGoal", m: "2026-10", amount: 1500 }],
    )[0];
    expect(ok).toMatchObject({ met: false, gap: 1400, fix: { t: "move", m: "2026-10", amount: -2000 }, afterFix: 2000 });
    const no = checkGoals(rows, [{ t: "bankGoal", m: "2026-11", amount: 5000 }])[0];
    expect(no).toMatchObject({ met: false, gap: 4100, fix: null });
    expect(checkGoals(rows, [{ t: "bankGoal", m: "2026-10", amount: 500 }])[0].met).toBe(true);
  });
});
