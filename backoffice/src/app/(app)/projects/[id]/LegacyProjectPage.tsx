import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDate, formatMoney, formatMultiple } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { AiSpark, Button, GlancePanel, MetaList, Notice, PageHeader, ReportHistory, Stat } from "@/components/ui";
import { ArgsActionForm } from "@/components/ArgsActionForm";
import { OnePagerSection, StatusNotes, type ProjectNote } from "@/components/onepager";
import { computeScenarioFromInputs, loadProjectFlows, loadScenarioInputs } from "@/lib/finance/projectModel";
import { computeDevelopmentResult } from "@/lib/finance/development";
import { projectBlocks, splitNotes, type ProjectAddition } from "@/lib/projects/projectPage";
import { selectScenario } from "@/lib/projects/scenarioCode";
import { BudgetSection, DevelopmentSection, LeaseSyncButton, PropertySection } from "./FinanceSections";
import { LoanSection, RevenueSection } from "./FundingSections";
import { CashflowSection, OperationSection, ScenarioBar } from "./ScenarioSections";
import { aiEnabled } from "@/lib/ai/client";
import { ProjectHealthCheck } from "./ProjectHealthCheck";
import { PartnersPanel } from "./PartnersPanel";
import { getAccessContext } from "@/lib/supabase/access";
import {
  BudgetFormModal,
  LoanFormModal,
  ProjectFormModal,
  ProjectNoteFormModal,
  ScenarioFormModal,
  UtilityFormModal,
} from "../LegacyFormModals";
import type { ProjectInitial } from "../fields";
import { saveLoan, saveProjectBudget, saveUtility } from "./finance-actions";
import { resolveProjectNote, saveProjectNote, updateProject } from "../actions";
import { saveScenario } from "./scenario-actions";
import { addMonths, currentMonthKey, firstOfMonth, todayAthens } from "@/lib/dates";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { ProjectPlanSection } from "@/components/planner/ProjectPlanSection";
import { plannerCapabilities } from "@/lib/planner/access";

