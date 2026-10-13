import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, Button, ButtonLink, MetaList, Notice, PageHeader, Select, AiSpark } from "@/components/ui";
import { OnePagerSection, OnePagerRow, StatusNotes, type ProjectNote } from "@/components/onepager";
import { computeScenarioFromInputs, loadProjectFlows, loadScenarioInputs } from "@/lib/finance/projectModel";
import { computeDevelopmentResult } from "@/lib/finance/development";
import { BudgetLineRows, DevelopmentSection, LeaseSyncButton } from "./FinanceSections";
import { FundingSections } from "./FundingSections";
import { ScenarioBar, ScenarioSections } from "./ScenarioSections";
import { aiEnabled } from "@/lib/ai/client";
import { ProjectHealthCheck } from "./ProjectHealthCheck";
import { PartnersPanel } from "./PartnersPanel";
import { getAccessContext } from "@/lib/supabase/access";
import { BudgetFormModal } from "../LegacyFormModals";
import { saveProjectBudget } from "./finance-actions";
import { ProjectFormModal } from "../LegacyFormModals";
import { updateProject } from "../actions";
import { addMonths, currentMonthKey, firstOfMonth, todayAthens } from "@/lib/dates";
import { getCurrentOrgId } from "@/lib/supabase/org";

import { ProjectNoteFormModal } from "../LegacyFormModals";
import { ProjectPlanSection } from "@/components/planner/ProjectPlanSection";
import { plannerCapabilities } from "@/lib/planner/access";
import { UtilityFormModal, UTILITY_KIND_LABELS } from "../LegacyFormModals";
import { saveUtility, deleteUtility } from "./finance-actions";
import { saveProjectNote, resolveProjectNote } from "../actions";
import { setScenarioRevenuePlan } from "./scenario-actions";
import { selectScenario } from "@/lib/projects/scenarioCode";
import { fillText } from "@/lib/collab/text";
import { AiCreateForm } from "../revenue-plans/AiCreateForm";
import { RowDeleteMenu } from "@/components/RowDeleteMenu";
import { ManualPlanForm } from "../revenue-plans/ManualPlanForm";

