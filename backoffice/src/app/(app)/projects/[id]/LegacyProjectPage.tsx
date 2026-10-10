import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, Card, Button, Select, AiSpark } from "@/components/ui";
import { OnePagerSection, OnePagerRow, StatusNotes, type ProjectNote } from "@/components/onepager";
import { computeScenarioFromInputs, loadProjectFlows, loadScenarioInputs } from "@/lib/finance/projectModel";
import { computeDevelopmentResult } from "@/lib/finance/development";
import { BudgetLineRows, DevelopmentSection, LeaseSyncButton } from "./FinanceSections";
import { FundingSections } from "./FundingSections";
import { ScenarioSections } from "./ScenarioSections";
import { aiEnabled } from "@/lib/ai/client";
import { ProjectHealthCheck } from "./ProjectHealthCheck";
import { PartnersPanel } from "./PartnersPanel";
import { getAccessContext } from "@/lib/supabase/access";
import { BudgetFormModal } from "../LegacyFormModals";
import { saveProjectBudget } from "./finance-actions";
import { ProjectFormModal } from "../LegacyFormModals";
import { updateProject } from "../actions";
import { addMonths, currentMonthKey, currentYear, firstOfMonth, todayAthens } from "@/lib/dates";
import { getCurrentOrgId } from "@/lib/supabase/org";

import { ProjectNoteFormModal } from "../LegacyFormModals";
import { ProjectPlanSection } from "@/components/planner/ProjectPlanSection";
import { UtilityFormModal, UTILITY_KIND_LABELS } from "../LegacyFormModals";
import { saveUtility, deleteUtility } from "./finance-actions";
import { saveProjectNote, resolveProjectNote } from "../actions";
import { setScenarioRevenuePlan } from "./scenario-actions";
import { AiCreateForm } from "../revenue-plans/AiCreateForm";
import { createRevenuePlan } from "../revenue-plans/actions";

// Σύνοψη Έργου -- the one-pager, modelled on the layout the Q004 workbook
// already proved works: blocks of label / figure / explanatory note, bold
// totals, and the ΚΑΤΑΣΤΑΣΗ block at the end. Every figure here is derived
// (from budget_lines, the ledger, the lease and the scenario); nothing is
// restated from the spreadsheet.
//
// Blocks render only when their data exists, so the six thin projects degrade
// to just ΕΠΕΝΔΥΣΗ + ΠΟΡΕΙΑ without looking unfinished.
export async function LegacyProjectPage({ id }: { id: string }) {
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
    // Lease, loans, the base scenario and its revenue plan: one loader shared
    // with the comparison page and «Στείλε στο ταμείο» (projectModel.ts).
    loadScenarioInputs(supabase, id, { baseOnly: true }),
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
    supabase
      .from("project_capital_sources")
      .select("id, kind, contributor, amount, contributed_on, notes")
      .eq("project_id", id)
      .order("contributed_on"),
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
  const baseScenarioId = inputs?.scenarios[0]?.id ?? null;
  const [{ data: utilities }, { data: monthlyCostRows }, projectFlows, { count: sentToCash }] = await Promise.all([
    supabase.from("property_utilities").select("*").eq("project_id", id).order("kind"),
    supabase
      .from("v_property_monthly_cost")
      .select("month, paid_amount")
      .eq("project_id", id)
      .gte("month", twelveMonthsAgo),
    loadProjectFlows(supabase, id, today),
    baseScenarioId
      ? supabase
          .from("expected_income")
          .select("id", { count: "exact", head: true })
          .eq("scenario_id", baseScenarioId)
          .eq("status", "expected")
      : Promise.resolve({ count: 0 }),
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

  // Lease, loans and the base scenario (projectModel.ts): the ΛΕΙΤΟΥΡΓΙΑ
  // and ΤΑΜΕΙΑΚΗ ΡΟΗ blocks below come from one computeScenarioFromInputs()
  // run -- the same one the comparison page and «Στείλε στο ταμείο» use.
  const lease = inputs?.lease ?? null;
  const leaseSchedule = inputs?.leaseSchedule ?? null;
  const loanRows = inputs?.loans ?? [];
  const loanSchedule = inputs?.loanSchedule ?? null;
  const scenario = inputs?.scenarios[0] ?? null;
  const scenarioResult = inputs && scenario ? computeScenarioFromInputs(inputs, scenario) : null;
  const firstYearRent = leaseSchedule?.rows[0];

  // ΚΕΦΑΛΑΙΟ: who funded the project. Its return is «IRR έργου (χωρίς
  // ΦΠΑ)»: every project flow net of VAT and before financing -- paid, still
  // open and expected -- plus the budget not yet committed (development.ts).
  const capitalRows = capitalSources ?? [];
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
          <Link href={`/planner?project=${id}`}>
            <Button variant="secondary">{el.nav.planner}</Button>
          </Link>
          {lease?.kind === "indexed_rent" && <LeaseSyncButton leaseId={lease.id} />}
          <Link href={`/projects/${id}/compare`}>
            <Button variant="secondary">Σύγκριση σεναρίων</Button>
          </Link>
          <Link href={`/collab/${id}`}>
            <Button variant="secondary">{el.collab.navLabel}</Button>
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

        <FundingSections
          projectId={id}
          loans={loanRows}
          loanSchedule={loanSchedule}
          capitalSources={capitalRows}
          revenueToDate={revenueToDate}
          projectIrr={projectIrr}
        />

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
                    defaultValue={currentYear()}
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
                    href={`/projects/revenue-plans/${p.id}`}
                    className="flex items-center justify-between rounded-lg border border-line px-3 py-2 text-sm transition-colors hover:border-line-strong hover:bg-bg"
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
                href={`/projects/properties?month=${month.slice(0, 7)}`}
              />
            ))}
          </OnePagerSection>
        )}

        {/* ΠΛΑΝΟ ΕΡΓΟΥ -- the planner's view of this project (0040). Dated
            to-dos and milestones used to be ΚΑΤΑΣΤΑΣΗ notes; they live here
            now, and ΚΑΤΑΣΤΑΣΗ keeps the status and risk bullets. */}
        <ProjectPlanSection projectId={id} />

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

      <PartnersPanel projectId={id} isAdmin={isOrgAdmin} />

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
