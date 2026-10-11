import { describe, expect, it } from "vitest";
import { pnlTable } from "./pnl";
import { cashChartRows, netWorthRows, pnlChartRows, topCostRows, vatChartRows } from "./reportCharts";

const id = (s: string) => s;

describe("cashChartRows", () => {
  it("keeps in/out as magnitudes and the closing balance", () => {
    expect(
      cashChartRows([{ month: "2026-10-01", inflow: "1000.005", outflow: 250, closing_balance: "5000" }], id),
    ).toEqual([{ label: "2026-10", inflow: 1000.01, outflow: 250, balance: 5000 }]);
  });
});

describe("pnlChartRows", () => {
  const months = ["2026-01", "2026-02"];
  const now = pnlTable(
    [
      { bucket: "2026-01", line: "revenue", amount: 1000 },
      { bucket: "2026-01", line: "opex", amount: -300 },
      { bucket: "2026-02", line: "rent", amount: -100 },
    ],
    months,
  );
  const prev = pnlTable([{ bucket: "2026-01", line: "revenue", amount: 50 }], months);

  it("splits revenue and total cost, with the result", () => {
    const rows = pnlChartRows(now, null, months, id);
    expect(rows[0]).toEqual({ label: "2026-01", revenue: 1000, cost: 300, result: 700, lastYear: null });
    expect(rows[1]).toEqual({ label: "2026-02", revenue: 0, cost: 100, result: -100, lastYear: null });
  });

  it("adds last year's result month by month", () => {
    expect(pnlChartRows(now, prev, months, id).map((r) => r.lastYear)).toEqual([50, 0]);
  });
});

describe("topCostRows", () => {
  it("keeps the largest positive costs, largest first", () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ name: `c${i}`, amount: i * 10 }));
    const top = topCostRows(rows);
    expect(top).toHaveLength(8);
    expect(top[0]).toEqual({ label: "c9", amount: 90 });
    expect(top.some((r) => r.amount <= 0)).toBe(false);
  });
});

describe("vatChartRows", () => {
  const rows = [
    { period_start: "2026-10-01", payable_after_credit: 120, credit_balance: 0, filing_deadline: "2026-11-30" },
    { period_start: "2026-08-01", payable_after_credit: 0, credit_balance: -40, filing_deadline: "2026-09-30" },
    { period_start: "2026-09-01", payable_after_credit: "240", credit_balance: 0, filing_deadline: "2026-10-31" },
  ];

  it("orders periods, payable below zero and credit above", () => {
    const { data } = vatChartRows(rows, id, "2026-10-11");
    expect(data).toEqual([
      { label: "2026-08-01", payable: 0, credit: 40 },
      { label: "2026-09-01", payable: -240, credit: 0 },
      { label: "2026-10-01", payable: -120, credit: 0 },
    ]);
  });

  it("marks the next deadline with something to pay", () => {
    expect(vatChartRows(rows, id, "2026-10-11").nextDeadline).toEqual({ x: "2026-09-01", deadline: "2026-10-31" });
    expect(vatChartRows(rows, id, "2026-12-01").nextDeadline).toBeNull();
  });
});

describe("netWorthRows", () => {
  it("owned first, then owed, as magnitudes; empty parts left out", () => {
    const rows = netWorthRows({ cash: 100, assets: 500, loans: -300, vat: 0 }, ["cash", "assets", "loans", "vat"], id);
    expect(rows).toEqual([
      { label: "assets", amount: 500, tone: "navy" },
      { label: "cash", amount: 100, tone: "navy" },
      { label: "loans", amount: 300, tone: "negative" },
    ]);
  });
});
