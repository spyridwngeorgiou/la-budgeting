import { describe, expect, it } from "vitest";
import { accountBalancesAt, change, latestUpTo, reliability, sumParts, txIdsHref, vsPrevText, vsTarget } from "./insights";

describe("change / vsPrevText", () => {
  it("gives the difference and the percentage on a positive base", () => {
    const ch = change(120, 100);
    expect(ch.delta).toBe(20);
    expect(ch.pct).toBeCloseTo(0.2);
    expect(vsPrevText(ch)).toMatch(/^\+20,00\s€ \(\+20%\) έναντι προηγ\. μήνα$/);
  });

  it("gives no percentage on a negative or zero base", () => {
    const fromLoss = change(50, -100);
    expect(fromLoss.delta).toBe(150);
    expect(fromLoss.pct).toBeNull();
    expect(vsPrevText(fromLoss)).not.toContain("%");
    expect(change(50, 0).pct).toBeNull();
    expect(vsPrevText(change(50, 0), "Σεπ")).toMatch(/έναντι Σεπ$/);
  });

  it("has nothing to compare without a previous figure", () => {
    const ch = change(10, null);
    expect(ch.delta).toBeNull();
    expect(vsPrevText(ch)).toBeNull();
  });
});

describe("txIdsHref", () => {
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

  it("counts the withholding checks on the VAT tab", () => {
    expect(reliability([{ code: "withholding_on_income", count: 1, href: null }], "vat")).toEqual({
      count: 1,
      codes: ["withholding_on_income"],
      href: "/reports/quality",
    });
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
