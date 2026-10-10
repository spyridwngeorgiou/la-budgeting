// Loan and lease schedules as ledger rows. The engines (loan.ts, lease.ts)
// stay the only place the maths happens; this turns their output into the
// rows sync_schedule_rows() (0065) stores as scheduled transactions, so the
// cash forecast, the calendar and the P&L see every future payment.
// Pure: no I/O, no Date.now().

import { computeSingleLoanSchedule, type LoanInput } from "./loan";
import { computeLeaseSchedule, leaseMonthlyRows, type LeaseStepUp, type LeaseTerms } from "./lease";
import { lastOfMonth, monthKeyOf } from "@/lib/dates";

export interface ScheduleRow {
  seq: number;
  due_date: string; // ISO date
  amount: number; // gross payment, euros
  interest?: number; // loans: the interest part, read by the P&L
  description: string;
}

// Loan states that are real enough to forecast. An application is not a
// commitment yet; a repaid loan has nothing left to pay.
export const SCHEDULED_LOAN_STATES = ["approved", "disbursed"] as const;

export interface LoanRowLike {
  id: string;
  label: string;
  principal: number | string;
  interest_rate: number | string;
  term_years: number;
  grace_years: number;
  first_amortisation_month: string | null;
  state: string;
  loan_drawdowns?: { scheduled_month: string; amount: number | string; actual_date?: string | null; actual_amount?: number | string | null }[] | null;
}

export function loanInputFromRow(loan: LoanRowLike): LoanInput {
  return {
    id: loan.id,
    label: loan.label,
    principal: Number(loan.principal),
    interestRate: Number(loan.interest_rate),
    termYears: Number(loan.term_years),
    graceYears: Number(loan.grace_years ?? 0),
    firstAmortisationMonth: loan.first_amortisation_month,
    // what was actually drawn wins over the plan, once it is known
    drawdowns: (loan.loan_drawdowns ?? []).map((d) => ({
      month: d.actual_date ?? d.scheduled_month,
      amount: Number(d.actual_amount ?? d.amount),
    })),
  };
}

// One row per month with a payment (interest during grace, instalments
// after), due on the last day of the month. seq is the schedule month
// (1 = the first drawdown month), so it stays stable across re-syncs as long
// as the first drawdown does not move.
export function loanScheduleRows(loan: LoanRowLike): ScheduleRow[] {
  if (!(SCHEDULED_LOAN_STATES as readonly string[]).includes(loan.state)) return [];
  const schedule = computeSingleLoanSchedule(loanInputFromRow(loan));
  if (!schedule) return [];
  return schedule.combined
    .filter((r) => r.payment > 0)
    .map((r) => ({
      seq: r.monthIndex,
      due_date: lastOfMonth(monthKeyOf(r.month)),
      amount: r.payment,
      interest: r.interest,
      description:
        r.principal > 0
          ? `${loan.label} — δόση ${r.monthIndex} (τόκος + κεφάλαιο)`
          : `${loan.label} — τόκοι χάριτος ${r.monthIndex}`,
    }));
}

export interface LeaseRowLike {
  kind: string;
  term_years: number;
  lease_start_month: string;
  first_payment_month: string | null;
  lease_indexed_terms?:
    | LeaseIndexedTermsLike
    | LeaseIndexedTermsLike[]
    | null;
}

export interface LeaseIndexedTermsLike {
  base_monthly_amount: number | string | null;
  stamp_duty_pct: number | string | null;
  stamp_duty_surcharge_pct: number | string | null;
  escalation_pct: number | string | null;
  escalation_first_year: number | null;
  stepups_escalate: boolean | null;
  stepups_stampable: boolean | null;
  lease_step_ups?: { from_lease_year: number; monthly_amount: number | string }[] | null;
}

// PostgREST returns a one-to-one embed as an object or a one-element array
// depending on how it resolves the FK; accept both.
export function indexedTermsOf(lease: LeaseRowLike | null | undefined): LeaseIndexedTermsLike | null {
  const t = lease?.lease_indexed_terms;
  if (!t) return null;
  return Array.isArray(t) ? (t[0] ?? null) : t;
}

export function leaseTermsFromRow(
  lease: LeaseRowLike,
  terms: LeaseIndexedTermsLike,
): { terms: LeaseTerms; stepUps: LeaseStepUp[] } {
  return {
    terms: {
      baseMonthlyAmount: Number(terms.base_monthly_amount ?? 0),
      stampDutyPct: Number(terms.stamp_duty_pct ?? 0),
      stampDutySurchargePct: Number(terms.stamp_duty_surcharge_pct ?? 0),
      escalationPct: Number(terms.escalation_pct ?? 0),
      escalationFirstYear: Number(terms.escalation_first_year ?? 2),
      termYears: Number(lease.term_years ?? 1),
      stepUpsEscalate: Boolean(terms.stepups_escalate),
      stepUpsStampable: Boolean(terms.stepups_stampable),
    },
    stepUps: (terms.lease_step_ups ?? []).map((s) => ({
      fromLeaseYear: Number(s.from_lease_year),
      monthlyAmount: Number(s.monthly_amount),
    })),
  };
}

// Monthly rent, due on the first of each month (rent is paid in advance).
// Only indexed-rent leases have terms the engine can schedule; a settlement
// lease's payments already live in instalment plans.
export function leaseScheduleRows(lease: LeaseRowLike, projectName: string): ScheduleRow[] {
  const raw = indexedTermsOf(lease);
  if (lease.kind !== "indexed_rent" || !raw) return [];
  const { terms, stepUps } = leaseTermsFromRow(lease, raw);
  const schedule = computeLeaseSchedule(terms, stepUps);
  return leaseMonthlyRows(schedule, {
    leaseStartMonth: lease.lease_start_month,
    termYears: terms.termYears,
    firstPaymentMonth: lease.first_payment_month,
  })
    .filter((r) => r.amount > 0)
    .map((r) => ({
      seq: r.seq,
      due_date: r.month,
      amount: r.amount,
      description: `Μίσθωμα ${projectName} — έτος ${r.leaseYear}`,
    }));
}
