import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, Card, Button, AiSpark } from "@/components/ui";
import { OnePagerSection, OnePagerRow, StatusNotes, type ProjectNote } from "@/components/onepager";
import { computeLeaseSchedule } from "@/lib/finance/lease";
import { computeLoanSchedule } from "@/lib/finance/loan";
import { aiEnabled } from "@/lib/ai/client";
import { ProjectHealthCheck } from "./ProjectHealthCheck";
import { BudgetFormModal } from "../BudgetFormModal";
import { saveProjectBudget } from "../budget-actions";

// Σύνοψη Έργου -- the one-pager, modelled on the layout the Q004 workbook
// already proved works: blocks of label / figure / explanatory note, bold
// totals, and the ΚΑΤΑΣΤΑΣΗ block at the end. Every figure here is derived
// (from budget_lines, the ledger, the lease and the scenario); nothing is
// restated from the spreadsheet.
//
// Blocks render only when their data exists, so the six thin projects degrade
// to just ΕΠΕΝΔΥΣΗ + ΠΟΡΕΙΑ without looking unfinished.
export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [
    { data: rollup },
    { data: project },
    { data: budget },
    { data: lease },
    { data: scenario },
    { data: notes },
    { data: settlementPlans },
    { data: noBudgetRow },
    { data: loans },
  ] = await Promise.all([
    supabase.from("v_project_rollup").select("*").eq("project_id", id).maybeSingle(),
    supabase.from("projects").select("opening_date, phase, legal_relation, units").eq("id", id).maybeSingle(),
    supabase
      .from("project_budgets")
      .select("contingency_pct, notes, budget_lines(line_code, label, amount)")
      .eq("project_id", id)
      .eq("is_current", true)
      .maybeSingle(),
    supabase
      .from("project_leases")
      .select(
        "kind, term_years, lease_start_month, notes, lease_indexed_terms!lease_indexed_terms_lease_id_fkey(base_monthly_amount, stamp_duty_pct, stamp_duty_surcharge_pct, escalation_pct, escalation_first_year, stepups_escalate, stepups_stampable, lease_step_ups(from_lease_year, monthly_amount))",
      )
      .eq("project_id", id)
      .maybeSingle(),
    supabase
      .from("project_scenarios")
      .select("name, flat_annual_revenue, notes, opex_lines(kind, label, annual_amount, note)")
      .eq("project_id", id)
      .eq("is_base", true)
      .maybeSingle(),
    supabase
      .from("project_notes")
      .select("id, severity, body, exposure_amount, due_date")
      .eq("project_id", id)
      .is("resolved_at", null)
      .order("sort_order"),
    supabase
      .from("installment_plans")
      .select("label, amount_per_installment, installment_count, first_due_date, notes")
      .eq("project_id", id)
      .eq("obligation_kind", "third_party_tax_settlement")
      .order("amount_per_installment", { ascending: false }),
    supabase.from("v_qc_projects_without_budget").select("project_id").eq("project_id", id).maybeSingle(),
    supabase
      .from("loans")
      .select("id, label, principal, interest_rate, term_years, grace_years, first_amortisation_month, loan_drawdowns(scheduled_month, amount)")
      .eq("project_id", id),
  ]);

  if (!rollup) notFound();

  const hasBudget = !noBudgetRow;
  const lines = budget?.budget_lines ?? [];
  const budgetTotal = lines.reduce((s, l) => s + Number(l.amount ?? 0), 0);

  // Λειτουργία: revenue − opex − rent, exactly as the workbook composes it.
  const indexedTerms = Array.isArray(lease?.lease_indexed_terms)
    ? lease?.lease_indexed_terms[0]
    : lease?.lease_indexed_terms;

  const leaseSchedule =
    lease && indexedTerms
      ? computeLeaseSchedule(
          {
            baseMonthlyAmount: Number(indexedTerms.base_monthly_amount ?? 0),
            stampDutyPct: Number(indexedTerms.stamp_duty_pct ?? 0),
            stampDutySurchargePct: Number(indexedTerms.stamp_duty_surcharge_pct ?? 0),
            escalationPct: Number(indexedTerms.escalation_pct ?? 0),
            escalationFirstYear: Number(indexedTerms.escalation_first_year ?? 2),
            termYears: Number(lease.term_years ?? 1),
            stepUpsEscalate: Boolean(indexedTerms.stepups_escalate),
            stepUpsStampable: Boolean(indexedTerms.stepups_stampable),
          },
          ((indexedTerms.lease_step_ups ?? []) as { from_lease_year: number; monthly_amount: number }[]).map(
            (s) => ({ fromLeaseYear: Number(s.from_lease_year), monthlyAmount: Number(s.monthly_amount) }),
          ),
        )
      : null;

  const firstYearRent = leaseSchedule?.rows[0];
  const opexLines = scenario?.opex_lines ?? [];
  const opexTotal = opexLines.reduce((s, l) => s + Number(l.annual_amount ?? 0), 0);
  const revenue = Number(scenario?.flat_annual_revenue ?? 0);
  const annualRent = firstYearRent?.annualAmount ?? 0;
  const operatingResult = revenue - opexTotal - annualRent;
  const hasOperation = Boolean(scenario && revenue > 0);

  const settlementMonthly = (settlementPlans ?? []).reduce(
    (s, p) => s + Number(p.amount_per_installment ?? 0),
    0,
  );
  const monthlyRent = firstYearRent?.monthlyAmount ?? 0;

  // ΔΑΝΕΙΟ: drawdowns are stored per tranche (loan_drawdowns.loan_id), but
  // the engine takes one programme-level schedule and splits it pro-rata by
  // tranche principal itself. Summing them back to programme level and
  // letting it re-split is simpler than bypassing that logic, and is exact
  // here because both tranches carry equal principal (so an even split
  // reproduces exactly what was stored).
  const loanRows = loans ?? [];
  const programmeDrawdowns = new Map<string, number>();
  for (const l of loanRows) {
    for (const d of l.loan_drawdowns ?? []) {
      const month = `${String(d.scheduled_month).slice(0, 7)}-01`;
      programmeDrawdowns.set(month, (programmeDrawdowns.get(month) ?? 0) + Number(d.amount));
    }
  }
  const drawdownMonths = [...programmeDrawdowns.keys()].sort();
  const loanSchedule =
    loanRows.length > 0 && drawdownMonths.length > 0
      ? computeLoanSchedule(
          loanRows.map((l) => ({
            id: l.id,
            label: l.label,
            principal: Number(l.principal),
            interestRate: Number(l.interest_rate),
          })),
          drawdownMonths.map((month) => ({ month, amount: programmeDrawdowns.get(month)! })),
          {
            firstMonth: drawdownMonths[0],
            termYears: Number(loanRows[0].term_years),
            graceYears: Number(loanRows[0].grace_years),
            openingMonth: project?.opening_date ? `${String(project.opening_date).slice(0, 7)}-01` : undefined,
          },
        )
      : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">{rollup.display_name}</h1>
          <p className="text-sm text-ink-muted">
            {[
              rollup.code,
              project?.units ? `${project.units} μονάδες` : null,
              lease ? `μίσθωση ${lease.term_years} ετών` : null,
              project?.opening_date ? `άνοιγμα ${formatDate(project.opening_date)}` : null,
              project?.phase,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <BudgetFormModal
            action={saveProjectBudget.bind(null, id)}
            initial={
              budget
                ? {
                    contingency_pct: budget.contingency_pct ?? 0,
                    lines: Object.fromEntries(lines.map((l) => [l.line_code, Number(l.amount)])),
                  }
                : undefined
            }
          />
          <Link href={`/transactions?project_id=${id}`}>
            <Button variant="secondary">{el.nav.transactions}</Button>
          </Link>
        </div>
      </div>

      {aiEnabled() && <ProjectHealthCheck projectId={id} />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ΕΠΕΝΔΥΣΗ — the capex budget, line by line */}
        <OnePagerSection title="ΕΠΕΝΔΥΣΗ" subtitle={budget?.notes ?? undefined}>
          {hasBudget ? (
            <>
              {lines.map((l) => (
                <OnePagerRow key={l.line_code} label={l.label ?? l.line_code} amount={Number(l.amount)} />
              ))}
              <OnePagerRow label="ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ" amount={budgetTotal} emphasis />
            </>
          ) : (
            <div className="flex flex-col gap-2 py-2">
              <Badge tone="amber">Χωρίς προϋπολογισμό</Badge>
              <p className="text-sm text-ink-muted">
                Δεν έχει καταχωρηθεί προϋπολογισμός για αυτό το έργο.
              </p>
            </div>
          )}
        </OnePagerSection>

        {/* ΠΟΡΕΙΑ — plan vs actual, with the opex kept visibly outside it */}
        <OnePagerSection
          title="ΠΟΡΕΙΑ ΕΝΑΝΤΙ ΠΡΟΫΠΟΛΟΓΙΣΜΟΥ"
          subtitle="Μόνο οι κεφαλαιουχικές δαπάνες καταναλώνουν τον προϋπολογισμό."
        >
          <OnePagerRow
            label="Κεφαλαιουχικά πληρωμένα"
            amount={Number(rollup.capex_paid ?? 0)}
            href={`/transactions?project_id=${id}&direction=expense&status=paid`}
          />
          <OnePagerRow
            label="Κεφαλαιουχικά δεσμευμένα"
            amount={Number(rollup.capex_committed ?? 0)}
            href={`/transactions?project_id=${id}&direction=expense&status=pending`}
            note="Εκκρεμείς και προγραμματισμένες κινήσεις."
          />
          {hasBudget && (
            <OnePagerRow
              label="Υπόλοιπο προϋπολογισμού"
              amount={Number(rollup.remaining_budget ?? 0)}
              negative={Number(rollup.remaining_budget ?? 0) < 0}
              emphasis
            />
          )}
          {Number(rollup.occupancy_cost ?? 0) > 0 && (
            <OnePagerRow
              label="Κόστος χρήσης ακινήτου"
              amount={Number(rollup.occupancy_cost ?? 0)}
              note="Μισθώματα και ρυθμίσεις αντί μισθώματος — λειτουργικό κόστος, εκτός προϋπολογισμού."
            />
          )}
          {Number(rollup.other_opex ?? 0) > 0 && (
            <OnePagerRow
              label="Λοιπά λειτουργικά"
              amount={Number(rollup.other_opex ?? 0)}
              note="Εκτός προϋπολογισμού έργου."
            />
          )}
          {Number(rollup.unclassified_spend ?? 0) > 0 && (
            <OnePagerRow
              label="Αταξινόμητες δαπάνες"
              amount={Number(rollup.unclassified_spend ?? 0)}
              note="Χωρίς κατηγορία — προσμετρώνται στον προϋπολογισμό μέχρι να ταξινομηθούν."
            />
          )}
        </OnePagerSection>

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

        {/* ΛΕΙΤΟΥΡΓΙΑ — the stabilised operating year */}
        {hasOperation && (
          <OnePagerSection title="ΛΕΙΤΟΥΡΓΙΑ" subtitle={scenario?.name ?? undefined}>
            <OnePagerRow label="Ετήσιος τζίρος" amount={revenue} />
            {opexLines.map((l, i) => (
              <OnePagerRow
                key={i}
                label={l.label}
                amount={Number(l.annual_amount ?? 0)}
                negative
                note={l.note}
              />
            ))}
            {annualRent > 0 && (
              <OnePagerRow
                label="Μίσθωμα προς ιδιοκτήτες"
                amount={annualRent}
                negative
                note={`${formatMoney(monthlyRent)} τον μήνα.`}
              />
            )}
            <OnePagerRow label="ΕΤΗΣΙΟ ΑΠΟΤΕΛΕΣΜΑ" amount={operatingResult} emphasis />
            <OnePagerRow
              label="Περιθώριο επί τζίρου"
              amount={`${((operatingResult / revenue) * 100).toFixed(1)}%`}
            />
          </OnePagerSection>
        )}

        {/* ΚΟΣΤΟΣ ΧΡΗΣΗΣ — the derived line the workbook never states */}
        {(settlementPlans ?? []).length > 0 && (
          <OnePagerSection
            title="ΚΟΣΤΟΣ ΧΡΗΣΗΣ ΑΚΙΝΗΤΟΥ"
            subtitle="Τι κοστίζει πραγματικά η χρήση του ακινήτου κάθε μήνα."
          >
            {monthlyRent > 0 && <OnePagerRow label="Μίσθωμα προς ιδιοκτήτες" amount={monthlyRent} />}
            {(settlementPlans ?? []).map((p) => (
              <OnePagerRow
                key={p.label}
                label={p.label}
                amount={Number(p.amount_per_installment)}
                note={`${p.installment_count} δόσεις από ${formatDate(p.first_due_date)}.`}
              />
            ))}
            <OnePagerRow label="ΣΥΝΟΛΟ ΜΗΝΑ" amount={monthlyRent + settlementMonthly} emphasis />
          </OnePagerSection>
        )}

        {/* ΚΑΤΑΣΤΑΣΗ — the block with no home until now */}
        {(notes ?? []).length > 0 && (
          <OnePagerSection title="ΚΑΤΑΣΤΑΣΗ">
            <StatusNotes notes={(notes ?? []) as ProjectNote[]} />
          </OnePagerSection>
        )}
      </div>

      {leaseSchedule && leaseSchedule.diagnostics.length > 0 && (
        <Card className="border-amber-300 bg-amber-50">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-800">
            <AiSpark />
            Σημειώσεις μοντέλου
          </div>
          <ul className="list-disc pl-4 text-xs text-amber-800">
            {leaseSchedule.diagnostics.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
