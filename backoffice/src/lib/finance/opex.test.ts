import { describe, expect, it } from "vitest";
import { opexForYear, opexSchedule, payrollAnnual, type OpexLineInput } from "./opex";

const NO_GROWTH = { opexGrowthPct: 0, growthStartsAfterOperatingYear: 3 };

const payroll: OpexLineInput = {
  kind: "payroll",
  label: "Ρεσεψιόν",
  from_operating_year: 1,
  to_operating_year: null,
  headcount: 2,
  monthly_wage: 1000,
  salaries_per_year: 14,
  employer_contribution_pct: 0.2179,
  premium_pct: 0,
  months_active: 12,
};

describe("payrollAnnual", () => {
  it("headcount × wage × 14 salaries + employer contributions", () => {
    // 2 × 1.000 × 14 = 28.000; × 1,2179 = 34.101,20
    expect(payrollAnnual(payroll)).toBe(34101.2);
  });

  it("a seasonal post earns its share of the 14 salaries, with the premium", () => {
    // 1 × 1.000 × 1,14 × 14 × 6/12 = 7.980; no contributions
    expect(
      payrollAnnual({ ...payroll, headcount: 1, employer_contribution_pct: 0, premium_pct: 0.14, months_active: 6 }),
    ).toBe(7980);
  });
});

describe("opexSchedule", () => {
  const lines: OpexLineInput[] = [
    payroll,
    { kind: "fixed_annual", label: "Ασφάλιση", from_operating_year: 1, to_operating_year: null, annual_amount: 5000 },
    { kind: "fixed_annual", label: "Εγκαίνια", from_operating_year: 1, to_operating_year: 1, annual_amount: 3000 },
    { kind: "pct_of_revenue", label: "Booking", from_operating_year: 1, to_operating_year: null, pct_of_revenue: 0.15 },
    { kind: "pct_of_revenue", label: "Συντήρηση", from_operating_year: 6, to_operating_year: null, pct_of_revenue: 0.025 },
  ];

  it("keeps open-ended lines for the whole horizon and one-offs in their year", () => {
    const s = opexSchedule(lines, 7, NO_GROWTH);
    expect(s.fixedAnnual[0]).toBe(34101.2 + 5000 + 3000);
    expect(s.fixedAnnual[6]).toBe(34101.2 + 5000);
  });

  it("sums % of revenue per year, from the year a line starts", () => {
    const s = opexSchedule(lines, 7, NO_GROWTH);
    expect(s.pctOfRevenue[0]).toBeCloseTo(0.15);
    expect(s.pctOfRevenue[5]).toBeCloseTo(0.175);
  });

  it("compounds growth after the growth start year, never on % lines", () => {
    const s = opexSchedule(
      [{ kind: "fixed_annual", label: "x", from_operating_year: 1, to_operating_year: null, annual_amount: 1000 }],
      5,
      { opexGrowthPct: 0.1, growthStartsAfterOperatingYear: 3 },
    );
    expect(s.fixedAnnual).toEqual([1000, 1000, 1000, 1100, 1210]);
  });

  it("respects grows_with_opex_growth = false", () => {
    const s = opexSchedule(
      [{ kind: "fixed_annual", label: "x", from_operating_year: 1, to_operating_year: null, annual_amount: 1000, grows_with_opex_growth: false }],
      5,
      { opexGrowthPct: 0.1, growthStartsAfterOperatingYear: 1 },
    );
    expect(s.fixedAnnual).toEqual([1000, 1000, 1000, 1000, 1000]);
  });
});

describe("opexForYear", () => {
  it("prices % lines on that year's revenue", () => {
    const r = opexForYear(
      [
        { kind: "pct_of_revenue", label: "Booking", from_operating_year: 1, to_operating_year: null, pct_of_revenue: 0.15 },
        { kind: "fixed_annual", label: "Ασφάλιση", from_operating_year: 2, to_operating_year: null, annual_amount: 500 },
      ],
      1,
      100000,
      NO_GROWTH,
    );
    expect(r.lines).toEqual([{ label: "Booking", note: null, amount: 15000 }]);
    expect(r.total).toBe(15000);
  });
});
