import { describe, expect, it } from "vitest";
import { pnlTable } from "@/lib/finance/pnl";
import { accountStatus, isOverdue, onScreenTotals, signedAmount, visiblePnlRows } from "./model";
import { legacyHref, moneyTabs, parseMoneyTab, parseReportView } from "./tabs";

describe("amounts", () => {
  it("signs by direction and sums what is on screen", () => {
    expect(signedAmount("income", 10)).toBe(10);
    expect(signedAmount("expense", 10)).toBe(-10);
    const rows = [
      { direction: "income", gross_amount: 100.1 },
      { direction: "expense", gross_amount: 30.05 },
      { direction: "expense", gross_amount: null },
    ];
    expect(onScreenTotals(rows)).toEqual({ income: 100.1, expense: 30.05, net: 70.05 });
  });

  it("an open row past its due date is overdue; a paid one never", () => {
    expect(isOverdue({ status: "pending", due_date: "2026-01-01" }, "2026-02-01")).toBe(true);
    expect(isOverdue({ status: "scheduled", due_date: "2025-12-01" }, "2026-02-01")).toBe(true);
    expect(isOverdue({ status: "paid", due_date: "2026-01-01" }, "2026-02-01")).toBe(false);
    expect(isOverdue({ status: "pending", due_date: null }, "2026-02-01")).toBe(false);
  });
});

describe("accountStatus", () => {
  it("classifies the latest balance check", () => {
    expect(accountStatus(null, "2026-03-01")).toBe("never");
    expect(accountStatus({ as_of_date: "2026-02-28", total_gap: -1.5 }, "2026-03-01")).toBe("drift");
    expect(accountStatus({ as_of_date: "2026-01-01", total_gap: 0.4 }, "2026-03-01")).toBe("stale");
    expect(accountStatus({ as_of_date: "2026-02-20", total_gap: 0.4 }, "2026-03-01")).toBe("ok");
  });
});

describe("visiblePnlRows", () => {
  it("keeps revenue and the subtotals, hides empty lines", () => {
    const { rows } = pnlTable(
      [
        { bucket: "2026-01", line: "opex", amount: -50 },
        { bucket: "2026-02", line: "revenue", amount: 0 },
      ],
      ["2026-01", "2026-02"],
    );
    expect(visiblePnlRows(rows).map((r) => r.line)).toEqual(["revenue", "gross_profit", "opex", "result"]);
  });
});

describe("money tabs", () => {
  it("maps segments to tabs", () => {
    expect(parseMoneyTab(undefined)).toBe("transactions");
    expect(parseMoneyTab(["transactions"])).toBe("transactions");
    expect(parseMoneyTab(["flow"])).toBe("flow");
    expect(parseMoneyTab(["nope"])).toBeNull();
    expect(parseMoneyTab(["flow", "x"])).toBeNull();
    expect(parseReportView("taxes")).toBe("taxes");
    expect(parseReportView("x")).toBe("pnl");
    expect(moneyTabs().map((t) => t.href)).toEqual(["/money", "/money/flow", "/money/accounts", "/money/contacts", "/money/reports"]);
  });

  it("sends the classic look to the page each tab replaces, with its filters", () => {
    expect(legacyHref("transactions", { status: "pending", edit: "1" })).toBe("/transactions?status=pending");
    expect(legacyHref("flow", { months: "24" })).toBe("/reports/cash?months=24");
    expect(legacyHref("accounts", {})).toBe("/accounts");
    expect(legacyHref("contacts", { q: "x" })).toBe("/contacts");
    expect(legacyHref("reports", {})).toBe("/reports/pnl");
    expect(legacyHref("reports", { view: "taxes" })).toBe("/reports/vat");
    expect(legacyHref("reports", { view: "assets" })).toBe("/reports/net-worth");
  });
});
