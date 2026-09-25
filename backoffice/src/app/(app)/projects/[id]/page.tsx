import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, Card, Button, Select, AiSpark, Term } from "@/components/ui";
import { OnePagerSection, OnePagerRow, StatusNotes, type ProjectNote } from "@/components/onepager";
import { computeLeaseSchedule } from "@/lib/finance/lease";
import { computeLoanSchedule } from "@/lib/finance/loan";
import { computeScenarioResult } from "@/lib/finance/scenarioResult";
import { xirr } from "@/lib/finance/xirr";
import { aiEnabled } from "@/lib/ai/client";
import { ProjectHealthCheck } from "./ProjectHealthCheck";
import { BudgetFormModal } from "../BudgetFormModal";
import { saveProjectBudget } from "../budget-actions";
import { ProjectFormModal } from "../ProjectFormModal";
import { updateProject } from "../actions";
import { LoanFormModal } from "../LoanFormModal";
import { saveLoan, deleteLoan } from "../loan-actions";
import { CapitalSourceFormModal } from "../CapitalSourceFormModal";
import { saveCapitalSource, deleteCapitalSource } from "../capital-actions";
import type { CapitalSourceKind } from "@/lib/domain/enums";

const KIND_FALLBACK_LABEL: Record<CapitalSourceKind, string> = {
  equity: "Ίδια κεφάλαια",
  debt: "Δανεισμός",
  co_investor: "Συνεπενδυτής",
};
import { ProjectNoteFormModal } from "../ProjectNoteFormModal";
import { UtilityFormModal, UTILITY_KIND_LABELS } from "../UtilityFormModal";
import { saveUtility, deleteUtility } from "../utility-actions";
import { saveProjectNote, resolveProjectNote } from "../note-actions";
import { setScenarioRevenuePlan, saveScenario, saveOpexLine, deleteOpexLine } from "../scenario-actions";
import { ScenarioFormModal } from "../ScenarioFormModal";
import { OpexLineFormModal } from "../OpexLineFormModal";
import { AiCreateForm } from "../../revenue-plans/AiCreateForm";
import { createRevenuePlan } from "../../revenue-plans/actions";

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
    { data: revenuePlanOptions },
    { data: capitalSources },
    { data: projectIncomeTx },
  ] = await Promise.all([
    supabase.from("v_project_rollup").select("*").eq("project_id", id).maybeSingle(),
    supabase
      .from("projects")
      .select(
        "opening_date, phase, legal_relation, units, project_type, start_date, business_model, contract_value, contract_signed_date",
      )
      .eq("id", id)
      .maybeSingle(),
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
      .select(
        "id, name, flat_annual_revenue, revenue_plan_id, revenue_growth_pct, opex_growth_pct, growth_starts_after_operating_year, discount_rate_pct, dscr_covenant_min, notes, opex_lines(id, kind, label, annual_amount, from_operating_year, to_operating_year, note, headcount, monthly_wage, salaries_per_year, employer_contribution_pct, premium_pct, months_active, pct_of_revenue)",
      )
      .eq("project_id", id)
      .eq("is_base", true)
      .maybeSingle(),
    supabase
      .from("project_notes")
      .select("id, kind, severity, body, exposure_amount, due_date")
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
      .select(
        "id, label, principal, interest_rate, term_years, grace_years, first_amortisation_month, state, notes, loan_drawdowns(scheduled_month, amount)",
      )
      .eq("project_id", id),
    supabase.from("revenue_plans").select("id, name, project_id, start_year, years").order("name"),
    supabase
      .from("project_capital_sources")
      .select("id, kind, contributor, amount, contributed_on, notes")
      .eq("project_id", id)
      .order("contributed_on"),
    // Only the income side, paid -- capital-vs-revenue is the return
    // question this answers; capex/opex outflows are excluded on purpose so
    // debt-funded spend (which is not a capital contribution) never gets
    // conflated with the capital that was actually put in. See the note by
    // projectIrr below.
    supabase
      .from("transactions")
      .select("tx_date, gross_amount")
      .eq("project_id", id)
      .eq("direction", "income")
      .eq("status", "paid"),
  ]);

  const twelveMonthsAgo = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 11, 1))
    .toISOString()
    .slice(0, 10);
  const [{ data: utilities }, { data: monthlyCostRows }] = await Promise.all([
    supabase.from("property_utilities").select("*").eq("project_id", id).order("kind"),
    supabase
      .from("v_property_monthly_cost")
      .select("month, paid_amount")
      .eq("project_id", id)
      .gte("month", twelveMonthsAgo),
  ]);
  const monthlyCost = new Map<string, number>();
  for (const r of monthlyCostRows ?? []) {
    if (r.month) monthlyCost.set(r.month, (monthlyCost.get(r.month) ?? 0) + Number(r.paid_amount ?? 0));
  }
  const monthlyCostList = [...monthlyCost.entries()].sort(([a], [b]) => b.localeCompare(a));

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

  // ΔΑΝΕΙΟ: drawdowns are stored per tranche (loan_drawdowns.loan_id), but
  // the engine takes one programme-level schedule and splits it pro-rata by
  // tranche principal itself. Summing them back to programme level and
  // letting it re-split is simpler than bypassing that logic, and is exact
  // here because both tranches carry equal principal (so an even split
  // reproduces exactly what was stored). Computed before the cash flow below
  // so it can feed straight into it.
  // ΚΕΦΑΛΑΙΟ: who actually funded this project, and what has it returned so
  // far. IRR here is deliberately capital-vs-revenue only (contributions
  // out, paid income transactions in) -- NOT the project's full net cash
  // flow, so debt-funded capex/opex (which is not capital anyone
  // contributed) never gets conflated with the return on capital that was.
  // A running/unrealized figure, not a final one, since most projects here
  // haven't exited.
  const capitalRows = capitalSources ?? [];
  const capitalTotal = capitalRows.reduce((s, c) => s + Number(c.amount), 0);
  const capitalByKind = capitalRows.reduce<Record<string, number>>((acc, c) => {
    acc[c.kind] = (acc[c.kind] ?? 0) + Number(c.amount);
    return acc;
  }, {});
  const revenueToDate = (projectIncomeTx ?? []).reduce((s, t) => s + Number(t.gross_amount ?? 0), 0);
  const projectIrr =
    capitalRows.length > 0
      ? xirr([
          ...capitalRows.map((c) => ({ date: c.contributed_on, amount: -Number(c.amount) })),
          ...(projectIncomeTx ?? []).map((t) => ({ date: t.tx_date, amount: Number(t.gross_amount ?? 0) })),
        ])
      : null;

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

  // Projects with a room-type revenue grid (Q003) source ΛΕΙΤΟΥΡΓΙΑ and
  // ΤΑΜΕΙΑΚΗ ΡΟΗ from the same computeProjectCashflow run, so every figure on
  // the page is internally consistent. Projects with a single flat annual
  // figure (Q004) keep the simpler direct computation -- there is no
  // multi-year grid or loan to assemble a cash flow from. Shared with the
  // scenario comparison view (compare/page.tsx) so the two can't disagree.
  const scenarioResult = scenario
    ? await computeScenarioResult(supabase, scenario, {
        leaseSchedule,
        leaseStartMonth: lease?.lease_start_month ?? null,
        leaseTermYears: lease?.term_years ?? null,
        loanSchedule,
        openingDate: project?.opening_date ?? null,
      })
    : null;

  const revenue = scenarioResult?.revenue ?? 0;
  const opexTotal = scenarioResult?.opexTotal ?? 0;
  const annualRent = scenarioResult?.annualRent ?? firstYearRent?.annualAmount ?? 0;
  const cashflow = scenarioResult?.cashflow ?? null;

  const operatingResult = revenue - opexTotal - annualRent;
  const hasOperation = Boolean(scenario && revenue > 0);
  const linkedPlans = (revenuePlanOptions ?? []).filter((p) => p.project_id === id);

  const settlementMonthly = (settlementPlans ?? []).reduce(
    (s, p) => s + Number(p.amount_per_installment ?? 0),
    0,
  );
  const monthlyRent = firstYearRent?.monthlyAmount ?? 0;

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
          <ProjectFormModal
            action={updateProject.bind(null, id)}
            trigger="Επεξεργασία Έργου"
            initial={{
              code: rollup.code ?? undefined,
              display_name: rollup.display_name ?? undefined,
              project_type: project?.project_type ?? null,
              status: rollup.status ?? undefined,
              business_model: rollup.business_model ?? null,
              start_date: project?.start_date ?? null,
              contract_value: project?.contract_value ?? null,
              contract_signed_date: project?.contract_signed_date ?? null,
            }}
          />
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
          <Link href={`/projects/${id}/compare`}>
            <Button variant="secondary">Σύγκριση σεναρίων</Button>
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

        {/* ΣΥΜΒΑΣΗ ΠΕΛΑΤΗ — the revenue baseline client_project work never
            had: the agreed contract value, billed to date (paid income
            transactions on this project, same figure used above for
            capital's revenueToDate), and what's left to invoice. Renders
            only when a contract value is actually set, so this stays
            invisible for own_development/hotel_lease projects. */}
        {project?.contract_value != null && (
          <OnePagerSection
            title="ΣΥΜΒΑΣΗ ΠΕΛΑΤΗ"
            subtitle={project.contract_signed_date ? `υπογραφή ${formatDate(project.contract_signed_date)}` : undefined}
          >
            <OnePagerRow label="Συμβατική αξία" amount={Number(project.contract_value)} />
            <OnePagerRow
              label="Τιμολογημένα μέχρι σήμερα"
              amount={revenueToDate}
              href={`/transactions?project_id=${id}&direction=income&status=paid`}
            />
            <OnePagerRow
              label="Υπόλοιπο προς τιμολόγηση"
              amount={Number(project.contract_value) - revenueToDate}
              negative={Number(project.contract_value) - revenueToDate < 0}
              emphasis
            />
          </OnePagerSection>
        )}

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
                    }}
                  />
                  <form action={deleteLoan.bind(null, id, l.id)}>
                    <Button type="submit" variant="danger" className="!px-2 !py-1 text-xs">
                      Διαγραφή
                    </Button>
                  </form>
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
              <div className="flex items-center justify-between border-t border-line/60 pt-1.5 text-sm">
                <span className="flex items-center gap-1">
                  <Term title="Ετησιοποιημένη απόδοση: κεφάλαιο εισφέρθηκε (έξοδος) έναντι εσόδων που εισπράχθηκαν (είσοδος), σταθμισμένη στον χρόνο. Τρέχουσα, όχι τελική — το έργο δεν έχει (απαραίτητα) ολοκληρωθεί.">
                    IRR κεφαλαίου
                  </Term>
                </span>
                <span className={`font-mono font-medium ${projectIrr != null && projectIrr < 0 ? "text-red-ink" : "text-sage-ink"}`}>
                  {projectIrr != null ? `${(projectIrr * 100).toFixed(1)}%` : "—"}
                </span>
              </div>
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

        {/* Αναλύσεις Εσόδων -- a project can have several (conservative /
            optimistic scenarios, revisions over time), previously only
            reachable one-at-a-time through whichever plan happened to be
            wired into the scenario, with no way to browse or create one
            scoped to this project. Creation goes first (most projects here
            still need their first analysis), then the full browsable list,
            then -- as a clearly separate, secondary concern -- which one of
            them currently feeds the ΛΕΙΤΟΥΡΓΙΑ model below. */}
        <OnePagerSection title="Αναλύσεις Εσόδων">
          <div className="flex flex-col gap-4">
            {aiEnabled() && <AiCreateForm projectId={id} />}

            <details className="rounded-md border border-line bg-bg p-3">
              <summary className="cursor-pointer text-sm font-medium text-ink-muted">
                ή ξεκίνα μια κενή ανάλυση χειροκίνητα
              </summary>
              <form action={createRevenuePlan} className="mt-3 flex flex-wrap items-end gap-3">
                <input type="hidden" name="project_id" value={id} />
                <div className="flex flex-col">
                  <label className="mb-1 text-xs font-medium text-ink-muted">Όνομα</label>
                  <input name="name" required className="rounded-md border border-line-strong px-3 py-2 text-sm" />
                </div>
                <div className="flex flex-col">
                  <label className="mb-1 text-xs font-medium text-ink-muted">Έτος Έναρξης</label>
                  <input
                    name="start_year"
                    type="number"
                    defaultValue={new Date().getFullYear()}
                    required
                    className="w-28 rounded-md border border-line-strong px-3 py-2 text-sm"
                  />
                </div>
                <div className="flex flex-col">
                  <label className="mb-1 text-xs font-medium text-ink-muted">Έτη</label>
                  <input
                    name="years"
                    type="number"
                    min={1}
                    max={10}
                    defaultValue={3}
                    required
                    className="w-20 rounded-md border border-line-strong px-3 py-2 text-sm"
                  />
                </div>
                <Button type="submit" variant="secondary">
                  Δημιουργία
                </Button>
              </form>
            </details>

            {linkedPlans.length === 0 ? (
              <p className="text-sm text-ink-faint">Καμία ανάλυση εσόδων ακόμα για αυτό το έργο.</p>
            ) : (
              <div className="flex flex-col gap-1.5">
                {linkedPlans.map((p) => (
                  <Link
                    key={p.id}
                    href={`/revenue-plans/${p.id}`}
                    className="flex items-center justify-between rounded border border-line px-3 py-2 text-sm transition-colors hover:border-line-strong hover:bg-bg"
                  >
                    <span>{p.name}</span>
                    <span className="text-xs text-ink-muted">
                      {p.start_year}–{p.start_year + p.years - 1}
                      {scenario?.revenue_plan_id === p.id && " · ενεργή στη ΛΕΙΤΟΥΡΓΙΑ"}
                    </span>
                  </Link>
                ))}
              </div>
            )}

            {scenario && (
              <form
                action={setScenarioRevenuePlan.bind(null, id, scenario.id)}
                className="flex flex-wrap items-end gap-3 border-t border-line/60 pt-3"
              >
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-ink-muted">Ποια τροφοδοτεί τη ΛΕΙΤΟΥΡΓΙΑ παρακάτω</label>
                  <Select name="revenue_plan_id" defaultValue={scenario.revenue_plan_id ?? ""}>
                    <option value="">— Καμία (σταθερός ετήσιος τζίρος) —</option>
                    {(revenuePlanOptions ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.project_id && p.project_id !== id ? " (άλλο έργο)" : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="submit" variant="secondary">
                  Ενημέρωση
                </Button>
              </form>
            )}
          </div>
        </OnePagerSection>

        {/* Λειτουργικές Παραδοχές -- growth rates, discount rate, DSCR
            covenant, and the opex line items themselves were previously not
            editable anywhere in the app, not even through the AI chat
            (project_scenarios/opex_lines aren't in writeTools.ts's
            ALLOWLIST). This is what actually feeds the ΛΕΙΤΟΥΡΓΙΑ/DSCR/NPV
            numbers below -- renders even with no scenario yet so the first
            one can be created here instead of nowhere. */}
        <OnePagerSection title="Λειτουργικές Παραδοχές">
          <div className="flex flex-col gap-3">
            {!scenario ? (
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-ink-faint">Δεν υπάρχει ακόμα σενάριο λειτουργίας για αυτό το έργο.</p>
                <ScenarioFormModal action={saveScenario.bind(null, id, null)} trigger="+ Σενάριο Λειτουργίας" />
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <div className="text-ink-muted">
                    Ανάπτυξη εσόδων {(Number(scenario.revenue_growth_pct) * 100).toFixed(1)}% ·{" "}
                    <Term title="Opex (Operating Expenses) — λειτουργικά έξοδα, εκτός μισθώματος και εξυπηρέτησης δανείου.">
                      opex
                    </Term>{" "}
                    {(Number(scenario.opex_growth_pct) * 100).toFixed(1)}% · προεξόφληση{" "}
                    {(Number(scenario.discount_rate_pct) * 100).toFixed(1)}% ·{" "}
                    <Term title="DSCR (Debt Service Coverage Ratio) — Δείκτης Κάλυψης Εξυπηρέτησης Χρέους: λειτουργικό αποτέλεσμα ÷ ετήσια δόση δανείου. Πάνω από 1.0× σημαίνει ότι τα έσοδα καλύπτουν τη δόση.">
                      DSCR
                    </Term>{" "}
                    ≥ {scenario.dscr_covenant_min}×
                  </div>
                  <ScenarioFormModal
                    action={saveScenario.bind(null, id, scenario.id)}
                    initial={{
                      name: scenario.name,
                      flat_annual_revenue: scenario.flat_annual_revenue,
                      revenue_growth_pct: Number(scenario.revenue_growth_pct),
                      opex_growth_pct: Number(scenario.opex_growth_pct),
                      growth_starts_after_operating_year: scenario.growth_starts_after_operating_year,
                      discount_rate_pct: Number(scenario.discount_rate_pct),
                      dscr_covenant_min: Number(scenario.dscr_covenant_min),
                      notes: scenario.notes,
                    }}
                  />
                </div>

                <div className="flex flex-col gap-1.5 border-t border-line/60 pt-3">
                  {opexLines.map((l) => (
                    <div key={l.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span>
                        {l.label}{" "}
                        <span className="text-xs text-ink-faint">
                          (έτη {l.from_operating_year}
                          {l.to_operating_year ? `–${l.to_operating_year}` : "+"})
                        </span>
                      </span>
                      <div className="flex items-center gap-1.5">
                        <OpexLineFormModal
                          action={saveOpexLine.bind(null, id, scenario.id, l.id)}
                          trigger="Επεξεργασία"
                          initial={{
                            kind: l.kind,
                            label: l.label,
                            from_operating_year: l.from_operating_year,
                            to_operating_year: l.to_operating_year,
                            headcount: l.headcount,
                            monthly_wage: l.monthly_wage,
                            salaries_per_year: l.salaries_per_year,
                            employer_contribution_pct: l.employer_contribution_pct,
                            premium_pct: l.premium_pct,
                            months_active: l.months_active,
                            pct_of_revenue: l.pct_of_revenue,
                            annual_amount: l.annual_amount,
                            note: l.note,
                          }}
                        />
                        <form action={deleteOpexLine.bind(null, id, l.id)}>
                          <Button type="submit" variant="danger" className="!px-2 !py-1 text-xs">
                            Διαγραφή
                          </Button>
                        </form>
                      </div>
                    </div>
                  ))}
                  <div>
                    <OpexLineFormModal action={saveOpexLine.bind(null, id, scenario.id, null)} />
                  </div>
                </div>
              </>
            )}
          </div>
        </OnePagerSection>

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

        {/* ΤΑΜΕΙΑΚΗ ΡΟΗ — headline resilience KPIs; the full year-by-year
            table and chart are a future tab, not this one-pager. */}
        {cashflow && (
          <OnePagerSection
            title="ΤΑΜΕΙΑΚΗ ΡΟΗ"
            subtitle={`${cashflow.years.length}-ετής προβολή · κάλυψη δόσης τράπεζας ≥ ${scenario?.dscr_covenant_min ?? 1.2}×`}
          >
            {cashflow.kpis.firstAmortisationYearDscr && (
              <OnePagerRow
                label="Κάλυψη δόσης — πρώτο έτος χρεολυσίου"
                amount={`${cashflow.kpis.firstAmortisationYearDscr.value.toFixed(2)}×`}
                note={`${cashflow.kpis.firstAmortisationYearDscr.calendarYear}`}
              />
            )}
            {cashflow.kpis.minDscr && (
              <OnePagerRow
                label="Χαμηλότερη κάλυψη δόσης"
                amount={`${cashflow.kpis.minDscr.value.toFixed(2)}×`}
                note={`${cashflow.kpis.minDscr.calendarYear}`}
                negative={cashflow.kpis.minDscr.value < (scenario?.dscr_covenant_min ?? 1.2)}
              />
            )}
            <OnePagerRow
              label="Σωρευτική ταμειακή ροή"
              amount={cashflow.kpis.cumulativeTotal}
              note={`Έως ${cashflow.years[cashflow.years.length - 1]?.calendarYear ?? ""}.`}
            />
            <OnePagerRow
              label="Καθαρή Παρούσα Αξία"
              amount={cashflow.kpis.npv}
              emphasis
              note={`Προεξοφλημένη ροή μετά την εξυπηρέτηση δανείου, χωρίς την αρχική επένδυση — @${((Number(scenario?.discount_rate_pct ?? 0.09)) * 100).toFixed(0)}%.`}
            />
            {cashflow.kpis.covenantBreaches.length > 0 && (
              <OnePagerRow
                label="Έτη κάτω από την απαίτηση τράπεζας"
                amount={cashflow.kpis.covenantBreaches.map((b) => b.calendarYear).join(", ")}
                negative
              />
            )}
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

        {/* ΠΑΡΟΧΕΣ — supply/contract/RF numbers; payments quoting them are
            attributed to this property automatically (0027 + v_property_monthly_cost). */}
        <OnePagerSection title="ΠΑΡΟΧΕΣ" subtitle="Ρεύμα, νερό, internet — αριθμοί παροχής για αυτόματη αντιστοίχιση πληρωμών.">
          {(utilities ?? []).map((u) => (
            <div key={u.id} className="flex flex-wrap items-center gap-2 border-t border-line py-1.5 text-sm first:border-t-0">
              <span className="w-28 text-ink-muted">{UTILITY_KIND_LABELS[u.kind]}</span>
              <span className="flex-1">
                {u.provider && <span>{u.provider} · </span>}
                <span className="font-mono">{u.supply_number ?? "—"}</span>
                {u.rf_code && <span className="ml-2 font-mono text-xs text-ink-faint">{u.rf_code}</span>}
              </span>
              <UtilityFormModal
                action={saveUtility.bind(null, id, u.id)}
                trigger="Επεξεργασία"
                initial={{
                  kind: u.kind,
                  provider: u.provider,
                  supply_number: u.supply_number,
                  contract_account: u.contract_account,
                  rf_code: u.rf_code,
                  meter_number: u.meter_number,
                  notes: u.notes,
                }}
              />
              <form action={deleteUtility.bind(null, id, u.id)}>
                <Button type="submit" variant="danger" className="!px-2 !py-1 text-xs">
                  {el.common.delete}
                </Button>
              </form>
            </div>
          ))}
          {(utilities ?? []).length === 0 && (
            <p className="py-1 text-sm text-ink-muted">Δεν έχουν καταχωρηθεί παροχές.</p>
          )}
          <div className="pt-2">
            <UtilityFormModal action={saveUtility.bind(null, id, null)} />
          </div>
        </OnePagerSection>

        {monthlyCostList.length > 0 && (
          <OnePagerSection title="ΚΟΣΤΟΣ ΛΕΙΤΟΥΡΓΙΑΣ ΑΝΑ ΜΗΝΑ" subtitle="Ενοίκιο, παροχές, κοινόχρηστα — τελευταίοι 12 μήνες.">
            {monthlyCostList.map(([month, amount]) => (
              <OnePagerRow
                key={month}
                label={formatDate(month).slice(3)}
                amount={amount}
                href={`/properties?month=${month.slice(0, 7)}`}
              />
            ))}
          </OnePagerSection>
        )}

        {/* ΚΑΤΑΣΤΑΣΗ -- always rendered now (not gated on notes.length), so
            "+ Σημείωση" is reachable even with zero open notes. Previously
            only writable through the Kansha AI chat's propose-and-approve
            flow; StatusNotes only ever displayed, never edited. */}
        <OnePagerSection title="ΚΑΤΑΣΤΑΣΗ">
          <StatusNotes
            notes={(notes ?? []) as ProjectNote[]}
            renderActions={(n) => (
              <>
                <ProjectNoteFormModal
                  action={saveProjectNote.bind(null, id, n.id)}
                  trigger="Επεξεργασία"
                  initial={{
                    kind: n.kind,
                    severity: n.severity,
                    body: n.body,
                    exposure_amount: n.exposure_amount,
                    due_date: n.due_date,
                  }}
                />
                <form action={resolveProjectNote.bind(null, id, n.id)}>
                  <Button type="submit" variant="secondary" className="!px-2 !py-1 text-xs">
                    Επίλυση
                  </Button>
                </form>
              </>
            )}
            footer={
              <div className="pt-1">
                <ProjectNoteFormModal action={saveProjectNote.bind(null, id, null)} />
              </div>
            }
          />
        </OnePagerSection>
      </div>

      {leaseSchedule && leaseSchedule.diagnostics.length > 0 && (
        <Card className="border-amber-ink/40 bg-amber-bg">
          <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-amber-ink">
            <AiSpark />
            Σημειώσεις μοντέλου
          </div>
          <ul className="list-disc pl-4 text-xs text-amber-ink">
            {leaseSchedule.diagnostics.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
