// One project's investment model: lease, loans, scenarios and revenue plans
// loaded once, then every scenario computed by the same pure function. The
// project page, the scenario comparison and «Στείλε στο ταμείο» all read
// this, so they can never disagree on a number.
//
//   loadScenarioInputs()        I/O: everything a scenario needs, as plain data
//   computeScenarioFromInputs() pure: one scenario's operating year and cash flow
//   loadProjectModel()          both, for every (or only the base) scenario
//   loadProjectFlows()          I/O: the ledger + forecast flows of development.ts
//
// The engines stay where they were (revenuePlan.ts, lease.ts, loan.ts,
// projectCashflow.ts, opex.ts); this file only wires them.

import type { createClient } from "@/lib/supabase/server";
import { computeRevenuePlan, type Assumption, type RoomType } from "./revenuePlan";
import { computeProjectCashflow, type CashYearRow } from "./projectCashflow";
import { computeLeaseSchedule, type LeaseSchedule } from "./lease";
import { computeLoansSchedule, type LoansScheduleResult } from "./loan";
import { indexedTermsOf, leaseTermsFromRow, loanInputFromRow, type LeaseRowLike, type LoanRowLike } from "./scheduleRows";
import { opexForYear, opexSchedule, type OpexLineInput } from "./opex";
import { flowFromExpected, flowFromTransaction, type DatedFlow } from "./development";
import type { BusinessLine, LiabilityState, OpexLineKind } from "@/lib/domain/enums";

type Supabase = Awaited<ReturnType<typeof createClient>>;

const round2 = (n: number) => Math.round(n * 100) / 100;

export const DEFAULT_HORIZON_YEARS = 20;

// ── Inputs ────────────────────────────────────────────────────────────────────

// Row shapes as the database returns them (numeric -> number), so pages
// can pass them straight to their forms.
export interface OpexLineRow extends OpexLineInput {
  id: string;
  kind: OpexLineKind;
  sort_order?: number | null;
  annual_amount?: number | null;
  headcount?: number | null;
  monthly_wage?: number | null;
  salaries_per_year?: number | null;
  employer_contribution_pct?: number | null;
  premium_pct?: number | null;
  months_active?: number | null;
  pct_of_revenue?: number | null;
}

export interface ScenarioRow {
  id: string;
  name: string;
  is_base: boolean;
  sort_order: number;
  flat_annual_revenue: number | null;
  revenue_plan_id: string | null;
  adr_multiplier: number;
  revenue_growth_pct: number;
  opex_growth_pct: number;
  growth_starts_after_operating_year: number;
  discount_rate_pct: number;
  dscr_covenant_min: number;
  notes: string | null;
  opex_lines: OpexLineRow[] | null;
}

export interface PlanInput {
  id: string;
  start_year: number;
  roomTypes: RoomType[];
  assumptions: Assumption[];
}

export interface LeaseRow extends LeaseRowLike {
  id: string;
  notes: string | null;
}

export interface LoanRow extends LoanRowLike {
  principal: number;
  interest_rate: number;
  state: LiabilityState;
  notes: string | null;
}

export interface ScenarioInputs {
  project: { id: string; opening_date: string | null; business_model: string | null; business_line: BusinessLine | null };
  lease: LeaseRow | null;
  leaseSchedule: LeaseSchedule | null;
  loans: LoanRow[];
  loanSchedule: LoansScheduleResult | null;
  scenarios: ScenarioRow[];
  plans: Record<string, PlanInput>;
}

const LEASE_COLUMNS =
  "id, kind, term_years, lease_start_month, first_payment_month, notes, lease_indexed_terms!lease_indexed_terms_lease_id_fkey(base_monthly_amount, stamp_duty_pct, stamp_duty_surcharge_pct, escalation_pct, escalation_first_year, stepups_escalate, stepups_stampable, lease_step_ups(from_lease_year, monthly_amount))";
const LOAN_COLUMNS =
  "id, label, principal, interest_rate, term_years, grace_years, first_amortisation_month, state, notes, loan_drawdowns(scheduled_month, amount, actual_date, actual_amount)";
const SCENARIO_COLUMNS =
  "id, name, is_base, sort_order, flat_annual_revenue, revenue_plan_id, adr_multiplier, revenue_growth_pct, opex_growth_pct, growth_starts_after_operating_year, discount_rate_pct, dscr_covenant_min, notes, opex_lines(id, kind, label, sort_order, annual_amount, from_operating_year, to_operating_year, grows_with_opex_growth, note, headcount, monthly_wage, salaries_per_year, employer_contribution_pct, premium_pct, months_active, pct_of_revenue)";

export function openingMonthOf(openingDate: string | null): string | undefined {
  return openingDate ? `${String(openingDate).slice(0, 7)}-01` : undefined;
}

export function leaseScheduleOf(lease: LeaseRowLike | null): LeaseSchedule | null {
  const raw = indexedTermsOf(lease);
  if (!lease || !raw) return null;
  const { terms, stepUps } = leaseTermsFromRow(lease, raw);
  return computeLeaseSchedule(terms, stepUps);
}

