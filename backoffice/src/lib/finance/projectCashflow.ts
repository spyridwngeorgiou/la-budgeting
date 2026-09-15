// Annual project cash flow: revenue − opex − rent − debt service, with DSCR
// and NPV. Assembles revenuePlan.ts + lease.ts + loan.ts; owns the one thing
// these models reliably get wrong -- the operating-year-to-calendar-year
// mapping, including a partial opening year (Λαζαράκη's 2027 is five months
// of operating year 1: Aug-Dec, with only four of those months carrying
// rent since the first payment is September).
//
// Built as a single internal monthly loop rather than a separate calendar
// module: every month in range gets its own revenue/opex/rent/debt-service
// looked up or extrapolated, then folded into calendar years. That is what
// makes the stub year, the leap-year day count already baked into the
// revenue plan, and the lease's step-ups all "just filters" instead of
// special-cased branches.
//
// Two small, explainable divergences from Λαζαράκη_1.xlsx's own cash flow,
// both in the direction of being MORE correct: real calendar days (2028 is
// leap, the workbook hardcoded a 28-day February, ~€1.060 more revenue that
// year) and rent escalating on the lease's real anniversary month rather
// than uniformly per calendar year (see the note on rentForMonth below).

import { fromCents, toCents } from "./money";
import type { LeaseSchedule } from "./lease";
import type { LoanScheduleResult } from "./loan";

export interface CashYearRow {
  calendarYear: number;
  revenue: number;
  opex: number;
  rent: number;
  operatingResult: number;
  interest: number;
  principal: number;
  debtService: number;
  netFlow: number;
  cumulative: number;
  dscr: number | null;
}

export interface CashflowKpis {
  minDscr: { calendarYear: number; value: number } | null;
  firstAmortisationYearDscr: { calendarYear: number; value: number } | null;
  covenantBreaches: { calendarYear: number; dscr: number }[];
  // NPV basis is always stated explicitly: this discounts netFlow, i.e. the
  // flow AFTER debt service and WITHOUT the capex outflow, the pledged
  // collateral, or amounts already spent -- exactly what the source
  // workbook computes, not a general project NPV. Never label it just "NPV".
  npv: number;
  npvBasis: "post_debt_service_excl_capex";
  cumulativeTotal: number;
}

export interface CashflowInputs {
  openingMonth: string; // 'YYYY-MM-01' -- months before this carry no revenue/opex, whatever calendar year they fall in
  baseYear: number; // the revenue plan's own start_year: year_number 1 = this calendar year, laid out Jan-Dec
  revenueMonthlyByOperatingYear: number[][]; // [yearIndex][0=Jan..11=Dec], from RevenuePlanResult.yearTotals[].monthlyRevenue
  opexAnnualByOperatingYear: number[]; // index 0 = baseYear, spread evenly across that calendar year's 12 months
  revenueGrowthPct: number;
  opexGrowthPct: number;
  growthStartsAfterOperatingYear: number;
  leaseSchedule: LeaseSchedule | null;
  leaseStartMonth: string | null; // 'YYYY-MM-01'
  leaseFirstPaymentMonth: string | null;
  loanSchedule: LoanScheduleResult | null;
  horizonYears: number;
  discountRatePct: number;
  dscrCovenantMin: number;
}

function parseMonth(m: string): number {
  const [y, mo] = m.split("-").map(Number);
  return y * 12 + (mo - 1);
}
function monthYear(index: number): number {
  return Math.floor(index / 12);
}

