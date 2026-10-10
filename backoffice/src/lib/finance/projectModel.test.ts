import { describe, expect, it } from "vitest";
import { computeScenarioFromInputs, referenceOperatingYear, type ScenarioInputs, type ScenarioRow } from "./projectModel";

function scenario(patch: Partial<ScenarioRow> = {}): ScenarioRow {
  return {
    id: "s1",
    name: "Βάση",
    is_base: true,
    sort_order: 0,
    flat_annual_revenue: null,
    revenue_plan_id: null,
    adr_multiplier: 1,
    revenue_growth_pct: 0,
    opex_growth_pct: 0,
    growth_starts_after_operating_year: 3,
    discount_rate_pct: 0.1,
    dscr_covenant_min: 1.2,
    notes: null,
    opex_lines: [],
    ...patch,
  };
}

function inputs(patch: Partial<ScenarioInputs> = {}): ScenarioInputs {
  return {
    project: { id: "p1", opening_date: "2027-01-01", business_model: "hotel_lease", business_line: "hospitality" },
    lease: null,
    leaseSchedule: null,
    loans: [],
    loanSchedule: null,
    scenarios: [],
    plans: {},
    ...patch,
  };
}

// 10 rooms, 50% every month at 100 € -> one plan year
const plan = {
  id: "plan1",
  start_year: 2027,
  roomTypes: [{ id: "rt", name: "Δίκλινο", unitCount: 10 }],
  assumptions: Array.from({ length: 12 }, (_, i) => ({ roomTypeId: "rt", yearNumber: 1, monthNumber: i + 1, occupancyPct: 0.5, adr: 100 })),
};

describe("referenceOperatingYear", () => {
  it("is the first full calendar year of operation", () => {
    expect(referenceOperatingYear("2027-01-01", 2027)).toBe(1);
    expect(referenceOperatingYear("2027-08-01", 2027)).toBe(2);
    expect(referenceOperatingYear("2028-03-01", 2027)).toBe(3);
    expect(referenceOperatingYear(null, 2027)).toBe(1);
  });
});

describe("computeScenarioFromInputs", () => {
  it("scales a room grid by the ADR multiplier", () => {
    const base = computeScenarioFromInputs(inputs({ plans: { plan1: plan } }), scenario({ revenue_plan_id: "plan1" }));
    const up = computeScenarioFromInputs(inputs({ plans: { plan1: plan } }), scenario({ revenue_plan_id: "plan1", adr_multiplier: 1.1 }));
    expect(base.revenue).toBeGreaterThan(180000);
    expect(up.revenue / base.revenue).toBeCloseTo(1.1, 3);
  });

  it("shows the first full year, not a hard-coded year 2", () => {
    const r = computeScenarioFromInputs(inputs({ plans: { plan1: plan } }), scenario({ revenue_plan_id: "plan1" }));
    expect(r.referenceYear).toBe(1);
    expect(r.referenceCalendarYear).toBe(2027);
  });

  it("computes NPV without a lease, for a flat annual revenue", () => {
    const r = computeScenarioFromInputs(inputs(), scenario({ flat_annual_revenue: 120000 }));
    expect(r.cashflow).not.toBeNull();
    expect(r.cashflow!.years).toHaveLength(20);
    expect(r.cashflow!.kpis.npv).toBeGreaterThan(0);
    expect(r.revenue).toBe(120000);
  });

  it("counts payroll, % of revenue and open-ended lines in every year", () => {
    const r = computeScenarioFromInputs(
      inputs(),
      scenario({
        flat_annual_revenue: 120000,
        opex_lines: [
          {
            id: "o1", kind: "payroll", label: "Προσωπικό", from_operating_year: 1, to_operating_year: null,
            headcount: 1, monthly_wage: 1000, salaries_per_year: 14, employer_contribution_pct: 0, premium_pct: 0, months_active: 12,
          },
          { id: "o2", kind: "pct_of_revenue", label: "Booking", from_operating_year: 1, to_operating_year: null, pct_of_revenue: 0.1 },
        ],
      }),
    );
    expect(r.opexTotal).toBeCloseTo(14000 + 12000, 0);
    expect(r.operatingResult).toBeCloseTo(120000 - 26000, 0);
    const last = r.cashflow!.years[r.cashflow!.years.length - 1];
    expect(last.opex).toBeCloseTo(26000, 0);
  });

  it("puts the scenario month by month for «Στείλε στο ταμείο»", () => {
    const r = computeScenarioFromInputs(inputs(), scenario({ flat_annual_revenue: 120000 }));
    const jan = r.cashflow!.months.find((m) => m.month === "2027-01-01");
    expect(jan?.revenue).toBe(10000);
  });
});