export async function loadScenarioInputs(
  supabase: Supabase,
  projectId: string,
  opts: { baseOnly?: boolean } = {},
): Promise<ScenarioInputs | null> {
  let scenarioQuery = supabase.from("project_scenarios").select(SCENARIO_COLUMNS).eq("project_id", projectId).order("sort_order");
  if (opts.baseOnly) scenarioQuery = scenarioQuery.eq("is_base", true);
  const [{ data: project }, { data: lease }, { data: loans }, { data: scenarios, error }] = await Promise.all([
    supabase.from("projects").select("id, opening_date, business_model, business_line").eq("id", projectId).maybeSingle(),
    supabase.from("project_leases").select(LEASE_COLUMNS).eq("project_id", projectId).maybeSingle(),
    supabase.from("loans").select(LOAN_COLUMNS).eq("project_id", projectId),
    scenarioQuery,
  ]);
  if (error) throw error;
  if (!project) return null;

  const planIds = [...new Set((scenarios ?? []).map((s) => s.revenue_plan_id).filter((x): x is string => !!x))];
  const { data: planRows } = planIds.length
    ? await supabase
        .from("revenue_plans")
        .select("id, start_year, revenue_plan_room_types(id, name, unit_count, revenue_plan_assumptions(year_number, month_number, occupancy_pct, adr))")
        .in("id", planIds)
    : { data: [] };
  const plans: Record<string, PlanInput> = {};
  for (const p of planRows ?? []) {
    plans[p.id] = {
      id: p.id,
      start_year: p.start_year,
      roomTypes: (p.revenue_plan_room_types ?? []).map((rt) => ({ id: rt.id, name: rt.name, unitCount: rt.unit_count })),
      assumptions: (p.revenue_plan_room_types ?? []).flatMap((rt) =>
        (rt.revenue_plan_assumptions ?? []).map((a) => ({
          roomTypeId: rt.id,
          yearNumber: a.year_number,
          monthNumber: a.month_number,
          occupancyPct: Number(a.occupancy_pct),
          adr: Number(a.adr),
        })),
      ),
    };
  }

  const loanRows = (loans ?? []) as LoanRow[];
  const leaseRow = (lease ?? null) as LeaseRow | null;
  return {
    project,
    lease: leaseRow,
    leaseSchedule: leaseScheduleOf(leaseRow),
    loans: loanRows,
    loanSchedule: computeLoansSchedule(loanRows.map(loanInputFromRow), { openingMonth: openingMonthOf(project.opening_date) }),
    scenarios: (scenarios ?? []) as ScenarioRow[],
    plans,
  };
}

// ── Pure computation ──────────────────────────────────────────────────────────

// The operating year the ΛΕΙΤΟΥΡΓΙΑ block shows: the first full calendar
// year of operation, counted from the revenue plan's start year. Opening in
// January makes the opening year itself full; any later month pushes it to
// the next. (Until now this was hard-coded to year 2.)
export function referenceOperatingYear(openingDate: string | null, baseYear: number): number {
  if (!openingDate) return 1;
  const [y, m] = String(openingDate).split("-").map(Number);
  return Math.max(1, y - baseYear + 1 + (m > 1 ? 1 : 0));
}

export interface ScenarioResult {
  scenarioId: string;
  name: string;
  isBase: boolean;
  referenceYear: number; // operating year, 1-based
  referenceCalendarYear: number | null;
  revenue: number;
  opexLines: { label: string; note: string | null; amount: number }[];
  opexTotal: number;
  annualRent: number;
  operatingResult: number;
  hasOperation: boolean;
  cashflow: ReturnType<typeof computeProjectCashflow> | null;
}