export function computeProjectCashflow(inputs: CashflowInputs): {
  years: CashYearRow[];
  kpis: CashflowKpis;
} {
  const openingIdx = parseMonth(inputs.openingMonth);
  const leaseStartIdx = inputs.leaseStartMonth ? parseMonth(inputs.leaseStartMonth) : null;
  const leaseFirstPayIdx = inputs.leaseFirstPaymentMonth ? parseMonth(inputs.leaseFirstPaymentMonth) : null;

  const loanMonthly = new Map<string, { interest: number; principal: number }>();
  if (inputs.loanSchedule) {
    for (const r of inputs.loanSchedule.combined) {
      loanMonthly.set(r.month, { interest: r.interest, principal: r.principal });
    }
  }
  const loanMonthIndices = [...loanMonthly.keys()].map((m) => parseMonth(m));

  const startIdx = Math.min(openingIdx, leaseStartIdx ?? openingIdx, ...(loanMonthIndices.length ? loanMonthIndices : [openingIdx]));
  const startCalendarYear = monthYear(startIdx);
  const endCalendarYear = monthYear(openingIdx) + inputs.horizonYears - 1;

  const monthsRevenue = inputs.revenueMonthlyByOperatingYear;

  // The revenue plan is calendar-anchored (year_number 1 = baseYear, laid
  // out Jan-Dec as a seasonality curve) -- NOT "months since opening". A
  // project that opens mid-year still uses year_number 1's Jan-Dec curve for
  // that calendar year; only the months before opening are gated to zero
  // separately, by the caller checking calendarIdx >= openingIdx.
  function revenueForYearMonth(yearIndex: number, calendarMonth: number): number {
    if (yearIndex < 0) return 0;
    if (yearIndex < monthsRevenue.length) return monthsRevenue[yearIndex]?.[calendarMonth] ?? 0;
    const lastYearRow = monthsRevenue[monthsRevenue.length - 1];
    const base = lastYearRow?.[calendarMonth] ?? 0;
    const growthYears = Math.max(0, yearIndex + 1 - Math.max(monthsRevenue.length, inputs.growthStartsAfterOperatingYear));
    return fromCents(Math.round(toCents(base) * Math.pow(1 + inputs.revenueGrowthPct, growthYears)));
  }

  function opexForYearMonth(yearIndex: number): number {
    if (yearIndex < 0) return 0;
    const annual =
      yearIndex < inputs.opexAnnualByOperatingYear.length
        ? inputs.opexAnnualByOperatingYear[yearIndex]
        : (() => {
            const lastAnnual = inputs.opexAnnualByOperatingYear[inputs.opexAnnualByOperatingYear.length - 1] ?? 0;
            const growthYears = Math.max(
              0,
              yearIndex + 1 - Math.max(inputs.opexAnnualByOperatingYear.length, inputs.growthStartsAfterOperatingYear),
            );
            return fromCents(Math.round(toCents(lastAnnual) * Math.pow(1 + inputs.opexGrowthPct, growthYears)));
          })();
    return annual / 12;
  }

  // Deliberately anniversary-based, not calendar-year-based: rent escalates
  // on the lease's own anniversary (e.g. every August), so a calendar year
  // straddling that date pays two different monthly rates within it. The
  // source workbook's cash-flow sheet instead applies one escalation
  // exponent per calendar column for the whole year, which is simpler but
  // wrong the moment a lease doesn't start in January -- it is the same
  // simplification its own Λειτουργία sheet makes. This produces a small,
  // explainable divergence from the workbook (a few thousand euros a year
  // around the anniversary), in the direction of being MORE correct, not less.
  function rentForMonth(calendarMonthIdx: number): number {
    if (!inputs.leaseSchedule || leaseStartIdx === null) return 0;
    if (leaseFirstPayIdx !== null && calendarMonthIdx < leaseFirstPayIdx) return 0;
    const leaseYear = monthYear(calendarMonthIdx - leaseStartIdx) + 1;
    const row = inputs.leaseSchedule.rows.find((r) => r.leaseYear === leaseYear);
    return row ? row.monthlyAmount : 0;
  }

  const years: CashYearRow[] = [];
  for (let cy = startCalendarYear; cy <= endCalendarYear; cy++) {
    let revenue = 0;
    let opex = 0;
    let rent = 0;
    let interest = 0;
    let principal = 0;

    const yearIndex = cy - inputs.baseYear; // 0 = baseYear itself
    for (let m = 0; m < 12; m++) {
      const calendarIdx = cy * 12 + m;
      if (calendarIdx >= openingIdx) {
        revenue += revenueForYearMonth(yearIndex, m);
        opex += opexForYearMonth(yearIndex);
      }
      rent += rentForMonth(calendarIdx);
      const monthKey = `${cy}-${String(m + 1).padStart(2, "0")}-01`;
      const debt = loanMonthly.get(monthKey);
      if (debt) {
        interest += debt.interest;
        principal += debt.principal;
      }
    }

    const operatingResult = revenue - opex - rent;
    const debtService = interest + principal;
    const netFlow = operatingResult - debtService;
    const dscr = debtService > 0 ? operatingResult / debtService : null;

    years.push({
      calendarYear: cy,
      revenue: round2(revenue),
      opex: round2(opex),
      rent: round2(rent),
      operatingResult: round2(operatingResult),
      interest: round2(interest),
      principal: round2(principal),
      debtService: round2(debtService),
      netFlow: round2(netFlow),
      cumulative: 0, // filled below
      dscr: dscr == null ? null : Math.round(dscr * 100) / 100,
    });
  }

  let running = 0;
  for (const y of years) {
    running += y.netFlow;
    y.cumulative = round2(running);
  }

  const withDscr = years.filter((y) => y.dscr != null) as (CashYearRow & { dscr: number })[];
  const minDscrRow = withDscr.length > 0 ? withDscr.reduce((a, b) => (b.dscr < a.dscr ? b : a)) : null;
  const firstAmortisationRow = years.find((y) => y.principal > 0) ?? null;
  const covenantBreaches = withDscr
    .filter((y) => y.dscr < inputs.dscrCovenantMin)
    .map((y) => ({ calendarYear: y.calendarYear, dscr: y.dscr }));

  // NPV(rate, flow_1..flow_n): Excel's convention discounts the FIRST value
  // by (1+rate)^1, matching the workbook's own NPV(9%, B11:Y11).
  let npvCents = 0;
  years.forEach((y, i) => {
    npvCents += toCents(y.netFlow) / Math.pow(1 + inputs.discountRatePct, i + 1);
  });

  return {
    years,
    kpis: {
      minDscr: minDscrRow ? { calendarYear: minDscrRow.calendarYear, value: minDscrRow.dscr } : null,
      firstAmortisationYearDscr:
        firstAmortisationRow && firstAmortisationRow.dscr != null
          ? { calendarYear: firstAmortisationRow.calendarYear, value: firstAmortisationRow.dscr }
          : null,
      covenantBreaches,
      npv: fromCents(Math.round(npvCents)),
      npvBasis: "post_debt_service_excl_capex",
      cumulativeTotal: years.length > 0 ? years[years.length - 1].cumulative : 0,
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
