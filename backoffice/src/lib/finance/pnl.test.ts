import { describe, expect, it } from "vitest";
import { pnlTable } from "./pnl";

describe("pnlTable", () => {
  const buckets = ["2026-01", "2026-02"];
  const rows = [
    { bucket: "2026-01", line: "revenue", amount: "1000.10" },
    { bucket: "2026-01", line: "cost_of_sales", amount: -400 },
    { bucket: "2026-02", line: "opex", amount: -100 },
    { bucket: "2026-02", line: "financing", amount: -50.05 },
    { bucket: "2027-01", line: "revenue", amount: 999 }, // outside the buckets
    { bucket: "2026-01", line: "bogus", amount: 7 }, // unknown line
  ];

  it("places every amount in its line and bucket", () => {
    const t = pnlTable(rows, buckets);
    const by = Object.fromEntries(t.rows.map((r) => [r.line, r]));
    expect(by.revenue.values).toEqual([1000.1, 0]);
    expect(by.cost_of_sales.values).toEqual([-400, 0]);
    expect(by.opex.total).toBe(-100);
  });

  it("adds gross profit and the result", () => {
    const by = Object.fromEntries(pnlTable(rows, buckets).rows.map((r) => [r.line, r]));
    expect(by.gross_profit.values).toEqual([600.1, 0]);
    expect(by.result.values).toEqual([600.1, -150.05]);
    expect(by.result.total).toBe(450.05);
  });

  it("keeps statement order", () => {
    expect(pnlTable([], buckets).rows.map((r) => r.line)).toEqual([
      "revenue",
      "cost_of_sales",
      "gross_profit",
      "opex",
      "rent",
      "financing",
      "tax",
      "unclassified",
      "result",
    ]);
  });
});
