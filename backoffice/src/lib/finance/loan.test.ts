import { describe, it, expect } from "vitest";
import { computeLoanSchedule, type LoanTranche, type LoanDrawdown } from "./loan";

describe("computeLoanSchedule", () => {
  it("closes the balance to exactly zero at maturity (the workbook's €15.580 defect, fixed)", () => {
    const tranches: LoanTranche[] = [{ id: "a", label: "Tranche A", principal: 100000, interestRate: 0.035 }];
    const drawdowns: LoanDrawdown[] = [{ month: "2026-01-01", amount: 100000 }];
    const result = computeLoanSchedule(tranches, drawdowns, { firstMonth: "2026-01-01", termYears: 15, graceYears: 0 });
    expect(result.totals.residualAtMaturity).toBe(0);
    expect(result.combined.at(-1)!.closingBalance).toBe(0);
  });

  it("every row's payment equals interest + principal", () => {
    const tranches: LoanTranche[] = [{ id: "a", label: "A", principal: 50000, interestRate: 0.04 }];
    const drawdowns: LoanDrawdown[] = [{ month: "2026-01-01", amount: 50000 }];
    const result = computeLoanSchedule(tranches, drawdowns, { firstMonth: "2026-01-01", termYears: 5, graceYears: 1 });
    for (const row of result.rows) {
      expect(Math.round((row.interest + row.principal) * 100)).toBe(Math.round(row.payment * 100));
    }
  });

  it("charges interest but no principal during the grace period", () => {
    const tranches: LoanTranche[] = [{ id: "a", label: "A", principal: 30000, interestRate: 0.05 }];
    const drawdowns: LoanDrawdown[] = [{ month: "2026-01-01", amount: 30000 }];
    const result = computeLoanSchedule(tranches, drawdowns, { firstMonth: "2026-01-01", termYears: 3, graceYears: 1 });
    const graceRows = result.combined.filter((r) => r.phase === "grace");
    expect(graceRows.length).toBe(12);
    expect(graceRows.every((r) => r.principal === 0)).toBe(true);
    expect(graceRows.every((r) => r.interest > 0)).toBe(true);
  });

  it("splits a shared drawdown across tranches proportionally to principal, summing exactly to the total", () => {
    const tranches: LoanTranche[] = [
      { id: "a", label: "A", principal: 70000, interestRate: 0.03 },
      { id: "b", label: "B", principal: 30000, interestRate: 0.03 },
    ];
    const drawdowns: LoanDrawdown[] = [{ month: "2026-01-01", amount: 100000 }];
    const result = computeLoanSchedule(tranches, drawdowns, { firstMonth: "2026-01-01", termYears: 10, graceYears: 0 });
    const monthOneA = result.rows.find((r) => r.trancheId === "a" && r.monthIndex === 1)!;
    const monthOneB = result.rows.find((r) => r.trancheId === "b" && r.monthIndex === 1)!;
    expect(Math.round((monthOneA.drawdown + monthOneB.drawdown) * 100)).toBe(10000000);
    expect(monthOneA.drawdown).toBeCloseTo(70000, 0);
    expect(monthOneB.drawdown).toBeCloseTo(30000, 0);
  });

  it("total principal repaid across the schedule equals total drawn (loan fully amortises)", () => {
    const tranches: LoanTranche[] = [{ id: "a", label: "A", principal: 40000, interestRate: 0.045 }];
    const drawdowns: LoanDrawdown[] = [{ month: "2026-01-01", amount: 40000 }];
    const result = computeLoanSchedule(tranches, drawdowns, { firstMonth: "2026-01-01", termYears: 8, graceYears: 0 });
    expect(Math.round(result.totals.totalPrincipal)).toBe(40000);
  });
});