export function computeScenarioFromInputs(inputs: ScenarioInputs, scenario: ScenarioRow): ScenarioResult {
  const lines = (scenario.opex_lines ?? []).slice().sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
  const growth = {
    opexGrowthPct: Number(scenario.opex_growth_pct ?? 0),
    growthStartsAfterOperatingYear: Number(scenario.growth_starts_after_operating_year ?? 3),
  };
  const revenueGrowthPct = Number(scenario.revenue_growth_pct ?? 0);
  const adr = Number(scenario.adr_multiplier ?? 1) || 1;
  const openingDate = inputs.project.opening_date;
  const lease = inputs.lease;

  // Revenue per operating year, Jan..Dec. The ADR dial scales a room grid
  // (revenue = nights × ADR); a flat figure is spread evenly over the year.
  const plan = scenario.revenue_plan_id ? inputs.plans[scenario.revenue_plan_id] : undefined;
  let baseYear: number | null = null;
  let monthly: number[][] = [];
  if (plan) {
    baseYear = plan.start_year;
    monthly = computeRevenuePlan(plan.start_year, plan.roomTypes, plan.assumptions).yearTotals.map((y) =>
      y.monthlyRevenue.map((v) => round2(v * adr)),
    );
  } else if (Number(scenario.flat_annual_revenue ?? 0) > 0) {
    const flat = Number(scenario.flat_annual_revenue);
    baseYear = openingDate
      ? Number(String(openingDate).slice(0, 4))
      : lease?.lease_start_month
        ? Number(String(lease.lease_start_month).slice(0, 4))
        : null;
    monthly = [Array.from({ length: 12 }, () => round2(flat / 12))];
  }

  const annualOf = (opYear: number): number => {
    if (monthly.length === 0) return 0;
    if (opYear <= monthly.length) return round2(monthly[opYear - 1].reduce((s, v) => s + v, 0));
    const last = monthly[monthly.length - 1].reduce((s, v) => s + v, 0);
    const years = Math.max(0, opYear - Math.max(monthly.length, growth.growthStartsAfterOperatingYear));
    return round2(last * Math.pow(1 + revenueGrowthPct, years));
  };

  const referenceYear = baseYear != null ? referenceOperatingYear(openingDate, baseYear) : 1;
  const referenceCalendarYear = baseYear != null ? baseYear + referenceYear - 1 : null;

  let cashflow: ScenarioResult["cashflow"] = null;
  if (baseYear != null && monthly.length > 0) {
    const openingMonth = openingMonthOf(openingDate) ?? `${baseYear}-01-01`;
    const horizonYears = Number(lease?.term_years ?? DEFAULT_HORIZON_YEARS);
    const span = Math.max(monthly.length, Number(openingMonth.slice(0, 4)) - baseYear + horizonYears + 1);
    const opex = opexSchedule(lines, span, growth);
    cashflow = computeProjectCashflow({
      openingMonth,
      baseYear,
      revenueMonthlyByOperatingYear: monthly,
      opexAnnualByOperatingYear: opex.fixedAnnual,
      opexPctOfRevenueByOperatingYear: opex.pctOfRevenue,
      revenueGrowthPct,
      opexGrowthPct: growth.opexGrowthPct,
      growthStartsAfterOperatingYear: growth.growthStartsAfterOperatingYear,
      leaseSchedule: inputs.leaseSchedule,
      leaseStartMonth: lease?.lease_start_month ?? null,
      leaseFirstPaymentMonth: lease?.first_payment_month ?? lease?.lease_start_month ?? null,
      loanSchedule: inputs.loanSchedule,
      horizonYears,
      discountRatePct: Number(scenario.discount_rate_pct ?? 0),
      dscrCovenantMin: Number(scenario.dscr_covenant_min ?? 1.2),
    });
  }

  // The reference year as the cash flow saw it (one source for the page);
  // without a cash flow, the plain annual figures.
  const yearRow: CashYearRow | undefined = cashflow?.years.find((y) => y.calendarYear === referenceCalendarYear);
  const revenue = yearRow?.revenue ?? annualOf(referenceYear);
  const breakdown = opexForYear(lines, referenceYear, revenue, growth);
  const opexTotal = yearRow?.opex ?? breakdown.total;
  const annualRent =
    yearRow?.rent ??
    inputs.leaseSchedule?.rows.find((r) => r.leaseYear === referenceYear)?.annualAmount ??
    inputs.leaseSchedule?.rows[0]?.annualAmount ??
    0;

  return {
    scenarioId: scenario.id,
    name: scenario.name,
    isBase: scenario.is_base,
    referenceYear,
    referenceCalendarYear,
    revenue,
    opexLines: breakdown.lines,
    opexTotal,
    annualRent,
    operatingResult: round2(revenue - opexTotal - annualRent),
    hasOperation: revenue > 0,
    cashflow,
  };
}

export async function loadProjectModel(supabase: Supabase, projectId: string, opts: { baseOnly?: boolean } = {}) {
  const inputs = await loadScenarioInputs(supabase, projectId, opts);
  if (!inputs) return null;
  return {
    inputs,
    results: inputs.scenarios.map((scenario) => ({ scenario, result: computeScenarioFromInputs(inputs, scenario) })),
  };
}

// ── Ledger flows (development.ts) ─────────────────────────────────────────────

const FLOW_LIMIT = 1000; // PostgREST's page; `truncated` says when it was hit

export async function loadProjectFlows(
  supabase: Supabase,
  projectId: string,
  today: string,
): Promise<{ flows: DatedFlow[]; truncated: boolean }> {
  const [{ data: txs, error }, { data: expected }] = await Promise.all([
    supabase
      .from("transactions")
      .select("direction, status, tx_date, due_date, paid_on, gross_amount, net_amount, vat_amount, withholding_amount, loan_id, categories(cost_treatment)")
      .eq("project_id", projectId)
      .neq("status", "cancelled")
      .limit(FLOW_LIMIT),
    supabase
      .from("expected_income")
      .select("direction, amount, expected_month, probability, certainty")
      .eq("project_id", projectId)
      .eq("status", "expected"),
  ]);
  if (error) throw error;
  const flows: DatedFlow[] = [];
  for (const t of txs ?? []) {
    const category = Array.isArray(t.categories) ? t.categories[0] : t.categories;
    const f = flowFromTransaction({ ...t, treatment: category?.cost_treatment ?? null }, today);
    if (f) flows.push(f);
  }
  for (const e of expected ?? []) {
    const f = flowFromExpected(e, today);
    if (f) flows.push(f);
  }
  return { flows, truncated: (txs ?? []).length >= FLOW_LIMIT };
}
