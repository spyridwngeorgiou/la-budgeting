// Lease rent schedules. The first of the model engines, following the shape
// set by revenuePlan.ts: pure functions, no I/O, no Date.now(), everything
// derived and nothing stored.
//
// Ported from Λαζαράκη_1.xlsx's Παραδοχές/Λειτουργία sheets, verified against
// its own outputs: 6.000 base × (1 + 3% × 1,20 ΟΓΑ) = 6.216/μήνα, ×12 = 74.592
// for lease year 1, then compounding 3,5% a year with flat step-ups from lease
// years 11 and 16.

import { toCents, fromCents } from "./money";
import { addMonths, firstOfMonth, monthKeyOf } from "@/lib/dates";

export interface LeaseTerms {
  baseMonthlyAmount: number;
  stampDutyPct: number; // 0.03
  stampDutySurchargePct: number; // 0.20 (ΟΓΑ, charged on the stamp itself)
  escalationPct: number; // 0.035, compounds per lease year
  escalationFirstYear: number; // escalation starts applying from this lease year
  termYears: number;
  stepUpsEscalate: boolean;
  stepUpsStampable: boolean;
}

export interface LeaseStepUp {
  fromLeaseYear: number;
  monthlyAmount: number;
}

export interface LeaseYearRow {
  leaseYear: number;
  monthlyAmount: number;
  annualAmount: number;
  stepUpPortion: number; // how much of the monthly figure comes from step-ups
}

export interface LeaseSchedule {
  effectiveBaseMonthly: number; // base including stamp duty
  rows: LeaseYearRow[];
  totalAmount: number;
  diagnostics: string[];
}

// Stamp duty is charged on the rent, and the ΟΓΑ surcharge is charged on the
// stamp -- not on the rent -- which is why this is base × (1 + pct × (1 + sur))
// and not base × (1 + pct) × (1 + sur).
export function effectiveBaseMonthlyCents(terms: LeaseTerms): number {
  const stampMultiplier = 1 + terms.stampDutyPct * (1 + terms.stampDutySurchargePct);
  return Math.round(toCents(terms.baseMonthlyAmount) * stampMultiplier);
}

export function computeLeaseSchedule(terms: LeaseTerms, stepUps: LeaseStepUp[]): LeaseSchedule {
  const baseCents = effectiveBaseMonthlyCents(terms);
  const diagnostics: string[] = [];

  if (stepUps.length > 0 && !terms.stepUpsStampable && terms.stampDutyPct > 0) {
    // Greek stamp duty is charged on rent actually paid, so a step-up almost
    // certainly attracts it too. The source workbook does not apply it; we
    // follow the workbook by default and say so rather than silently differing.
    diagnostics.push(
      "Οι προσαυξήσεις της σύμβασης δεν επιβαρύνονται με χαρτόσημο, όπως στο αρχικό " +
        "υπολογιστικό φύλλο. Το χαρτόσημο υπολογίζεται επί του καταβαλλόμενου μισθώματος, " +
        "οπότε αυτό αξίζει επιβεβαίωση — η διαφορά είναι της τάξης των €10.000 στη διάρκεια της μίσθωσης.",
    );
  }

  const stampMultiplier = 1 + terms.stampDutyPct * (1 + terms.stampDutySurchargePct);

  const rows: LeaseYearRow[] = [];
  for (let leaseYear = 1; leaseYear <= terms.termYears; leaseYear++) {
    // Compound once from the base and round once per lease year: a lease is a
    // fixed euro figure for the year, not a per-month recomputation.
    const escalationPeriods = Math.max(0, leaseYear - Math.max(1, terms.escalationFirstYear) + 1);
    const escalated = Math.round(baseCents * Math.pow(1 + terms.escalationPct, escalationPeriods));

    let stepUpCents = 0;
    for (const s of stepUps) {
      if (leaseYear < s.fromLeaseYear) continue;
      let amount = toCents(s.monthlyAmount);
      if (terms.stepUpsStampable) amount = Math.round(amount * stampMultiplier);
      if (terms.stepUpsEscalate) {
        amount = Math.round(amount * Math.pow(1 + terms.escalationPct, escalationPeriods));
      }
      stepUpCents += amount;
    }

    const monthlyCents = escalated + stepUpCents;
    rows.push({
      leaseYear,
      monthlyAmount: fromCents(monthlyCents),
      annualAmount: fromCents(monthlyCents * 12),
      stepUpPortion: fromCents(stepUpCents),
    });
  }

  return {
    effectiveBaseMonthly: fromCents(baseCents),
    rows,
    totalAmount: fromCents(rows.reduce((sum, r) => sum + toCents(r.annualAmount), 0)),
    diagnostics,
  };
}

export interface LeaseMonthRow {
  seq: number; // 1 = first rent actually paid
  month: string; // 'YYYY-MM-01'
  leaseYear: number;
  amount: number;
}

// One row per month of rent actually paid: from the lease start through the
// end of the term, skipping the months before first_payment_month (rent-free
// fit-out months are common, and Λαζαράκη's lease starts in August with the
// first payment in September). The lease year -- and so the escalation --
// counts from the lease start, not from the first payment.
export function leaseMonthlyRows(
  schedule: LeaseSchedule,
  opts: { leaseStartMonth: string; termYears: number; firstPaymentMonth?: string | null },
): LeaseMonthRow[] {
  const start = monthKeyOf(opts.leaseStartMonth);
  const firstPay = opts.firstPaymentMonth ? monthKeyOf(opts.firstPaymentMonth) : start;
  const out: LeaseMonthRow[] = [];
  for (let i = 0; i < opts.termYears * 12; i++) {
    const month = addMonths(start, i);
    if (month < firstPay) continue;
    const leaseYear = Math.floor(i / 12) + 1;
    const row = schedule.rows.find((r) => r.leaseYear === leaseYear);
    if (!row) continue;
    out.push({ seq: out.length + 1, month: firstOfMonth(month), leaseYear, amount: row.monthlyAmount });
  }
  return out;
}