// Σύνοψη Έργου -- the one-pager, modelled on the layout the Q004 workbook
// already proved works: blocks of label / figure / explanatory note, bold
// totals, and the ΚΑΤΑΣΤΑΣΗ block at the end. Every figure here is derived
// (from budget_lines, the ledger, the lease and the scenario); nothing is
// restated from the spreadsheet.
//
// Blocks render only when their data exists, so the six thin projects degrade
// to just ΕΠΕΝΔΥΣΗ + ΠΟΡΕΙΑ without looking unfinished.
export async function LegacyProjectPage({
  id,
  requestedScenario,
  show,
}: {
  id: string;
  requestedScenario?: string | string[];
  // ?show=plan | partners: the full planner block or partner management
  // in place of its one summary line (loaded only then).
  show?: "plan" | "partners";
}) {
  const supabase = await createClient();
  const access = await getAccessContext();
  const isOrgAdmin =
    access.kind === "internal" && (access.membership.role === "admin" || access.membership.role === "owner");

  const [
    { data: rollup },
    { data: project },
    { data: budget },
    inputs,
    { data: notes },
    { data: settlementPlans },
    { data: noBudgetRow },
    { data: budgetLines },
    { data: revenuePlanOptions },
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
    // Lease, loans, every scenario and their revenue plans: one loader
    // shared with the comparison page and «Στείλε στο ταμείο»
    // (projectModel.ts). All scenarios, for the «Σενάρια» list and ?s=.
    loadScenarioInputs(supabase, id),
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
      .from("v_project_budget_lines")
      .select("line_code, label, budget, paid, committed, remaining")
      .eq("project_id", id),
    getCurrentOrgId(supabase).then((orgId) =>
      supabase.from("revenue_plans").select("id, name, project_id, start_year, years").eq("org_id", orgId).order("name"),
    ),
    // Paid income: «Τιμολογημένα» and «Έσοδα έργου μέχρι σήμερα».
    supabase
      .from("transactions")
      .select("tx_date, gross_amount")
      .eq("project_id", id)
      .eq("direction", "income")
      .eq("status", "paid"),
  ]);

  const twelveMonthsAgo = firstOfMonth(addMonths(currentMonthKey(), -11));
  const today = todayAthens();
  // The scenario the page shows and edits: ?s= or the base (not simply the
  // first row). «Στείλε στο ταμείο» and the revenue-plan link act on it.
  const scenario = selectScenario(inputs?.scenarios ?? [], requestedScenario);
  const selectedScenarioId = scenario?.id ?? null;
  const [
    { data: utilities },
    { data: monthlyCostRows },
    projectFlows,
    { count: sentToCash },
    { data: nextMilestone },
    { count: openTasks },
    { count: partnerCount },
  ] = await Promise.all([
    supabase.from("property_utilities").select("*").eq("project_id", id).order("kind"),
    supabase
      .from("v_property_monthly_cost")
      .select("month, paid_amount")
      .eq("project_id", id)
      .gte("month", twelveMonthsAgo),
    loadProjectFlows(supabase, id, today),
    selectedScenarioId
      ? supabase
          .from("expected_income")
          .select("id", { count: "exact", head: true })
          .eq("scenario_id", selectedScenarioId)
          .eq("status", "expected")
      : Promise.resolve({ count: 0 }),
    // The «Πλάνο» summary line: the next milestone and the open tasks
    // (a head count), and the «Συνεργάτες» line: the members (a head count).
    supabase
      .from("project_milestones")
      .select("title, due_date")
      .eq("project_id", id)
      .is("done_at", null)
      .gte("due_date", today)
      .order("due_date")
      .limit(1)
      .maybeSingle(),
    supabase
      .from("tasks")
      .select("id", { count: "exact", head: true })
      .eq("project_id", id)
      .is("archived_at", null)
      .neq("status", "done"),
    supabase.from("project_members").select("user_id", { count: "exact", head: true }).eq("project_id", id),
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

  // Lease, loans and the scenarios (projectModel.ts): the «Σενάρια» list,
  // ΛΕΙΤΟΥΡΓΙΑ and ΤΑΜΕΙΑΚΗ ΡΟΗ below all come from computeScenarioFromInputs()
  // -- the same function the comparison page and «Στείλε στο ταμείο» use.
  const lease = inputs?.lease ?? null;
  const leaseSchedule = inputs?.leaseSchedule ?? null;
  const loanRows = inputs?.loans ?? [];
  const loanSchedule = inputs?.loanSchedule ?? null;
  const scenarioResults = inputs
    ? inputs.scenarios.map((sc) => ({ scenario: sc, result: computeScenarioFromInputs(inputs, sc) }))
    : [];
  const scenarioResult = scenarioResults.find((r) => r.scenario.id === selectedScenarioId)?.result ?? null;
  const firstYearRent = leaseSchedule?.rows[0];

  // Απόδοση: «IRR έργου (χωρίς ΦΠΑ)» -- every project flow net of VAT and
  // before financing -- paid, still open and expected -- plus the budget not
  // yet committed (development.ts).
  const revenueToDate = (projectIncomeTx ?? []).reduce((s, t) => s + Number(t.gross_amount ?? 0), 0);
  const development = computeDevelopmentResult(projectFlows.flows, {
    today,
    remainingBudget: hasBudget ? Math.max(0, Number(rollup.remaining_budget ?? 0)) : 0,
  });
  const projectIrr = development.irr;

  const annualRent = scenarioResult?.annualRent ?? firstYearRent?.annualAmount ?? 0;
  const linkedPlans = (revenuePlanOptions ?? []).filter((p) => p.project_id === id);

  const settlementMonthly = (settlementPlans ?? []).reduce(
    (s, p) => s + Number(p.amount_per_installment ?? 0),
    0,
  );
  const monthlyRent = firstYearRent?.monthlyAmount ?? 0;
  // This page as it is now (the scenario kept unless it is the base): the
  // summary lines' «Ορόσημα» / «Διαχείριση» / «Κλείσιμο» links add or drop
  // ?show= on it.
  const pageHref = scenario && !scenario.is_base ? `/projects/${id}?s=${scenario.id}` : `/projects/${id}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow={el.nav.projects}
        title={rollup.display_name}
        meta={
          <MetaList
            items={[
              rollup.code,
              project?.units ? `${project.units} μονάδες` : null,
              lease ? `μίσθωση ${lease.term_years} ετών` : null,
              project?.opening_date ? `άνοιγμα ${formatDate(project.opening_date)}` : null,
              project?.phase,
            ]}
          />
        }
        actions={
          <>
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
          <ButtonLink href={`/transactions?project_id=${id}`}>
            {el.nav.transactions}
          </ButtonLink>
          <ButtonLink href={`/projects/${id}/compare`}>
            {el.projectScenarios.compare}
          </ButtonLink>
          <ButtonLink href={`/planner?project=${id}`}>
            {el.nav.planner}
          </ButtonLink>
          <ButtonLink href={`/collab/${id}`}>
            {el.collab.navLabel}
          </ButtonLink>
          {lease?.kind === "indexed_rent" && <LeaseSyncButton leaseId={lease.id} />}
          </>
        }
      >
        {aiEnabled() && <ProjectHealthCheck projectId={id} />}
      </PageHeader>

      {/* The scenario bar: every scenario one click away (?s=), the
          selected one's figures and actions -- the blocks below show and
          edit it. Replaces the old «Σενάρια» list mid-page. */}
      <ScenarioBar
        projectId={id}
        selectedId={selectedScenarioId}
        scenarios={scenarioResults.map(({ scenario: sc, result }) => ({
          id: sc.id,
          name: sc.name,
          isBase: sc.is_base,
          operatingResult: result.hasOperation ? result.operatingResult : null,
          npv: result.cashflow?.kpis.npv ?? null,
          minDscr: result.cashflow?.kpis.minDscr?.value ?? null,
        }))}
      />

      {/* Two balanced columns (CSS columns: the blocks keep the 7 Oct
          order, down the first column then the second, and never split --
          OnePagerSection is break-inside-avoid). One column on a phone. */}
      <div className="flex flex-col gap-6 lg:block lg:columns-2 lg:gap-6 lg:*:mb-6">
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
            <div className="flex flex-col items-start gap-2 border-b border-hairline py-3">
              <Badge tone="warning">Χωρίς προϋπολογισμό</Badge>
              <p className="text-body text-muted">
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
              alert={Number(rollup.remaining_budget ?? 0) < 0}
              emphasis
            />
          )}
          {hasBudget && <BudgetLineRows rows={budgetLines ?? []} />}
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

        {rollup.business_model === "own_development" && (
          <DevelopmentSection result={development} truncated={projectFlows.truncated} />
        )}

        {/* ΣΥΜΒΑΣΗ ΠΕΛΑΤΗ — the revenue baseline client_project work never
            had: the agreed contract value, billed to date (paid income
            transactions on this project, same figure as «Απόδοση»'s
            revenueToDate), and what's left to invoice. Renders
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
              alert={Number(project.contract_value) - revenueToDate < 0}
              emphasis
            />
          </OnePagerSection>
        )}

        <FundingSections
          projectId={id}
          loans={loanRows}
          loanSchedule={loanSchedule}
          revenueToDate={revenueToDate}
          projectIrr={projectIrr}
        />

        {/* Αναλύσεις Εσόδων -- a project can have several (conservative /
            optimistic scenarios, revisions over time), previously only
            reachable one-at-a-time through whichever plan happened to be
            wired into the scenario, with no way to browse or create one
            scoped to this project. Creation (AI or by hand) sits behind one
            «+ Νέα ανάλυση εσόδων», open while the project has none; then
            the browsable list, then which one feeds the ΛΕΙΤΟΥΡΓΙΑ below. */}
        <OnePagerSection title="Αναλύσεις Εσόδων">
          <div className="flex flex-col gap-3 pt-1">
            <details open={linkedPlans.length === 0} className="border-b border-hairline">
              <summary className="flex min-h-10 cursor-pointer items-center text-body text-ink hover:underline">
                {el.projectSummary.newRevenuePlan}
              </summary>
              <div className="flex flex-col gap-3 pb-3">
                {aiEnabled() && <AiCreateForm projectId={id} />}
                <ManualPlanForm projectId={id} />
              </div>
            </details>

            {linkedPlans.length === 0 ? (
              <p className="text-body text-muted">Καμία ανάλυση εσόδων ακόμα για αυτό το έργο.</p>
            ) : (
              <ul className="flex flex-col border-t border-hairline">
                {linkedPlans.map((p) => (
                  <li key={p.id}>
                    <Link
                      href={`/projects/revenue-plans/${p.id}`}
                      className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-hairline py-2 text-body text-ink hover:bg-hover"
                    >
                      <span className="underline-offset-4 hover:underline">{p.name}</span>
                      <span className="text-small text-muted">
                        <span className="num">
                          {p.start_year}–{p.start_year + p.years - 1}
                        </span>
                        {scenario?.revenue_plan_id === p.id && " · ενεργή στη ΛΕΙΤΟΥΡΓΙΑ"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}

            {scenario && (
              <form
                key={scenario.id}
                action={setScenarioRevenuePlan.bind(null, id, scenario.id)}
                className="flex flex-wrap items-end gap-3"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <label htmlFor="scenario-revenue-plan" className="text-small text-muted">
                    {scenarioResults.length > 1
                      ? fillText(el.projectScenarios.feedsScenario, { name: scenario.name })
                      : "Ποια τροφοδοτεί τη ΛΕΙΤΟΥΡΓΙΑ παρακάτω"}
                  </label>
                  <Select
                    id="scenario-revenue-plan"
                    name="revenue_plan_id"
                    defaultValue={scenario.revenue_plan_id ?? ""}
                    className="max-w-full max-md:min-h-11"
                  >
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

        <ScenarioSections
          projectId={id}
          scenario={scenario}
          result={scenarioResult}
          annualRent={annualRent}
          monthlyRent={monthlyRent}
          sentToCash={sentToCash ?? 0}
        />

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
            <div
              key={u.id}
              className="flex flex-col gap-2 border-b border-hairline py-2 text-body md:flex-row md:flex-wrap md:items-center md:gap-x-3"
            >
              <span className="text-muted md:w-28">{UTILITY_KIND_LABELS[u.kind]}</span>
              <span className="min-w-0 flex-1 break-words text-ink">
                {u.provider && <span>{u.provider} · </span>}
                <span className="num">{u.supply_number ?? "—"}</span>
                {u.rf_code && <span className="num ml-2 text-small text-muted">{u.rf_code}</span>}
              </span>
              <span className="flex flex-wrap items-center gap-2">
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
              <RowDeleteMenu action={deleteUtility.bind(null, id, u.id)} label="Ενέργειες" plain>
                {el.common.delete}
              </RowDeleteMenu>
              </span>
            </div>
          ))}
          {(utilities ?? []).length === 0 && (
            <p className="border-b border-hairline py-3 text-body text-muted">Δεν έχουν καταχωρηθεί παροχές.</p>
          )}
          <div className="pt-2">
            <UtilityFormModal action={saveUtility.bind(null, id, null)} />
          </div>
        </OnePagerSection>

        {monthlyCostList.length > 0 && (
          <OnePagerSection title="ΚΟΣΤΟΣ ΛΕΙΤΟΥΡΓΙΑΣ ΑΝΑ ΜΗΝΑ" subtitle="Ενοίκιο, παροχές, κοινόχρηστα — τελευταίοι 12 μήνες.">
            {/* Twelve months in a compact grid (newest first), each a link
                to that month's property costs. */}
            <ul className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
              {monthlyCostList.map(([month, amount]) => (
                <li key={month}>
                  <Link
                    href={`/projects/properties?month=${month.slice(0, 7)}`}
                    className="flex min-h-10 items-baseline justify-between gap-3 border-b border-hairline py-2 text-body hover:bg-hover"
                  >
                    <span className="num text-text">{formatDate(month).slice(3)}</span>
                    <span className="num text-ink underline-offset-4 hover:underline">{formatMoney(amount)}</span>
                  </Link>
                </li>
              ))}
            </ul>
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
                  <Button type="submit" variant="secondary" size="sm">
                    Επίλυση
                  </Button>
                </form>
              </>
            )}
            footer={
              <div>
                <ProjectNoteFormModal action={saveProjectNote.bind(null, id, null)} />
              </div>
            }
          />
        </OnePagerSection>
      </div>

      {/* ΠΛΑΝΟ ΕΡΓΟΥ and the partners: one summary line each. The full
          block (milestones, partner management) opens in place with
          ?show=, and only then is its data loaded. */}
      <div className="flex flex-col border-t border-hairline">
        <SummaryLine
          label={el.projectSummary.plan}
          href={`/planner?project=${id}`}
          moreHref={show === "plan" ? pageHref : `${pageHref}${pageHref.includes("?") ? "&" : "?"}show=plan#plan`}
          moreLabel={show === "plan" ? el.projectSummary.close : el.projectSummary.milestones}
        >
          <span className="num">{openTasks ?? 0}</span> {el.planner.openTasks} ·{" "}
          {nextMilestone ? (
            <>
              {el.projectSummary.nextMilestone} {nextMilestone.title}{" "}
              <span className="num">{formatDate(nextMilestone.due_date)}</span>
            </>
          ) : (
            el.projectSummary.noMilestone
          )}
        </SummaryLine>
        <SummaryLine
          label={el.projectSummary.partners}
          href={`/collab/${id}`}
          moreHref={show === "partners" ? pageHref : `${pageHref}${pageHref.includes("?") ? "&" : "?"}show=partners#partners`}
          moreLabel={show === "partners" ? el.projectSummary.close : el.projectSummary.manage}
        >
          <span className="num">{partnerCount ?? 0}</span>
        </SummaryLine>
      </div>

      {show === "plan" && (
        <div id="plan">
          <ProjectPlanSection
            projectId={id}
            canEdit={
              access.kind === "internal" &&
              plannerCapabilities({ kind: "member", role: access.membership.role }).canEditSchedule
            }
          />
        </div>
      )}
      {show === "partners" && (
        <div id="partners">
          <PartnersPanel projectId={id} isAdmin={isOrgAdmin} />
        </div>
      )}

      {leaseSchedule && leaseSchedule.diagnostics.length > 0 && (
        <Notice as="aside" tone="warning" className="flex max-w-prose flex-col gap-1.5">
          <div className="eyebrow flex items-center gap-1.5 text-warning">
            <AiSpark />
            Σημειώσεις μοντέλου
          </div>
          <ul className="list-disc pl-4 text-small text-text">
            {leaseSchedule.diagnostics.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  );
}

// One closing summary line: «Label: what it counts →» (a link to where the
// work lives) and, on the right, the link that opens or closes the full
// block on this page.
function SummaryLine({
  label,
  href,
  moreHref,
  moreLabel,
  children,
}: {
  label: string;
  href: string;
  moreHref: string;
  moreLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 border-b border-hairline text-body">
      <Link href={href} className="inline-flex min-h-10 min-w-0 items-center text-ink underline-offset-4 hover:underline max-md:min-h-11">
        <span>
          <span className="font-medium">{label}:</span> {children} →
        </span>
      </Link>
      <Link
        href={moreHref}
        // Opening scrolls to the block (#plan / #partners); closing stays put.
        scroll={moreHref.includes("#")}
        className="inline-flex min-h-10 items-center text-small text-muted underline-offset-4 hover:text-ink hover:underline max-md:min-h-11"
      >
        {moreLabel}
      </Link>
    </div>
  );
}
