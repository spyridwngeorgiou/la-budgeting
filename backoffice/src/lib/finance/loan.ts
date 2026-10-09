// Multi-tranche loan amortisation. Same shape as lease.ts / revenuePlan.ts:
// pure, integer cents, nothing stored.
//
// Ported from Λαζαράκη_1.xlsx's Δάνειο sheet, with one correction. The
// workbook's balance recursion subtracts the PREVIOUS row's principal, so
// interest is charged on a stale balance and ~€15.580 is left unamortised
// at month 180. This engine closes to exactly zero: `closing = opening +
// drawdown - principal`, using the CURRENT row's principal, with the final
// month forced to absorb whatever residual remains from rounding.

import { toCents, fromCents } from "./money";
import { addMonths, firstOfMonth, monthKeyOf } from "@/lib/dates";

export interface LoanTranche {
  id: string;
  label: string;
  principal: number;
  interestRate: number; // annual fraction, e.g. 0.035
}

export interface LoanDrawdown {
  month: string; // 'YYYY-MM-01'
  amount: number;
}

export type LoanPhase = "grace" | "amortisation";

export interface LoanMonthRow {
  monthIndex: number; // 1-based
  month: string; // 'YYYY-MM-01'
  trancheId: string;
  openingBalance: number;
  drawdown: number;
  interest: number;
  principal: number;
  payment: number;
  closingBalance: number;
  phase: LoanPhase;
}

export interface CombinedMonthRow {
  monthIndex: number;
  month: string;
  interest: number;
  principal: number;
  payment: number;
  closingBalance: number;
  phase: LoanPhase;
}

export interface LoanScheduleResult {
  rows: LoanMonthRow[]; // one row per tranche per month
  combined: CombinedMonthRow[]; // summed across tranches, one row per month
  pmtByTranche: Record<string, number>;
  totals: {
    totalDrawn: number;
    totalInterest: number;
    totalPrincipal: number;
    totalCost: number;
    graceInterest: number;
    graceInterestPreOpening: number;
    graceInterestPostOpening: number;
    monthlyInstalment: number; // sum of per-tranche PMTs, i.e. what's actually paid after grace
    annualDebtService: number;
    residualAtMaturity: number; // must be 0 after the correction; diagnostic only
  };
}

// Standard annuity payment, in cents: P * r / (1 - (1+r)^-n)
function pmtCents(balanceCents: number, monthlyRate: number, months: number): number {
  if (months <= 0 || balanceCents <= 0) return 0;
  if (monthlyRate === 0) return Math.round(balanceCents / months);
  const factor = monthlyRate / (1 - Math.pow(1 + monthlyRate, -months));
  return Math.round(balanceCents * factor);
}

// Splits a drawdown across tranches pro-rata by principal share, using a
// largest-remainder allocator so the parts always sum to the total exactly.
function allocateCents(totalCents: number, weights: number[]): number[] {
  const weightSum = weights.reduce((s, w) => s + w, 0);
  if (weightSum === 0) return weights.map(() => 0);
  const raw = weights.map((w) => (totalCents * w) / weightSum);
  const floors = raw.map(Math.floor);
  let remainder = totalCents - floors.reduce((s, v) => s + v, 0);
  const order = raw
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++, remainder--) {
    result[order[k].i] += 1;
  }
  return result;
}