// Σύνοψη Έργου -- the one-pager, modelled on the layout the Q004 workbook
// already proved works: blocks of label / figure / explanatory note, bold
// totals, and the ΚΑΤΑΣΤΑΣΗ block at the end. Every figure here is derived
// (from budget_lines, the ledger, the lease and the scenario); nothing is
// restated from the spreadsheet.
//
// «Σύνοψη + ανάπτυξη»: the header (two buttons and a line of links), the
// scenario bar, then up to eight blocks in two columns -- ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ,
// ΑΝΑΠΤΥΞΗ, ΕΣΟΔΑ, ΔΑΝΕΙΟ, ΛΕΙΤΟΥΡΓΙΑ, ΤΑΜΕΙΑΚΗ ΡΟΗ, ΑΚΙΝΗΤΟ, ΚΑΤΑΣΤΑΣΗ.
// Each shows three or four figures, each figure once on the page; the
// details open with one click on «▸ … (N)» (ReportHistory, closed), and a
// block's own add / edit buttons sit beside its title. A block with nothing
// in it is not rendered: what it would let you add is offered once, on the
// closing «Προσθήκη:» line (lib/projects/projectPage.ts), above the Πλάνο
// and Συνεργάτες summary lines.
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
    // (projectModel.ts). All scenarios, for the scenario bar and ?s=.
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
    // Paid income: ΕΣΟΔΑ's «Έσοδα έως σήμερα».
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

  // Lease, loans and the scenarios (projectModel.ts): the scenario bar,
  // ΛΕΙΤΟΥΡΓΙΑ and ΤΑΜΕΙΑΚΗ ΡΟΗ all come from computeScenarioFromInputs()
  // -- the same function the comparison page and «Στείλε στο ταμείο» use.
  const lease = inputs?.lease ?? null;
  const leaseSchedule = inputs?.leaseSchedule ?? null;
  const loanRows = inputs?.loans ?? [];
  const scenarioResults = inputs
    ? inputs.scenarios.map((sc) => ({ scenario: sc, result: computeScenarioFromInputs(inputs, sc) }))
    : [];
  const scenarioResult = scenarioResults.find((r) => r.scenario.id === selectedScenarioId)?.result ?? null;

  // «IRR έργου (χωρίς ΦΠΑ)» -- every project flow net of VAT and before
  // financing -- paid, still open and expected -- plus the budget not yet
  // committed (development.ts). In ΑΝΑΠΤΥΞΗ or in ΕΣΟΔΑ, once.
  const revenueToDate = (projectIncomeTx ?? []).reduce((s, t) => s + Number(t.gross_amount ?? 0), 0);
  const development = computeDevelopmentResult(projectFlows.flows, {
    today,
    remainingBudget: hasBudget ? Math.max(0, Number(rollup.remaining_budget ?? 0)) : 0,
  });

  const linkedPlans = (revenuePlanOptions ?? []).filter((p) => p.project_id === id);
  const settlements = settlementPlans ?? [];
  const settlementMonthly = settlements.reduce((s, p) => s + Number(p.amount_per_installment ?? 0), 0);
  // The first lease year's monthly rent: ΑΚΙΝΗΤΟ's «Κόστος χρήσης / μήνα».
  const monthlyRent = leaseSchedule?.rows[0]?.monthlyAmount ?? 0;
  const openNotes = (notes ?? []) as ProjectNote[];

  // ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ, from the same v_project_rollup columns as the projects
  // list and the overview's portfolio (total_budget, capex_paid,
  // capex_committed, remaining_budget).
  const figures = {
    budget: hasBudget ? Number(rollup.total_budget ?? 0) : null,
    paid: Number(rollup.capex_paid ?? 0),
    committed: Number(rollup.capex_committed ?? 0),
    remaining: Number(rollup.remaining_budget ?? 0),
    unclassified: Number(rollup.unclassified_spend ?? 0),
    occupancy: Number(rollup.occupancy_cost ?? 0),
    otherOpex: Number(rollup.other_opex ?? 0),
  };
  const blocks = projectBlocks({
    businessModel: rollup.business_model,
    hasBudget,
    hasSpend:
      figures.paid !== 0 || figures.committed !== 0 || figures.occupancy !== 0 || figures.otherOpex !== 0 || figures.unclassified !== 0,
    developmentFlows: development.revenue !== 0 || development.cost !== 0,
    contractValue: project?.contract_value != null ? Number(project.contract_value) : null,
    revenueToDate,
    irr: development.irr,
    loans: loanRows.length,
    hasScenario: scenario != null,
    revenuePlans: linkedPlans.length,
    hasCashflow: scenarioResult?.cashflow != null,
    utilities: (utilities ?? []).length,
    occupancyPerMonth: monthlyRent + settlementMonthly,
    costMonths: monthlyCostList.length,
    openNotes: openNotes.length,
  });
  const anyBlock =
    blocks.budget || blocks.development || blocks.revenue || blocks.loan || blocks.operation || blocks.cashflow || blocks.property || blocks.status;

  const projectInitial: ProjectInitial = {
    code: rollup.code ?? undefined,
    display_name: rollup.display_name ?? undefined,
    project_type: project?.project_type ?? null,
    status: rollup.status ?? undefined,
    business_model: rollup.business_model ?? null,
    start_date: project?.start_date ?? null,
    contract_value: project?.contract_value ?? null,
    contract_signed_date: project?.contract_signed_date ?? null,
  };

  // «Με μια ματιά»: the navy panel at the top, as on the overview -- the
  // budget and what is left of it, then the selected scenario's year result
  // and NPV. Only the figures this project has; none of them is new (the
  // same numbers as ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ and the scenario bar).
  const ts = el.projectScenarios;
  const scenarioName = scenarioResults.find((r) => r.scenario.id === selectedScenarioId)?.scenario.name ?? null;
  const glance = [
    figures.budget != null && {
      label: el.project.budget,
      value: formatMoney(figures.budget),
      sub: `Πληρωμένα ${formatMoney(figures.paid)} · Δεσμευμένα ${formatMoney(figures.committed)}`,
    },
    figures.budget != null && {
      label: "Υπόλοιπο",
      value: formatMoney(figures.remaining),
      sub: figures.remaining < 0 ? "εκτός προϋπολογισμού" : "διαθέσιμο από τον προϋπολογισμό",
    },
    figures.budget == null && revenueToDate !== 0 && { label: "Έσοδα έως σήμερα", value: formatMoney(revenueToDate), sub: null },
    scenarioResult?.hasOperation && {
      label: ts.operatingResult,
      value: formatMoney(scenarioResult.operatingResult),
      sub: scenarioName ? `σενάριο «${scenarioName}»` : null,
    },
    scenarioResult?.cashflow && {
      label: ts.npv,
      value: formatMoney(scenarioResult.cashflow.kpis.npv),
      sub:
        scenarioResult.cashflow.kpis.minDscr?.value != null
          ? `${ts.minDscr} ${formatMultiple(scenarioResult.cashflow.kpis.minDscr.value)}`
          : null,
    },
  ].filter((g): g is { label: string; value: string; sub: string | null } => Boolean(g));

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
          <div className="flex flex-col gap-1">
            <MetaList
              items={[
                rollup.code,
                project?.units ? `${project.units} μονάδες` : null,
                lease ? `μίσθωση ${lease.term_years} ετών` : null,
                project?.opening_date ? `άνοιγμα ${formatDate(project.opening_date)}` : null,
                project?.phase,
              ]}
            />
            <ProjectLinks id={id} leaseId={lease?.kind === "indexed_rent" ? lease.id : null} />
          </div>
        }
        actions={
          <>
            {aiEnabled() && <ProjectHealthCheck projectId={id} />}
            <ProjectFormModal action={updateProject} args={[id]} initial={projectInitial} />
            <BudgetFormModal
              action={saveProjectBudget}
              args={[id]}
              initial={
                budget
                  ? {
                      contingency_pct: budget.contingency_pct ?? 0,
                      lines: Object.fromEntries(lines.map((l) => [l.line_code, Number(l.amount)])),
                    }
                  : undefined
              }
            />
          </>
        }
      >
        {/* The AI health check's answer opens here (ProjectHealthCheck). */}
        {aiEnabled() && <div id="project-health" className="empty:hidden" />}
      </PageHeader>

      {glance.length >= 2 && (
        <GlancePanel>
          <div className="grid grid-cols-2 gap-x-6 gap-y-5 xl:grid-cols-4">
            {glance.map((g) => (
              <Stat key={g.label} onPanel label={g.label} value={g.value} sub={g.sub} />
            ))}
          </div>
        </GlancePanel>
      )}

      {/* The scenario bar: every scenario one click away (?s=), the
          selected one's figures and actions -- the blocks below show and
          edit it. */}
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
      {anyBlock && (
        <div className="flex flex-col gap-6 lg:block lg:columns-2 lg:gap-6 lg:*:mb-6 lg:*:last:mb-0">
          {blocks.budget && <BudgetSection projectId={id} figures={figures} lines={budgetLines ?? []} />}

          {blocks.development && <DevelopmentSection result={development} truncated={projectFlows.truncated} />}

          {blocks.revenue && (
            <RevenueSection
              projectId={id}
              contractValue={project?.contract_value != null ? Number(project.contract_value) : null}
              signedDate={project?.contract_signed_date ?? null}
              revenueToDate={revenueToDate}
              irr={development.irr}
              showIrr={blocks.revenueIrr}
            />
          )}

          {blocks.loan && <LoanSection projectId={id} loans={loanRows} schedule={inputs?.loanSchedule ?? null} />}

          {blocks.operation && (
            <OperationSection
              projectId={id}
              scenario={scenario}
              result={scenarioResult}
              scenarioCount={scenarioResults.length}
              plans={linkedPlans}
              planOptions={revenuePlanOptions ?? []}
              ai={aiEnabled()}
            />
          )}

          {blocks.cashflow && scenario && scenarioResult?.cashflow && (
            <CashflowSection
              projectId={id}
              scenarioId={scenario.id}
              cashflow={scenarioResult.cashflow}
              covenant={Number(scenario.dscr_covenant_min ?? 1.2)}
              sentToCash={sentToCash ?? 0}
            />
          )}

          {blocks.property && (
            <PropertySection
              projectId={id}
              monthlyRent={monthlyRent}
              settlements={settlements}
              utilities={utilities ?? []}
              months={monthlyCostList}
            />
          )}

          {blocks.status && <StatusSection projectId={id} notes={openNotes} />}
        </div>
      )}

      {/* «Προσθήκη:» (only what is missing), then ΠΛΑΝΟ ΕΡΓΟΥ and the
          partners: one summary line each. The full block (milestones,
          partner management) opens in place with ?show=, and only then is
          its data loaded. */}
      <div className="flex flex-col border-t border-hairline">
        {blocks.additions.length > 0 && <AdditionsLine projectId={id} additions={blocks.additions} projectInitial={projectInitial} />}
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
        // Full width: the engine's notes are a line or two, not a column.
        <Notice as="aside" tone="warning" className="flex flex-col gap-1.5">
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

