import { describe, expect, it } from "vitest";
import {
  ALL_RELIABILITY_CODES,
  accountBalancesAt,
  change,
  changePctLabel,
  contributors,
  latestUpTo,
  reliability,
  reliabilityText,
  reportKeyOf,
  sumParts,
  topMovements,
  txIdsHref,
  vsTarget,
  whyText,
} from "./insights";

describe("change", () => {
  it("gives the difference and the percentage on a positive base", () => {
    const ch = change(120, 100);
    expect(ch.delta).toBe(20);
    expect(ch.pct).toBeCloseTo(0.2);
    expect(changePctLabel(ch)).toBe("+20%");
  });

  it("gives no percentage on a negative or zero base", () => {
    const fromLoss = change(50, -100);
    expect(fromLoss.delta).toBe(150);
    expect(fromLoss.pct).toBeNull();
    expect(changePctLabel(fromLoss)).toBe("από αρνητική βάση");
    expect(change(50, 0).pct).toBeNull();
    expect(changePctLabel(change(50, 0))).toBe("από μηδέν");
  });

  it("has nothing to compare without a previous figure", () => {
    const ch = change(10, null);
    expect(ch.delta).toBeNull();
    expect(changePctLabel(ch)).toBe("χωρίς στοιχεία σύγκρισης");
  });
});

describe("contributors", () => {
  it("ranks the parts by how much they moved, either sign", () => {
    const list = contributors(
      [
        { key: "a", label: "Έσοδα", amount: 100 },
        { key: "b", label: "Λειτουργικά", amount: -50 },
        { key: "c", label: "Ενοίκια", amount: -10 },
      ],
      [
        { key: "a", label: "Έσοδα", amount: 90 },
        { key: "b", label: "Λειτουργικά", amount: -20 },
        { key: "c", label: "Ενοίκια", amount: -10 },
        { key: "d", label: "Φόροι", amount: -5 },
      ],
    );
    expect(list.map((c) => [c.key, c.delta])).toEqual([
      ["b", -30],
      ["a", 10],
      ["d", 5],
    ]);
    expect(whyText(list)).toBe("κυρίως Λειτουργικά −30 €, Έσοδα +10 €, Φόροι +5 €");
  });

  it("is empty (no «why») when nothing moved", () => {
    const same = [{ key: "a", label: "x", amount: 5 }];
    expect(contributors(same, same)).toEqual([]);
    expect(whyText([])).toBeNull();
  });
});

describe("topMovements / txIdsHref", () => {
  it("keeps the five largest by size, either sign", () => {
    const rows = [1, -9, 3, 7, -2, 8, 0].map((amount, i) => ({ id: `t${i}`, amount }));
    expect(topMovements(rows).map((r) => r.amount)).toEqual([-9, 8, 7, 3, -2]);
  });

  it("links the rows' transactions, without repeats or blanks", () => {
    expect(txIdsHref(["a", "b", "a", null, ""])).toBe("/transactions?ids=a,b");
    expect(txIdsHref([])).toBeNull();
  });
});

describe("vsTarget", () => {
  it("gives the gap and the share of a positive target", () => {
    expect(vsTarget(80, 100)).toEqual({ gap: -20, share: 0.8 });
    expect(vsTarget(80, 0)).toEqual({ gap: 80, share: null });
    expect(vsTarget(80, null)).toEqual({ gap: null, share: null });
  });
});

describe("reliability", () => {
  const rows = [
    { code: "account_drift", count: 2, href: "/accounts" },
    { code: "spend_without_treatment", count: 3, href: "/reports/quality" },
    { code: "below_buffer", count: 1, href: "/reports/cash" },
  ];

  it("counts only the checks that touch the report", () => {
    expect(reliability(rows, "net-worth")).toEqual({ count: 2, codes: ["account_drift"], href: "/accounts" });
    expect(reliability(rows, "pnl")?.count).toBe(3);
    expect(reliability(rows, "cash")?.count).toBe(2);
    expect(reliability(rows, "vat")).toBeNull();
  });

  it("sends several checks to the quality report", () => {
    expect(reliability(rows, "portfolio")?.href).toBe("/reports/quality");
    expect(reliability([...rows, { code: "account_uncounted", count: 1, href: "/accounts" }], "cash")?.href).toBe("/reports/quality");
  });

  it("knows the report from the path", () => {
    expect(reportKeyOf("/reports/net-worth")).toBe("net-worth");
    expect(reportKeyOf("/reports/quality")).toBeNull();
    expect(reportKeyOf("/accounts")).toBeNull();
    expect(ALL_RELIABILITY_CODES).toContain("vat_mismatch");
    expect(reliabilityText(1)).toContain("1 θέμα ");
  });
});

describe("latestUpTo", () => {
  it("is the latest date not after today", () => {
    expect(latestUpTo(["2026-09-30", "2026-10-20", null, "2026-10-01"], "2026-10-13")).toBe("2026-10-01");
    expect(latestUpTo(["2026-09", "2026-11"], "2026-10-13")).toBe("2026-09");
    expect(latestUpTo([], "2026-10-13")).toBeNull();
  });
});

describe("accountBalancesAt", () => {
  const accounts = [
    { account_id: "a", name: "Τράπεζα", current_balance: 1000, opening_balance_date: "2025-01-01" },
    { account_id: "b", name: "Νέος", current_balance: 300, opening_balance_date: "2026-10-01" },
  ];
  const ledger = [
    { account_id: "a", month: "2026-10", inflow: 100, outflow: 50 },
    { account_id: "a", month: "2026-09", inflow: 0, outflow: 200 },
    { account_id: "b", month: "2026-10", inflow: 300, outflow: 0 },
  ];

  it("rebuilds each account's month-end balance backwards from today", () => {
    expect(accountBalancesAt(accounts, ledger, "2026-10", "2026-10").map((p) => p.amount)).toEqual([1000, 300]);
    const sept = accountBalancesAt(accounts, ledger, "2026-09", "2026-10");
    expect(sept.map((p) => p.amount)).toEqual([950, 0]);
    expect(sumParts(sept)).toBe(950);
    expect(accountBalancesAt(accounts, ledger, "2026-08", "2026-10")[0].amount).toBe(1150);
  });
});
