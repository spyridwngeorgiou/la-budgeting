import type { SupabaseClient } from "@supabase/supabase-js";
import { computeRevenuePlan } from "./revenuePlan";
import { computeProjectCashflow } from "./projectCashflow";
import type { computeLeaseSchedule } from "./lease";
import type { computeLoanSchedule } from "./loan";

type OpexLine = {
  annual_amount: number | string | null;
  from_operating_year: number;
  to_operating_year: number | null;
};

type ScenarioRow = {
  id: string;
  name: string;
  flat_annual_revenue: number | string | null;
  revenue_plan_id: string | null;
  revenue_growth_pct: number | string | null;
  opex_growth_pct: number | string | null;
  growth_starts_after_operating_year: number | null;
  discount_rate_pct: number | string | null;
  dscr_covenant_min: number | string | null;
  opex_lines?: OpexLine[] | null;
};

export type ScenarioCashflowContext = {
  leaseSchedule: ReturnType<typeof computeLeaseSchedule> | null;
  leaseStartMonth: string | null;
  leaseTermYears: number | null;
  loanSchedule: ReturnType<typeof computeLoanSchedule> | null;
  openingDate: string | null;
};

// The Λειτουργία → Ταμειακή Ροή derivation shared by the single-scenario
// project page and the side-by-side scenario comparison -- kept as one
// function so the two views can never quietly disagree on how a scenario's
// numbers are computed.
export async function computeScenarioResult(
  supabase: SupabaseClient,
  scenario: ScenarioRow,
  ctx: ScenarioCashflowContext,
) {
  const opexLines = scenario.opex_lines ?? [];
  const firstYearRent = ctx.leaseSchedule?.rows[0];

  let revenue = Number(scenario.flat_annual_revenue ?? 0);
  let opexTotal = opexLines
    .filter((l) => l.from_operating_year === 1 && (l.to_operating_year == null || l.to_operating_year >= 1))
    .reduce((s, l) => s + Number(l.annual_amount ?? 0), 0);
  let annualRent = firstYearRent?.annualAmount ?? 0;
  let cashflow: ReturnType<typeof computeProjectCashflow> | null = null;

  if (scenario.revenue_plan_id) {
    const { data: plan } = await supabase
      .from("revenue_plans")
      .select(
        "start_year, revenue_plan_room_types(id, name, unit_count, revenue_plan_assumptions(year_number, month_number, occupancy_pct, adr))",
      )
      .eq("id", scenario.revenue_plan_id)
      .maybeSingle();

    if (plan) {
      const roomTypes = (plan.revenue_plan_room_types ?? []).map((rt) => ({
        id: rt.id,
        name: rt.name,
        unitCount: rt.unit_count,
      }));
      const assumptions = (plan.revenue_plan_room_types ?? []).flatMap((rt) =>
        (rt.revenue_plan_assumptions ?? []).map((a) => ({
          roomTypeId: rt.id,
          yearNumber: a.year_number,
          monthNumber: a.month_number,
          occupancyPct: a.occupancy_pct,
          adr: a.adr,
        })),
      );
      const revenuePlanResult = computeRevenuePlan(plan.start_year, roomTypes, assumptions);

      const headlineYearIdx = Math.min(1, revenuePlanResult.yearTotals.length - 1);
      const headlineYear = revenuePlanResult.yearTotals[headlineYearIdx];
      const headlineYearNumber = headlineYearIdx + 1;
      revenue = headlineYear?.annualRevenue ?? 0;
      opexTotal = opexLines
        .filter(
          (l) =>
            l.from_operating_year <= headlineYearNumber &&
            (l.to_operating_year == null || l.to_operating_year >= headlineYearNumber),
        )
        .reduce((s, l) => s + Number(l.annual_amount ?? 0), 0);
      const headlineLeaseRow = ctx.leaseSchedule?.rows.find((r) => r.leaseYear === headlineYearNumber);
      annualRent = headlineLeaseRow?.annualAmount ?? annualRent;

      if (ctx.leaseSchedule && ctx.openingDate) {
        const openingMonth = `${String(ctx.openingDate).slice(0, 7)}-01`;
        const opexAnnualByOperatingYear = opexLines
          .filter((l) => l.from_operating_year === l.to_operating_year)
          .sort((a, b) => a.from_operating_year - b.from_operating_year)
          .map((l) => Number(l.annual_amount ?? 0));

        cashflow = computeProjectCashflow({
          openingMonth,
          baseYear: plan.start_year,
          revenueMonthlyByOperatingYear: revenuePlanResult.yearTotals.map((y) => y.monthlyRevenue),
          opexAnnualByOperatingYear:
            opexAnnualByOperatingYear.length > 0 ? opexAnnualByOperatingYear : [opexTotal],
          revenueGrowthPct: Number(scenario.revenue_growth_pct ?? 0),
          opexGrowthPct: Number(scenario.opex_growth_pct ?? 0),
          growthStartsAfterOperatingYear: Number(scenario.growth_starts_after_operating_year ?? 3),
          leaseSchedule: ctx.leaseSchedule,
          leaseStartMonth: ctx.leaseStartMonth,
          leaseFirstPaymentMonth: ctx.leaseStartMonth,
          loanSchedule: ctx.loanSchedule,
          horizonYears: Number(ctx.leaseTermYears ?? 23),
          discountRatePct: Number(scenario.discount_rate_pct ?? 0.09),
          dscrCovenantMin: Number(scenario.dscr_covenant_min ?? 1.2),
        });
      }
    }
  }

  const operatingResult = revenue - opexTotal - annualRent;
  return {
    scenarioId: scenario.id,
    name: scenario.name,
    revenue,
    opexTotal,
    annualRent,
    operatingResult,
    hasOperation: revenue > 0,
    cashflow,
  };
}