// Under the header's facts, one visible line: «Κινήσεις → · Πλάνο →
// · Συνεργασία →», and «Συγχρονισμός μισθωμάτων» for an indexed rent.
function ProjectLinks({ id, leaseId }: { id: string; leaseId: string | null }) {
  const t = el.projectPage.links;
  const link = "inline-flex items-center text-ink underline-offset-4 hover:underline max-md:min-h-11";
  return (
    <div className="flex flex-wrap items-center gap-x-2">
      <Link href={`/transactions?project_id=${id}`} className={link}>
        {t.transactions} →
      </Link>
      <span aria-hidden="true">·</span>
      <Link href={`/planner?project=${id}`} className={link}>
        {t.planner} →
      </Link>
      <span aria-hidden="true">·</span>
      <Link href={`/collab/${id}`} className={link}>
        {t.collab} →
      </Link>
      {leaseId && (
        <>
          <span aria-hidden="true">·</span>
          <LeaseSyncButton leaseId={leaseId} />
        </>
      )}
    </div>
  );
}

// ΚΑΤΑΣΤΑΣΗ: the urgent and watch notes in view, each with «Επεξεργασία» /
// «Επίλυση»; the information notes behind «▸ Λοιπές (N)»; «+ Σημείωση»
// beside the title. Only rendered with open notes (otherwise «+ Σημείωση»
// is on the «Προσθήκη:» line).
function StatusSection({ projectId: id, notes }: { projectId: string; notes: ProjectNote[] }) {
  const t = el.projectPage.status;
  const { pressing, rest } = splitNotes(notes);
  const noteActions = (n: ProjectNote) => (
    <>
      <ProjectNoteFormModal
        action={saveProjectNote}
        args={[id, n.id]}
        initial={{
          kind: n.kind,
          severity: n.severity,
          body: n.body,
          exposure_amount: n.exposure_amount,
          due_date: n.due_date,
        }}
      />
      <ArgsActionForm action={resolveProjectNote} args={[id, n.id]}>
        <Button type="submit" variant="secondary" size="sm">
          {t.resolve}
        </Button>
      </ArgsActionForm>
    </>
  );
  return (
    <OnePagerSection title={t.title} actions={<ProjectNoteFormModal action={saveProjectNote} args={[id, null]} />}>
      {pressing.length > 0 && <StatusNotes notes={pressing} renderActions={noteActions} />}
      {rest.length > 0 && (
        <ReportHistory level={3} title={t.rest} count={rest.length} open>
          <StatusNotes notes={rest} renderActions={noteActions} />
        </ReportHistory>
      )}
    </OnePagerSection>
  );
}

