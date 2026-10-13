import { OnePagerRow, OnePagerSection } from "@/components/onepager";
import { Notice, ReportHistory } from "@/components/ui";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import type { LoansScheduleResult } from "@/lib/finance/loan";
import type { LoanRow } from "@/lib/finance/projectModel";
import { ArgsDeleteButton, LoanFormModal } from "../LegacyFormModals";
import { deleteLoan, saveLoan } from "./finance-actions";
import { ProjectIrrRow } from "./FinanceSections";

// An editable record: its facts on the left, the buttons on the right
// (under it on phones), a hairline under each.
const ROW = "flex flex-col gap-2 border-b border-hairline py-2 md:flex-row md:items-center md:justify-between md:gap-4";

// ΕΣΟΔΑ (ΣΥΜΒΑΣΗ ΠΕΛΑΤΗ and Απόδοση in one): the agreed contract value,
// the income received to date (paid income transactions on this project),
// what is left to invoice, and the project's own return («IRR έργου (χωρίς
// ΦΠΑ)», development.ts) unless ΑΝΑΠΤΥΞΗ already shows it. Each figure once.
export function RevenueSection({
  projectId: id,
  contractValue,
  signedDate,
  revenueToDate,
  irr,
  showIrr,
}: {
  projectId: string;
  contractValue: number | null;
  signedDate: string | null;
  revenueToDate: number;
  irr: number | null;
  showIrr: boolean;
}) {
  const t = el.projectPage.revenue;
  const left = contractValue != null ? contractValue - revenueToDate : 0;
  return (
    <OnePagerSection
      title={t.title}
      subtitle={contractValue != null && signedDate ? `${t.signed} ${formatDate(signedDate)}` : undefined}
    >
      {contractValue != null && <OnePagerRow label={t.contract} amount={contractValue} />}
      {(contractValue != null || revenueToDate !== 0) && (
        <OnePagerRow label={t.toDate} amount={revenueToDate} href={`/transactions?project_id=${id}&direction=income&status=paid`} />
      )}
      {contractValue != null && (
        <OnePagerRow label={t.toInvoice} amount={left} negative={left < 0} alert={left < 0} emphasis />
      )}
      {showIrr && <ProjectIrrRow irr={irr} />}
    </OnePagerSection>
  );
}

// ΔΑΝΕΙΟ (the programme and its tranches in one), written into the ledger
// by saveLoan (0065): the total, the instalment, the annual debt service and
// the total cost in view; the tranches (edit / delete) and the interest
// behind «▸ Σκέλη (N)». «+ Δάνειο» beside the title.
export function LoanSection({
  projectId: id,
  loans,
  schedule,
}: {
  projectId: string;
  loans: LoanRow[];
  schedule: LoansScheduleResult | null;
}) {
  const t = el.projectPage.loan;
  const total = loans.reduce((s, l) => s + Number(l.principal), 0);
  return (
    <OnePagerSection title={t.title} actions={<LoanFormModal action={saveLoan} args={[id, null]} />}>
      <OnePagerRow label={t.total} amount={total} />
      {schedule ? (
        <>
          <OnePagerRow label={t.monthly} amount={schedule.totals.monthlyInstalment} note={t.monthlyNote} />
          <OnePagerRow label={t.annual} amount={schedule.totals.annualDebtService} />
          <OnePagerRow label={t.totalCost} amount={schedule.totals.totalCost} emphasis />
        </>
      ) : (
        <Notice size="small" className="my-2">
          {t.noDrawdowns}
        </Notice>
      )}
      <ReportHistory level={3} title={t.tranches} count={loans.length}>
        <div className="flex flex-col">
          {loans.map((l) => (
            <div key={l.id} className={ROW}>
              <div className="min-w-0 text-body">
                <span className="text-ink">{l.label}</span>{" "}
                <span className="num text-muted">
                  · {formatMoney(l.principal)} · {formatPercent(Number(l.interest_rate), { digits: 2, fixed: true })} ·{" "}
                  {l.term_years} έτη
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <LoanFormModal
                  action={saveLoan}
                  args={[id, l.id]}
                  initial={{
                    label: l.label,
                    principal: Number(l.principal),
                    interest_rate: Number(l.interest_rate),
                    term_years: l.term_years,
                    grace_years: l.grace_years,
                    first_amortisation_month: l.first_amortisation_month,
                    state: l.state,
                    notes: l.notes,
                    drawdowns: (l.loan_drawdowns ?? []).map((d) => ({
                      scheduled_month: d.scheduled_month,
                      amount: Number(d.actual_amount ?? d.amount),
                      done: d.actual_date != null,
                    })),
                  }}
                />
                <ArgsDeleteButton action={deleteLoan} args={[id, l.id]} />
              </div>
            </div>
          ))}
        </div>
        {schedule && (
          <div>
            <OnePagerRow label={t.gracePre} amount={schedule.totals.graceInterestPreOpening} note={t.gracePreNote} />
            <OnePagerRow label={t.gracePost} amount={schedule.totals.graceInterestPostOpening} note={t.gracePostNote} />
            <OnePagerRow label={t.interest} amount={schedule.totals.totalInterest} />
          </div>
        )}
      </ReportHistory>
    </OnePagerSection>
  );
}
