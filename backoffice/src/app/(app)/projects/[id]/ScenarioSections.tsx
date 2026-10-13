import { OnePagerRow, OnePagerSection } from "@/components/onepager";
import Link from "next/link";
import { ArgsActionForm } from "@/components/ArgsActionForm";
import { Button, ButtonLink, Field, ReportHistory, Select, Term } from "@/components/ui";
import { formatMoney, formatMultiple, formatPercent } from "@/lib/format";
import { fixedPartOf, isActiveIn, pctPartOf } from "@/lib/finance/opex";
import type { ScenarioResult, ScenarioRow } from "@/lib/finance/projectModel";
import { fillText } from "@/lib/collab/text";
import {
  deleteOpexLine,
  removeScenarioFromCash,
  saveOpexLine,
  saveScenario,
  setScenarioRevenuePlan,
} from "./scenario-actions";
import { ArgsDeleteButton, OpexLineFormModal, ScenarioFormModal } from "../LegacyFormModals";
import { el } from "@/lib/i18n/el";
import { projects } from "@/lib/i18n/v2/projects";
import { NewScenarioButton, ScenarioRowActions, SendToCashButton } from "./ScenarioListControls";
import { AiCreateForm } from "../revenue-plans/AiCreateForm";
import { ManualPlanForm } from "../revenue-plans/ManualPlanForm";

// One row of the scenario bar: the three figures of its
// computeScenarioFromInputs() run (null = not computable, shown «—»).
export interface ScenarioListItem {
  id: string;
  name: string;
  isBase: boolean;
  operatingResult: number | null;
  npv: number | null;
  minDscr: number | null;
}

const t = el.projectScenarios;

// The scenario bar, right under the header (visible without scrolling):
// every scenario as a tab (one click opens it, ?s=), «+ Νέο σενάριο» and
// «Σύγκριση σεναρίων»; under it the selected scenario's result · NPV · min
// DSCR and its actions, all visible (ScenarioRowActions). The base is what
// opens by default.
export function ScenarioBar({
  projectId: id,
  scenarios,
  selectedId,
}: {
  projectId: string;
  scenarios: ScenarioListItem[];
  selectedId: string | null;
}) {
  const selected = scenarios.find((s) => s.id === selectedId) ?? null;
  return (
    <section aria-label={t.title} className="flex flex-col gap-2 border-b border-hairline pb-3">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <span className="eyebrow pb-2.5 text-muted">{t.title}</span>
        {scenarios.length === 0 ? (
          <span className="pb-2.5 text-body text-muted">{t.empty}</span>
        ) : (
          <nav aria-label={t.title} className="flex min-w-0 gap-1 overflow-x-auto">
            {scenarios.map((s) => {
              const isSelected = s.id === selectedId;
              return (
                <Link
                  key={s.id}
                  href={`/projects/${id}?s=${s.id}`}
                  scroll={false}
                  aria-current={isSelected ? "true" : undefined}
                  className={`min-h-10 border-b-2 px-3 py-2.5 text-body whitespace-nowrap ${
                    isSelected ? "border-navy text-ink" : "border-transparent text-muted hover:text-ink"
                  }`}
                >
                  {s.name}
                  {s.isBase && <span className="text-small text-muted"> · {t.base}</span>}
                </Link>
              );
            })}
          </nav>
        )}
        <div className="flex flex-wrap items-center gap-2 pb-1 md:ml-auto">
          <NewScenarioButton
            projectId={id}
            sources={scenarios.map((s) => ({ id: s.id, name: s.name }))}
            defaultSourceId={selectedId}
          />
          {scenarios.length > 1 && (
            <ButtonLink href={`/projects/${id}/compare`} size="sm">
              {t.compare}
            </ButtonLink>
          )}
        </div>
      </div>
      {selected && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          {/* The figures are in «Με μια ματιά» above when it shows; here only
              without a cash flow (no NPV), so they are never lost. */}
          <span className="num text-small text-muted">
            {selected.npv == null && (
              <>
                {t.selected}: {t.operatingResult} {selected.operatingResult == null ? "—" : formatMoney(selected.operatingResult)}
              </>
            )}
          </span>
          <div className="flex flex-wrap items-center gap-2">
            <ScenarioRowActions
              projectId={id}
              scenarioId={selected.id}
              name={selected.name}
              isBase={selected.isBase}
              isSelected
            />
          </div>
        </div>
      )}
    </section>
  );
}

