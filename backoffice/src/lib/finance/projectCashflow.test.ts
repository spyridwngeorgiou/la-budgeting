import { describe, expect, it } from "vitest";
import { computeProjectCashflow, type CashflowInputs } from "./projectCashflow";

// Debt service from Jan 2026, opening Aug 2027 (Q003's shape).
const combined = Array.from({ length: 36 }, (_, i) => ({
  month: `${2026 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-01`,
  interest: 100,
  principal: 900,
}));

const inputs = {
  openingMonth: "2027-08-01",
  baseYear: 2027,
  revenueMonthlyByOperatingYear: [Array(12).fill(5000), Array(12).fill(5000)],
  opexAnnualByOperatingYear: [12000, 12000],
  revenueGrowthPct: 0,
  opexGrowthPct: 0,
  growthStartsAfterOperatingYear: 0,
  leaseSchedule: null,
  leaseStartMonth: null,
  leaseFirstPaymentMonth: null,
  loanSchedule: { combined } as unknown as CashflowInputs["loanSchedule"],
  horizonYears: 2,
  discountRatePct: 8,
  dscrCovenantMin: 1.2,
} satisfies CashflowInputs;

describe("computeProjectCashflow DSCR", () => {
  it("counts from the opening: a year wholly before it has no DSCR and no breach", () => {
    const { years, kpis } = computeProjectCashflow(inputs);
    const y2026 = years.find((y) => y.calendarYear === 2026)!;
    expect(y2026.debtService).toBe(12000);
    expect(y2026.dscr).toBeNull();
    expect(years.find((y) => y.calendarYear === 2027)!.dscr).not.toBeNull();
    expect(kpis.covenantBreaches.map((b) => b.calendarYear)).not.toContain(2026);
    expect(kpis.minDscr?.calendarYear).not.toBe(2026);
  });
});