export function computeLoanSchedule(
  tranches: LoanTranche[],
  drawdowns: LoanDrawdown[],
  opts: { firstMonth: string; termYears: number; graceYears: number; openingMonth?: string },
): LoanScheduleResult {
  const termMonths = opts.termYears * 12;
  const graceMonths = opts.graceYears * 12;
  const weights = tranches.map((t) => toCents(t.principal));

  // Pre-split every drawdown across tranches once, by month, for lookup.
  const drawdownByTrancheMonth = new Map<string, number>(); // `${trancheId}:${month}`
  for (const d of drawdowns) {
    const parts = allocateCents(toCents(d.amount), weights);
    tranches.forEach((t, i) => {
      const key = `${t.id}:${d.month}`;
      drawdownByTrancheMonth.set(key, (drawdownByTrancheMonth.get(key) ?? 0) + parts[i]);
    });
  }

  const rows: LoanMonthRow[] = [];
  const pmtByTranche: Record<string, number> = {};

  for (const tranche of tranches) {
    const monthlyRate = tranche.interestRate / 12;
    let balance = 0;
    let pmtCentsFrozen: number | null = null;

    for (let k = 1; k <= termMonths; k++) {
      const month = firstOfMonth(addMonths(monthKeyOf(opts.firstMonth), k - 1));
      const drawdown = drawdownByTrancheMonth.get(`${tranche.id}:${month}`) ?? 0;
      const opening = balance;
      const openingWithDrawdown = opening + drawdown;
      const interest = Math.round(openingWithDrawdown * monthlyRate);
      const phase: LoanPhase = k <= graceMonths ? "grace" : "amortisation";

      let principal = 0;
      if (phase === "amortisation") {
        if (pmtCentsFrozen === null || drawdown > 0) {
          // Frozen once, on the balance as it stands at the end of grace
          // (i.e. including this first amortisation month's own drawdown,
          // matching the workbook's INDEX(...,grace*12+1) reference point).
          // A drawdown that arrives after amortisation has started
          // re-annuitises the new balance over the months left; before, the
          // old instalment kept running and the whole late drawdown was
          // dumped into the final month as "rounding residual".
          pmtCentsFrozen = pmtCents(openingWithDrawdown, monthlyRate, termMonths - k + 1);
          pmtByTranche[tranche.id] = fromCents(pmtCentsFrozen);
        }
        principal = Math.min(openingWithDrawdown, Math.max(0, pmtCentsFrozen - interest));
        if (k === termMonths) {
          // Absorb whatever rounding residual remains so the loan always
          // closes to exactly zero -- the correction of the source defect.
          principal = openingWithDrawdown;
        }
      }

      const closing = openingWithDrawdown - principal;
      const payment = interest + principal;

      rows.push({
        monthIndex: k,
        month,
        trancheId: tranche.id,
        openingBalance: fromCents(opening),
        drawdown: fromCents(drawdown),
        interest: fromCents(interest),
        principal: fromCents(principal),
        payment: fromCents(payment),
        closingBalance: fromCents(closing),
        phase,
      });

      balance = closing;
    }
  }

  const combinedMap = new Map<string, CombinedMonthRow>();
  for (const r of rows) {
    const existing = combinedMap.get(r.month);
    if (existing) {
      existing.interest += r.interest;
      existing.principal += r.principal;
      existing.payment += r.payment;
      existing.closingBalance += r.closingBalance;
    } else {
      combinedMap.set(r.month, {
        monthIndex: r.monthIndex,
        month: r.month,
        interest: r.interest,
        principal: r.principal,
        payment: r.payment,
        closingBalance: r.closingBalance,
        phase: r.phase,
      });
    }
  }
  const combined = [...combinedMap.values()].sort((a, b) => a.monthIndex - b.monthIndex);

  const totalDrawn = drawdowns.reduce((s, d) => s + d.amount, 0);
  const totalInterest = combined.reduce((s, r) => s + r.interest, 0);
  const totalPrincipal = combined.reduce((s, r) => s + r.principal, 0);

  const graceRows = combined.filter((r) => r.phase === "grace");
  const graceInterest = graceRows.reduce((s, r) => s + r.interest, 0);
  const openingMonth = opts.openingMonth;
  const graceInterestPreOpening = openingMonth
    ? graceRows.filter((r) => r.month < openingMonth).reduce((s, r) => s + r.interest, 0)
    : 0;
  const graceInterestPostOpening = openingMonth ? graceInterest - graceInterestPreOpening : graceInterest;

  const monthlyInstalment = Object.values(pmtByTranche).reduce((s, v) => s + v, 0);
  const residualAtMaturity = combined.length > 0 ? combined[combined.length - 1].closingBalance : 0;

  return {
    rows,
    combined,
    pmtByTranche,
    totals: {
      totalDrawn,
      totalInterest: Math.round(totalInterest * 100) / 100,
      totalPrincipal: Math.round(totalPrincipal * 100) / 100,
      totalCost: Math.round((totalDrawn + totalInterest) * 100) / 100,
      graceInterest: Math.round(graceInterest * 100) / 100,
      graceInterestPreOpening: Math.round(graceInterestPreOpening * 100) / 100,
      graceInterestPostOpening: Math.round(graceInterestPostOpening * 100) / 100,
      monthlyInstalment: Math.round(monthlyInstalment * 100) / 100,
      annualDebtService: Math.round(monthlyInstalment * 12 * 100) / 100,
      residualAtMaturity: Math.round(residualAtMaturity * 100) / 100,
    },
  };
}

