import { OnePagerRow, OnePagerSection } from "@/components/onepager";
import { formatMoney, formatPercent } from "@/lib/format";
import type { LoansScheduleResult } from "@/lib/finance/loan";
import type { LoanRow } from "@/lib/finance/projectModel";
import { LoanFormModal } from "../LegacyFormModals";
import { saveLoan, deleteLoan } from "./finance-actions";
import { ProjectIrrRow } from "./FinanceSections";
import { RowDeleteMenu } from "@/components/RowDeleteMenu";

// An editable record: its facts on the left, the buttons on the right
// (under it on phones), a hairline under each.
const ROW = "flex flex-col gap-2 border-b border-hairline py-2 md:flex-row md:items-center md:justify-between md:gap-4";

// How the project is funded: the loan programme and its tranches (each
// written into the ledger by saveLoan, 0065), and the project's own return
// («IRR έργου (χωρίς ΦΠΑ)», development.ts).
export function FundingSections({
  projectId: id,
  loans: loanRows,
  loanSchedule,
  revenueToDate,
  projectIrr,
}: {
  projectId: string;
  loans: LoanRow[];
  loanSchedule: LoansScheduleResult | null;
  revenueToDate: number;
  projectIrr: number | null;
}) {
  return (
    <>
      {/* ΔΑΝΕΙΟ — the loan programme, summarised */}
      {loanSchedule && (
        <OnePagerSection
          title="ΔΑΝΕΙΟ"
          subtitle={`${loanRows.length} ${loanRows.length === 1 ? "σκέλος" : "σκέλη"} · σύνολο ${formatMoney(loanRows.reduce((s, l) => s + Number(l.principal), 0))}`}
        >
          <OnePagerRow label="Μηνιαία δόση μετά τη χάρη" amount={loanSchedule.totals.monthlyInstalment} />
          <OnePagerRow label="Ετήσια εξυπηρέτηση" amount={loanSchedule.totals.annualDebtService} />
          <OnePagerRow
            label="Τόκοι χάριτος — πριν το άνοιγμα"
            amount={loanSchedule.totals.graceInterestPreOpening}
            note="Από την τσέπη σας, πριν υπάρχουν έσοδα."
          />
          <OnePagerRow
            label="Τόκοι χάριτος — μετά το άνοιγμα"
            amount={loanSchedule.totals.graceInterestPostOpening}
            note="Καλύπτεται από τη λειτουργία."
          />
          <OnePagerRow label="Συνολικοί τόκοι" amount={loanSchedule.totals.totalInterest} />
          <OnePagerRow label="Συνολικό κόστος δανείου" amount={loanSchedule.totals.totalCost} emphasis />
        </OnePagerSection>
      )}

      {/* Loan tranches, directly editable -- previously only reachable
          through the Kansha AI chat's propose-and-approve flow. Renders
          even with zero tranches yet, so "+ Δάνειο" is always reachable. */}
      <OnePagerSection title="Σκέλη Δανείου">
        <div className="flex flex-col">
          {loanRows.map((l) => (
            <div key={l.id} className={ROW}>
              <div className="min-w-0 text-body">
                <span className="text-ink">{l.label}</span>{" "}
                <span className="num text-muted">
                  · {formatMoney(l.principal)} · {formatPercent(Number(l.interest_rate), { digits: 2, fixed: true })} ·{" "}
                  {l.term_years} έτη
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <LoanFormModal
                  action={saveLoan.bind(null, id, l.id)}
                  trigger="Επεξεργασία"
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
                <RowDeleteMenu action={deleteLoan.bind(null, id, l.id)} label="Ενέργειες">
                  Διαγραφή
                </RowDeleteMenu>
              </div>
            </div>
          ))}
          <div className="pt-2">
            <LoanFormModal action={saveLoan.bind(null, id, null)} />
          </div>
        </div>
      </OnePagerSection>

      {/* Απόδοση — what the project has returned so far and its IRR, both
          from the project's own cash flows (paid income; development.ts).
          Answers "is this project making money?" directly, which
          budget/actual and DSCR don't. */}
      <OnePagerSection title="Απόδοση">
        <OnePagerRow
          label="Έσοδα έργου μέχρι σήμερα"
          amount={revenueToDate}
          href={`/transactions?project_id=${id}&direction=income&status=paid`}
        />
        <ProjectIrrRow irr={projectIrr} />
      </OnePagerSection>
    </>
  );
}
