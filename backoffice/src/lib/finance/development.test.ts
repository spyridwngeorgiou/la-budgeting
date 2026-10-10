import { describe, expect, it } from "vitest";
import { computeDevelopmentResult, flowFromExpected, flowFromTransaction } from "./development";

const TODAY = "2026-10-10";

describe("flowFromTransaction", () => {
  const base = { direction: "expense", status: "paid", tx_date: "2026-01-05", paid_on: "2026-01-06", gross_amount: 1240, vat_amount: 240 };

  it("is net of VAT, signed, on the date it cleared", () => {
    expect(flowFromTransaction(base, TODAY)).toEqual({ date: "2026-01-06", amount: -1000 });
  });

  it("puts an overdue open row today and a future one on its due date", () => {
    expect(flowFromTransaction({ ...base, status: "pending", due_date: "2026-02-01" }, TODAY)?.date).toBe(TODAY);
    expect(flowFromTransaction({ ...base, status: "scheduled", due_date: "2027-03-01" }, TODAY)?.date).toBe("2027-03-01");
  });

  it("leaves out financing, principal, equity, VAT and loan instalments", () => {
    for (const treatment of ["financing", "principal", "equity", "vat", "pass_through"]) {
      expect(flowFromTransaction({ ...base, treatment }, TODAY)).toBeNull();
    }
    expect(flowFromTransaction({ ...base, loan_id: "x" }, TODAY)).toBeNull();
    expect(flowFromTransaction({ ...base, status: "cancelled" }, TODAY)).toBeNull();
  });
});

describe("flowFromExpected", () => {
  it("weights by probability, falling back to certainty", () => {
    expect(flowFromExpected({ direction: "income", amount: 1000, expected_month: "2027-01-01", probability: 0.4 }, TODAY)).toEqual({
      date: "2027-01-01",
      amount: 400,
    });
    expect(
      flowFromExpected({ direction: "expense", amount: 1000, expected_month: "2027-01-01", probability: null, certainty: "certain" }, TODAY),
    ).toEqual({ date: "2027-01-01", amount: -1000 });
  });
});

describe("computeDevelopmentResult", () => {
  // buy 100k, build 50k, sell 200k a year later
  const flows = [
    { date: "2025-01-01", amount: -100000 },
    { date: "2025-07-01", amount: -50000 },
    { date: "2026-01-01", amount: 200000 },
  ];

  it("margin, peak funding and XIRR", () => {
    const r = computeDevelopmentResult(flows, { today: TODAY });
    expect(r.revenue).toBe(200000);
    expect(r.cost).toBe(150000);
    expect(r.margin).toBe(50000);
    expect(r.marginPct).toBeCloseTo(0.25);
    expect(r.peakFunding).toBe(150000);
    expect(r.peakFundingDate).toBe("2025-07-01");
    expect(r.irr).toBeGreaterThan(0.3);
    expect(r.irr).toBeLessThan(0.45);
  });

  it("the uncommitted budget is spent today", () => {
    const r = computeDevelopmentResult([{ date: "2025-01-01", amount: -1000 }], { today: TODAY, remainingBudget: 500 });
    expect(r.cost).toBe(1500);
    expect(r.peakFunding).toBe(1500);
    expect(r.irr).toBeNull();
  });
});