// ── Several loans, each on its own terms ─────────────────────────────────────
// computeLoanSchedule() models ONE programme: tranches share the term, the
// grace period and the drawdown calendar, and every drawdown is split across
// them pro-rata. Right for one facility drawn in parts; wrong for a project
// carrying separate loans -- the project page used to feed it every loan's
// drawdowns summed together plus the FIRST loan's term and grace, so a
// 10-year loan next to a 15-year one was amortised over 15, and each loan
// received a share of the other's drawdowns. This runs each loan on its own
// drawdowns and terms, then sums by calendar month.

export interface LoanInput {
  id: string;
  label: string;
  principal: number;
  interestRate: number;
  termYears: number;
  graceYears: number;
  // When set, amortisation starts this month; grace is the months before it.
  firstAmortisationMonth?: string | null;
  drawdowns: LoanDrawdown[];
}

export interface LoansScheduleResult extends LoanScheduleResult {
  byLoan: Record<string, LoanScheduleResult>;
}

function monthIndexOf(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + (m - 1);
}

// One loan's schedule, starting at its first drawdown; null when nothing is
// (planned to be) drawn yet.
export function computeSingleLoanSchedule(loan: LoanInput, openingMonth?: string): LoanScheduleResult | null {
  const drawdowns = loan.drawdowns
    .filter((d) => d.amount > 0)
    .map((d) => ({ month: firstOfMonth(monthKeyOf(d.month)), amount: d.amount }));
  if (drawdowns.length === 0 || loan.termYears <= 0) return null;
  const firstMonth = drawdowns.map((d) => d.month).sort()[0];
  let graceYears = loan.graceYears;
  if (loan.firstAmortisationMonth) {
    const graceMonths = Math.max(0, monthIndexOf(loan.firstAmortisationMonth) - monthIndexOf(firstMonth));
    graceYears = graceMonths / 12;
  }
  return computeLoanSchedule(
    [{ id: loan.id, label: loan.label, principal: loan.principal, interestRate: loan.interestRate }],
    drawdowns,
    { firstMonth, termYears: loan.termYears, graceYears, openingMonth },
  );
}

export function computeLoansSchedule(
  loans: LoanInput[],
  opts: { openingMonth?: string } = {},
): LoansScheduleResult | null {
  const byLoan: Record<string, LoanScheduleResult> = {};
  for (const loan of loans) {
    const schedule = computeSingleLoanSchedule(loan, opts.openingMonth);
    if (schedule) byLoan[loan.id] = schedule;
  }
  const schedules = Object.values(byLoan);
  if (schedules.length === 0) return null;

  const rows = schedules.flatMap((s) => s.rows);
  const firstIdx = Math.min(...rows.map((r) => monthIndexOf(r.month)));
  const combinedMap = new Map<string, CombinedMonthRow>();
  for (const s of schedules) {
    for (const r of s.combined) {
      const existing = combinedMap.get(r.month);
      if (existing) {
        existing.interest = round2(existing.interest + r.interest);
        existing.principal = round2(existing.principal + r.principal);
        existing.payment = round2(existing.payment + r.payment);
        existing.closingBalance = round2(existing.closingBalance + r.closingBalance);
        if (r.phase === "amortisation") existing.phase = "amortisation";
      } else {
        combinedMap.set(r.month, { ...r, monthIndex: monthIndexOf(r.month) - firstIdx + 1 });
      }
    }
  }
  const combined = [...combinedMap.values()].sort((a, b) => a.monthIndex - b.monthIndex);

  const sum = (pick: (t: LoanScheduleResult["totals"]) => number) =>
    round2(schedules.reduce((acc, s) => acc + pick(s.totals), 0));
  return {
    rows,
    combined,
    pmtByTranche: Object.assign({}, ...schedules.map((s) => s.pmtByTranche)),
    byLoan,
    totals: {
      totalDrawn: sum((t) => t.totalDrawn),
      totalInterest: sum((t) => t.totalInterest),
      totalPrincipal: sum((t) => t.totalPrincipal),
      totalCost: sum((t) => t.totalCost),
      graceInterest: sum((t) => t.graceInterest),
      graceInterestPreOpening: sum((t) => t.graceInterestPreOpening),
      graceInterestPostOpening: sum((t) => t.graceInterestPostOpening),
      monthlyInstalment: sum((t) => t.monthlyInstalment),
      annualDebtService: sum((t) => t.annualDebtService),
      residualAtMaturity: sum((t) => t.residualAtMaturity),
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
