import { describe, it, expect } from "vitest";
import { computeLoanSchedule, computeLoansSchedule, computeSingleLoanSchedule, type LoanInput } from "./loan";

const loanA: LoanInput = {
  id: "a",
  label: "Α",
  principal: 100000,
  interestRate: 0.04,
  termYears: 10,
  graceYears: 0,
  drawdowns: [{ month: "2026-01-01", amount: 100000 }],
};
const loanB: LoanInput = {
  id: "b",
  label: "Β",
  principal: 50000,
  interestRate: 0.06,
  termYears: 5,
  graceYears: 1,
  drawdowns: [{ month: "2026-07-01", amount: 50000 }],
};

describe("computeLoansSchedule (each loan on its own terms)", () => {
  it("amortises each loan over its own term and closes both to zero", () => {
    const r = computeLoansSchedule([loanA, loanB])!;
    const a = r.byLoan.a;
    const b = r.byLoan.b;
    expect(a.combined).toHaveLength(120);
    expect(b.combined).toHaveLength(60);
    expect(a.totals.residualAtMaturity).toBe(0);
    expect(b.totals.residualAtMaturity).toBe(0);
    expect(Math.round(a.totals.totalPrincipal)).toBe(100000);
    expect(Math.round(b.totals.totalPrincipal)).toBe(50000);
  });

  it("does not hand one loan's drawdown to the other", () => {
    const r = computeLoansSchedule([loanA, loanB])!;
    const aDrawn = r.byLoan.a.rows.reduce((s, x) => s + x.drawdown, 0);
    const bDrawn = r.byLoan.b.rows.reduce((s, x) => s + x.drawdown, 0);
    expect(Math.round(aDrawn)).toBe(100000);
    expect(Math.round(bDrawn)).toBe(50000);
  });

  it("applies each loan's own grace period", () => {
    const r = computeLoansSchedule([loanA, loanB])!;
    expect(r.byLoan.a.combined[0].principal).toBeGreaterThan(0);
    expect(r.byLoan.b.combined.slice(0, 12).every((m) => m.principal === 0)).toBe(true);
    expect(r.byLoan.b.combined[12].principal).toBeGreaterThan(0);
  });

  it("sums the loans by calendar month", () => {
    const r = computeLoansSchedule([loanA, loanB])!;
    const july = r.combined.find((m) => m.month === "2026-07-01")!;
    const aJuly = r.byLoan.a.combined.find((m) => m.month === "2026-07-01")!;
    const bJuly = r.byLoan.b.combined.find((m) => m.month === "2026-07-01")!;
    expect(july.payment).toBeCloseTo(aJuly.payment + bJuly.payment, 2);
    expect(r.combined[0].monthIndex).toBe(1);
    expect(r.totals.monthlyInstalment).toBeCloseTo(r.byLoan.a.totals.monthlyInstalment + r.byLoan.b.totals.monthlyInstalment, 2);
  });

  it("derives grace from first_amortisation_month when set", () => {
    const s = computeSingleLoanSchedule({ ...loanA, graceYears: 0, firstAmortisationMonth: "2026-07-01" })!;
    expect(s.combined.slice(0, 6).every((m) => m.principal === 0)).toBe(true);
    expect(s.combined[6].principal).toBeGreaterThan(0);
  });

  it("returns null when nothing is drawn", () => {
    expect(computeLoansSchedule([{ ...loanA, drawdowns: [] }])).toBeNull();
  });
});

describe("computeLoanSchedule: a drawdown after amortisation has started", () => {
  it("re-annuitises instead of dumping the late drawdown into the last month", () => {
    const r = computeLoanSchedule(
      [{ id: "a", label: "A", principal: 100000, interestRate: 0.04 }],
      [
        { month: "2026-01-01", amount: 50000 },
        { month: "2027-01-01", amount: 50000 },
      ],
      { firstMonth: "2026-01-01", termYears: 10, graceYears: 0 },
    );
    const last = r.combined.at(-1)!;
    const beforeLast = r.combined.at(-2)!;
    // the final instalment is an ordinary one, not a 40k balloon
    expect(Math.abs(last.payment - beforeLast.payment)).toBeLessThan(1);
    expect(r.totals.residualAtMaturity).toBe(0);
    // and the instalment steps up once the second drawdown arrives
    expect(r.combined[12].payment).toBeGreaterThan(r.combined[11].payment * 1.5);
  });
});