export interface RevenuePlanOption {
  id: string;
  name: string;
  project_id: string | null;
  start_year: number;
  years: number;
}

// ΛΕΙΤΟΥΡΓΙΑ (Αναλύσεις εσόδων, Λειτουργικές Παραδοχές and ΛΕΙΤΟΥΡΓΙΑ in
// one), for the SELECTED scenario: its assumptions in one line, the
// reference operating year's revenue (and where it comes from), result and
// margin; «Επεξεργασία παραδοχών» beside the title. Behind «▸»: the cost
// lines (each with its amount, edit / delete, «+ Γραμμή») and the revenue
// plans (the list, which one feeds this scenario, «+ Νέα» by AI or by
// hand). Every figure is computeScenarioFromInputs() (projectModel.ts) or
// opex.ts; nothing is restated.
export function OperationSection({
  projectId: id,
  scenario,
  result,
  scenarioCount,
  plans,
  planOptions,
  ai,
}: {
  projectId: string;
  scenario: ScenarioRow | null;
  result: ScenarioResult | null;
  scenarioCount: number;
  // The revenue plans of this project.
  plans: RevenuePlanOption[];
  // Every plan of the organisation, for «which one feeds».
  planOptions: RevenuePlanOption[];
  ai: boolean;
}) {
  const p = el.projectPage.operation;
  const lines = [...(scenario?.opex_lines ?? [])].sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
  const feeding = scenario?.revenue_plan_id ? planOptions.find((o) => o.id === scenario.revenue_plan_id) : undefined;
  const source = feeding
    ? fillText(p.fromPlan, { name: feeding.name })
    : Number(scenario?.flat_annual_revenue ?? 0) > 0
      ? p.flatRevenue
      : null;
  const growth = {
    opexGrowthPct: Number(scenario?.opex_growth_pct ?? 0),
    growthStartsAfterOperatingYear: Number(scenario?.growth_starts_after_operating_year ?? 3),
  };
  const refYear = result?.referenceYear ?? 1;
  const revenue = result?.revenue ?? 0;
  // A line's cost in the reference year (the same formula as opexForYear);
  // a line that does not run that year shows its cost in its own first year
  // (muted), as in late September -- never a bare «—».
  const amountOf = (l: (typeof lines)[number]) =>
    isActiveIn(l, refYear)
      ? fixedPartOf(l, refYear, growth) + pctPartOf(l, refYear) * revenue
      : fixedPartOf(l, l.from_operating_year, growth) + pctPartOf(l, l.from_operating_year) * revenue;
  const annualRent = result?.annualRent ?? 0;

  return (
    <OnePagerSection
      title={p.title}
      subtitle={
        [scenario?.name, result?.referenceCalendarYear ? `${p.referenceYear} ${result.referenceCalendarYear}` : null]
          .filter(Boolean)
          .join(" · ") || undefined
      }
      actions={
        scenario ? (
          <ScenarioFormModal
            action={saveScenario}
            args={[id, scenario.id]}
            initial={{
              name: scenario.name,
              flat_annual_revenue: scenario.flat_annual_revenue,
              revenue_growth_pct: Number(scenario.revenue_growth_pct),
              opex_growth_pct: Number(scenario.opex_growth_pct),
              growth_starts_after_operating_year: scenario.growth_starts_after_operating_year,
              discount_rate_pct: Number(scenario.discount_rate_pct),
              dscr_covenant_min: Number(scenario.dscr_covenant_min),
              adr_multiplier: Number(scenario.adr_multiplier ?? 1),
              notes: scenario.notes,
            }}
          />
        ) : (
          <ScenarioFormModal action={saveScenario} args={[id, null]} />
        )
      }
    >
      {scenario ? (
        <p className="num border-b border-hairline py-2 text-small text-text">
          {p.revenueGrowth} {formatPercent(Number(scenario.revenue_growth_pct), { fixed: true })} ·{" "}
          <Term title={projects.forms.hint.opex}>opex</Term> {formatPercent(Number(scenario.opex_growth_pct), { fixed: true })} ·{" "}
          {p.discount} {formatPercent(Number(scenario.discount_rate_pct), { fixed: true })} ·{" "}
          <Term title={projects.forms.hint.dscr}>DSCR</Term> ≥ {formatMultiple(Number(scenario.dscr_covenant_min))}
        </p>
      ) : (
        <p className="border-b border-hairline py-2 text-body text-muted">{p.noScenario}</p>
      )}

      {result?.hasOperation && (
        <>
          <OnePagerRow label={p.revenue} amount={result.revenue} note={source} />
          <OnePagerRow
            label={p.result}
            amount={result.operatingResult}
            note={annualRent > 0 ? p.resultNoteRent : p.resultNote}
            negative={result.operatingResult < 0}
            alert={result.operatingResult < 0}
            emphasis
          />
          <OnePagerRow label={p.margin} amount={formatPercent(result.operatingResult / result.revenue, { fixed: true })} />
        </>
      )}

      {scenario && (
        <ReportHistory level={3} title={p.costLines} count={lines.length}>
          <div className="flex flex-col">
            {lines.map((l) => {
              const amount = amountOf(l);
              return (
                <div
                  key={l.id}
                  className="flex flex-col gap-2 border-b border-hairline py-2 text-body md:flex-row md:items-center md:justify-between md:gap-4"
                >
                  <span className="min-w-0 text-ink">
                    {l.label}{" "}
                    <span className="num text-small text-muted">
                      ({p.years} {l.from_operating_year}
                      {l.to_operating_year ? `–${l.to_operating_year}` : "+"})
                    </span>
                    {l.note && <span className="block text-small text-muted">{l.note}</span>}
                  </span>
                  <div className="flex flex-wrap items-center gap-2 md:justify-end">
                    <span className={`num ${isActiveIn(l, refYear) ? "text-ink" : "text-muted"}`}>{amount ? formatMoney(-amount) : "—"}</span>
                    <OpexLineFormModal
                      action={saveOpexLine}
                      args={[id, scenario.id, l.id]}
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
                    <ArgsDeleteButton action={deleteOpexLine} args={[id, l.id]} />
                  </div>
                </div>
              );
            })}
            {result?.hasOperation && (
              <>
                {annualRent > 0 && <OnePagerRow label={p.rent} amount={annualRent} negative note={p.rentNote} />}
                <OnePagerRow label={p.costTotal} amount={result.opexTotal + annualRent} negative emphasis />
              </>
            )}
            <div className="pt-2">
              <OpexLineFormModal action={saveOpexLine} args={[id, scenario.id, null]} />
            </div>
          </div>
        </ReportHistory>
      )}

      <ReportHistory level={3} title={p.plans} count={plans.length}>
        {plans.length > 0 && (
          <ul className="flex flex-col border-t border-hairline">
            {plans.map((plan) => (
              <li key={plan.id}>
                <Link
                  href={`/projects/revenue-plans/${plan.id}`}
                  className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-hairline py-2 text-body text-ink hover:bg-hover"
                >
                  <span className="underline-offset-4 hover:underline">{plan.name}</span>
                  <span className="text-small text-muted">
                    <span className="num">
                      {plan.start_year}–{plan.start_year + plan.years - 1}
                    </span>
                    {scenario?.revenue_plan_id === plan.id && ` · ${p.feeds}`}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        {scenario && (
          <ArgsActionForm key={scenario.id} action={setScenarioRevenuePlan} args={[id, scenario.id]} className="flex flex-wrap items-end gap-3">
            <Field
              label={scenarioCount > 1 ? fillText(t.feedsScenario, { name: scenario.name }) : p.feedsLabel}
              htmlFor="scenario-revenue-plan"
              className="min-w-0"
            >
              <Select
                id="scenario-revenue-plan"
                name="revenue_plan_id"
                defaultValue={scenario.revenue_plan_id ?? ""}
                className="max-w-full max-md:min-h-11"
              >
                <option value="">{p.noPlan}</option>
                {planOptions.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                    {o.project_id && o.project_id !== id ? ` ${p.otherProject}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="secondary">
              {p.update}
            </Button>
          </ArgsActionForm>
        )}

        <div className="flex flex-col gap-3">
          <h4 className="eyebrow text-muted">{p.newPlan}</h4>
          {ai && <AiCreateForm projectId={id} />}
          <ManualPlanForm projectId={id} />
        </div>
      </ReportHistory>
    </OnePagerSection>
  );
}

// ΤΑΜΕΙΑΚΗ ΡΟΗ, for the selected scenario: the lowest debt cover (and its
// year), the NPV, the years under the bank's requirement and what was sent
// to the cash forecast, with a visible «Στείλε στο ταμείο» (its small form
// in a drawer). The first amortisation year's cover and the cumulative
// flow behind «▸». The covenant and the discount rate are in ΛΕΙΤΟΥΡΓΙΑ's
// assumptions line, not repeated here.
export function CashflowSection({
  projectId: id,
  scenarioId,
  cashflow,
  covenant,
  sentToCash,
}: {
  projectId: string;
  scenarioId: string;
  cashflow: NonNullable<ScenarioResult["cashflow"]>;
  covenant: number;
  sentToCash: number;
}) {
  const p = el.projectPage.cashflow;
  const k = cashflow.kpis;
  const below = k.minDscr != null && k.minDscr.value < covenant;
  return (
    <OnePagerSection title={p.title} subtitle={fillText(p.horizon, { years: String(cashflow.years.length) })}>
      {k.minDscr && (
        <OnePagerRow
          label={<Term title={p.minDscrHint}>{p.minDscr}</Term>}
          amount={formatMultiple(k.minDscr.value)}
          note={`${k.minDscr.calendarYear}`}
          negative={below}
          alert={below}
        />
      )}
      <OnePagerRow label={<Term title={p.npvHint}>{p.npv}</Term>} amount={k.npv} note={p.npvNote} />
      {k.covenantBreaches.length > 0 && (
        <OnePagerRow
          label={<Term title={p.breachesHint}>{p.breaches}</Term>}
          amount={k.covenantBreaches.map((b) => b.calendarYear).join(", ")}
          negative
        />
      )}
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-hairline py-2 text-body">
        <div className="flex flex-wrap items-center gap-x-2 text-text">
          <span>{p.inCash}:</span>
          <span className="num text-ink">{sentToCash > 0 ? fillText(p.lines, { count: sentToCash }) : p.notYet}</span>
          {sentToCash > 0 && (
            <ArgsActionForm action={removeScenarioFromCash} args={[id, scenarioId]} className="inline-flex flex-wrap items-center">
              <button type="submit" className="inline-flex items-center text-small text-ink underline underline-offset-4 max-md:min-h-11">
                {el.sendToCash.remove}
              </button>
            </ArgsActionForm>
          )}
        </div>
        <SendToCashButton projectId={id} scenarioId={scenarioId} sent={sentToCash} />
      </div>
      <ReportHistory level={3} title={p.details}>
        <div>
          {k.firstAmortisationYearDscr && (
            <OnePagerRow
              label={p.firstYear}
              amount={formatMultiple(k.firstAmortisationYearDscr.value)}
              note={`${k.firstAmortisationYearDscr.calendarYear}`}
            />
          )}
          <OnePagerRow
            label={p.cumulative}
            amount={k.cumulativeTotal}
            note={fillText(p.until, { year: String(cashflow.years[cashflow.years.length - 1]?.calendarYear ?? "") })}
          />
        </div>
      </ReportHistory>
    </OnePagerSection>
  );
}
