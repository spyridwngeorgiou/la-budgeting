import { OnePagerRow, OnePagerSection } from "@/components/onepager";
import { ActionForm } from "@/components/ActionForm";
import { Badge, Button } from "@/components/ui";
import { formatDate, formatMoney } from "@/lib/format";
import type { LoansScheduleResult } from "@/lib/finance/loan";
import type { LoanRow } from "@/lib/finance/projectModel";
import type { CapitalSourceKind } from "@/lib/domain/enums";
import { LoanFormModal } from "../LegacyFormModals";
import { saveLoan, deleteLoan } from "./finance-actions";
import { CapitalSourceFormModal } from "../LegacyFormModals";
import { saveCapitalSource, deleteCapitalSource } from "./finance-actions";
import { ProjectIrrRow } from "./FinanceSections";

const KIND_FALLBACK_LABEL: Record<CapitalSourceKind, string> = {
  equity: "Ίδια κεφάλαια",
  debt: "Δανεισμός",
  co_investor: "Συνεπενδυτής",
};

export interface CapitalSourceRow {
  id: string;
  kind: CapitalSourceKind;
  contributor: string | null;
  amount: number;
  contributed_on: string;
  notes: string | null;
}

// How the project is funded: the loan programme and its tranches (each
// written into the ledger by saveLoan, 0065), the capital sources, and the
// project's own return («IRR έργου (χωρίς ΦΠΑ)», development.ts).
export function FundingSections({
  projectId: id,
  loans: loanRows,
  loanSchedule,
  capitalSources: capitalRows,
  revenueToDate,
  projectIrr,
}: {
  projectId: string;
  loans: LoanRow[];
  loanSchedule: LoansScheduleResult | null;
  capitalSources: CapitalSourceRow[];
  revenueToDate: number;
  projectIrr: number | null;
}) {
  const capitalTotal = capitalRows.reduce((s, c) => s + Number(c.amount), 0);
  const capitalByKind = capitalRows.reduce<Record<string, number>>((acc, c) => {
    acc[c.kind] = (acc[c.kind] ?? 0) + Number(c.amount);
    return acc;
  }, {});

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
        <div className="flex flex-col gap-2">
          {loanRows.map((l) => (
            <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 py-1.5 first:border-0 first:pt-0">
              <div className="text-sm">
                <span className="font-medium">{l.label}</span>{" "}
                <span className="text-ink-muted">
                  · {formatMoney(l.principal)} · {(Number(l.interest_rate) * 100).toFixed(2)}% ·{" "}
                  {l.term_years} έτη
                </span>
              </div>
              <div className="flex items-center gap-1.5">
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
                <ActionForm action={deleteLoan.bind(null, id, l.id)}>
                  <Button type="submit" variant="danger" className="!px-2 !py-1 text-xs">
                    Διαγραφή
                  </Button>
                </ActionForm>
              </div>
            </div>
          ))}
          <div>
            <LoanFormModal action={saveLoan.bind(null, id, null)} />
          </div>
        </div>
      </OnePagerSection>

      {/* ΚΕΦΑΛΑΙΟ — who funded this project and what it has returned so
          far. Answers "is this project making money?" directly, which
          budget/actual and DSCR don't: those describe spend discipline and
          debt coverage, not return on the capital someone actually put in. */}
      <OnePagerSection
        title="ΚΕΦΑΛΑΙΟ"
        subtitle={capitalRows.length > 0 ? `σύνολο εισφορών ${formatMoney(capitalTotal)}` : undefined}
      >
        {capitalRows.length > 0 ? (
          <>
            {capitalByKind.equity != null && <OnePagerRow label="Ίδια κεφάλαια" amount={capitalByKind.equity} />}
            {capitalByKind.debt != null && <OnePagerRow label="Δανεισμός (εκτός σκελών)" amount={capitalByKind.debt} />}
            {capitalByKind.co_investor != null && (
              <OnePagerRow label="Συνεπενδυτές" amount={capitalByKind.co_investor} />
            )}
            <OnePagerRow label="Σύνολο κεφαλαίου" amount={capitalTotal} emphasis />
            <OnePagerRow
              label="Έσοδα έργου μέχρι σήμερα"
              amount={revenueToDate}
              href={`/transactions?project_id=${id}&direction=income&status=paid`}
            />
            <ProjectIrrRow irr={projectIrr} />
          </>
        ) : (
          <div className="flex flex-col gap-2 py-2">
            <Badge tone="amber">Χωρίς καταχωρημένο κεφάλαιο</Badge>
            <p className="text-sm text-ink-muted">
              Δεν έχουν καταχωρηθεί πηγές κεφαλαίου για αυτό το έργο.
            </p>
          </div>
        )}
      </OnePagerSection>

      {/* Capital sources, directly editable -- same pattern as loan
          tranches above. Renders even with zero rows so "+ Κεφάλαιο" is
          always reachable. */}
      <OnePagerSection title="Πηγές Κεφαλαίου">
        <div className="flex flex-col gap-2">
          {capitalRows.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-line/60 py-1.5 first:border-0 first:pt-0"
            >
              <div className="text-sm">
                <span className="font-medium">{c.contributor || KIND_FALLBACK_LABEL[c.kind]}</span>{" "}
                <span className="text-ink-muted">
                  · {formatMoney(c.amount)} · {KIND_FALLBACK_LABEL[c.kind]} · {formatDate(c.contributed_on)}
                </span>
              </div>
              <div className="flex items-center gap-1.5">
                <CapitalSourceFormModal
                  action={saveCapitalSource.bind(null, id, c.id)}
                  trigger="Επεξεργασία"
                  initial={{
                    kind: c.kind,
                    contributor: c.contributor,
                    amount: Number(c.amount),
                    contributed_on: c.contributed_on,
                    notes: c.notes,
                  }}
                />
                <form action={deleteCapitalSource.bind(null, id, c.id)}>
                  <Button type="submit" variant="danger" className="!px-2 !py-1 text-xs">
                    Διαγραφή
                  </Button>
                </form>
              </div>
            </div>
          ))}
          <div>
            <CapitalSourceFormModal action={saveCapitalSource.bind(null, id, null)} />
          </div>
        </div>
      </OnePagerSection>
    </>
  );
}
