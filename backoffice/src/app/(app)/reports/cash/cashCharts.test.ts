import { describe, expect, it } from "vitest";
import { largestOutflow, outflowBySourceRows, outflowGroupOf, scenarioBalanceRows } from "./cashCharts";

const label = (m: string) => `L${m}`;

describe("scenarioBalanceRows", () => {
  it("puts each scenario's closing balance on the months of the first", () => {
    const rows = scenarioBalanceRows(
      {
        base: [
          { month: "2026-10-01", closing_balance: "100.004" },
          { month: "2026-11-01", closing_balance: -5 },
        ],
        pessimistic: [{ month: "2026-10-01", closing_balance: 80 }],
      },
      label,
    );
    expect(rows).toEqual([
      { label: "L2026-10", base: 100, pessimistic: 80 },
      { label: "L2026-11", base: -5, pessimistic: null },
    ]);
  });
});

describe("outflowBySourceRows", () => {
  it("groups by source, keeps the forecast's total and lists only used groups", () => {
    const { data, groups } = outflowBySourceRows(
      [
        { month: "2026-10-01", outflow: 1000 },
        { month: "2026-11-01", outflow: 300 },
      ],
      [
        { month: "2026-10-01", source: "open", weighted_amount: 400 },
        { month: "2026-10-01", source: "lease", weighted_amount: 100 },
        { month: "2026-10-01", source: "vat", weighted_amount: 200 },
        { month: "2026-11-01", source: "loan", weighted_amount: 300 },
        { month: "2027-05-01", source: "loan", weighted_amount: 999 }, // outside the horizon
      ],
      label,
    );
    expect(groups).toEqual(["open", "installment", "loan", "vat", "other"]);
    // 1000 − 700 covered -> 300 in «other»
    expect(data[0]).toMatchObject({ label: "L2026-10", open: 400, installment: 100, vat: 200, other: 300, loan: 0 });
    expect(data[1]).toMatchObject({ loan: 300, other: 0 });
  });

  it("maps every known source to one of six groups", () => {
    expect(outflowGroupOf("future_paid")).toBe("open");
    expect(outflowGroupOf("liability")).toBe("loan");
    expect(outflowGroupOf("withholding")).toBe("withholding");
    expect(outflowGroupOf("deal")).toBe("other");
    expect(outflowGroupOf(null)).toBe("other");
  });
});

describe("largestOutflow", () => {
  it("returns the month's largest weighted outflow", () => {
    const items = [
      { month: "2026-10-01", source: "open", label: "a", weighted_amount: 10 },
      { month: "2026-11-01", source: "open", label: "b", weighted_amount: 50 },
      { month: "2026-11-01", source: "vat", label: "c", weighted_amount: 70 },
    ];
    expect(largestOutflow(items, "2026-11")?.label).toBe("c");
    expect(largestOutflow(items, "2027-01")).toBeNull();
  });
});