// «Προσθήκη: + Δάνειο · + Σύμβαση πελάτη · + Παροχή · + Σενάριο
// λειτουργίας · + Σημείωση» -- only what is missing; each opens the same
// drawer its block would.
function AdditionsLine({
  projectId: id,
  additions,
  projectInitial,
}: {
  projectId: string;
  additions: ProjectAddition[];
  projectInitial: ProjectInitial;
}) {
  const t = el.projectPage;
  const look = { variant: "ghost", size: "sm" } as const;
  const button = (a: ProjectAddition) => {
    switch (a) {
      case "loan":
        return <LoanFormModal action={saveLoan} args={[id, null]} {...look} />;
      case "contract":
        return (
          <ProjectFormModal
            action={updateProject}
            args={[id]}
            initial={projectInitial}
            trigger={t.addContract}
            title={t.contractTitle}
            {...look}
          />
        );
      case "utility":
        return <UtilityFormModal action={saveUtility} args={[id, null]} {...look} />;
      case "scenario":
        return <ScenarioFormModal action={saveScenario} args={[id, null]} {...look} />;
      case "note":
        return <ProjectNoteFormModal action={saveProjectNote} args={[id, null]} {...look} />;
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-x-1 border-b border-hairline py-1 text-body">
      <span className="font-medium text-ink">{t.add}:</span>
      {additions.map((a, i) => (
        <span key={a} className="inline-flex items-center gap-x-1">
          {i > 0 && (
            <span aria-hidden="true" className="text-muted">
              ·
            </span>
          )}
          {button(a)}
        </span>
      ))}
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
