import { OnePagerRow, OnePagerSection } from "@/components/onepager";
import Link from "next/link";
import { ButtonLink, Term } from "@/components/ui";
import { formatMoney, formatMultiple, formatPercent } from "@/lib/format";
import type { ScenarioResult, ScenarioRow } from "@/lib/finance/projectModel";
import { saveScenario, saveOpexLine, deleteOpexLine } from "./scenario-actions";
import { ScenarioFormModal } from "../LegacyFormModals";
import { OpexLineFormModal } from "../LegacyFormModals";
import { SendToCashSection } from "./FinanceSections";
import { RowDeleteMenu } from "@/components/RowDeleteMenu";
import { el } from "@/lib/i18n/el";
import { NewScenarioButton, ScenarioRowActions } from "./ScenarioListControls";

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
          <span className="num text-small text-muted">
            {t.selected}: {t.operatingResult} {selected.operatingResult == null ? "—" : formatMoney(selected.operatingResult)} · {t.npv}{" "}
            {selected.npv == null ? "—" : formatMoney(selected.npv)} · {t.minDscr}{" "}
            {selected.minDscr == null ? "—" : formatMultiple(selected.minDscr)}
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

// The scenario blocks of the project one-pager's grid: the SELECTED
// scenario's assumptions
// (editable), its reference operating year (ΛΕΙΤΟΥΡΓΙΑ) and cash flow KPIs
// (ΤΑΜΕΙΑΚΗ ΡΟΗ). Every figure is computeScenarioFromInputs()
// (projectModel.ts), passed in; nothing is computed here.
export function ScenarioSections({
  projectId: id,
  scenario,
  result: scenarioResult,
  annualRent,
  monthlyRent,
  sentToCash,
}: {
  projectId: string;
  scenario: ScenarioRow | null;
  result: ScenarioResult | null;
  annualRent: number;
  monthlyRent: number;
  sentToCash: number;
}) {
  const opexLines = scenario?.opex_lines ?? [];
  const revenue = scenarioResult?.revenue ?? 0;
  const opexTotal = scenarioResult?.opexTotal ?? 0;
  const cashflow = scenarioResult?.cashflow ?? null;
  const operatingResult = revenue - opexTotal - annualRent;
  const hasOperation = Boolean(scenario && revenue > 0);

  return (
    <>
      {/* Λειτουργικές Παραδοχές -- growth rates, discount rate, DSCR
          covenant, and the opex line items themselves were previously not
          editable anywhere in the app, not even through the AI chat
          (project_scenarios/opex_lines aren't in writeTools.ts's
          ALLOWLIST). This is what actually feeds the ΛΕΙΤΟΥΡΓΙΑ/DSCR/NPV
          numbers below -- renders even with no scenario yet so the first
          one can be created here instead of nowhere. */}
      <OnePagerSection title="Λειτουργικές Παραδοχές" subtitle={scenario?.name}>
        <div className="flex flex-col gap-3">
          {!scenario ? (
            <div className="flex flex-col items-start gap-3 border-b border-hairline py-3 md:flex-row md:items-center md:justify-between">
              <p className="text-body text-muted">Δεν υπάρχει ακόμα σενάριο λειτουργίας για αυτό το έργο.</p>
              <ScenarioFormModal action={saveScenario.bind(null, id, null)} trigger="+ Σενάριο Λειτουργίας" />
            </div>
          ) : (
            <>
              <div className="flex flex-col items-start gap-2 border-b border-hairline py-3 text-body md:flex-row md:items-center md:justify-between">
                <div className="num text-text">
                  Ανάπτυξη εσόδων {formatPercent(Number(scenario.revenue_growth_pct), { fixed: true })} ·{" "}
                  <Term title="Opex (Operating Expenses) — λειτουργικά έξοδα, εκτός μισθώματος και εξυπηρέτησης δανείου.">
                    opex
                  </Term>{" "}
                  {formatPercent(Number(scenario.opex_growth_pct), { fixed: true })} · προεξόφληση{" "}
                  {formatPercent(Number(scenario.discount_rate_pct), { fixed: true })} ·{" "}
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
                    adr_multiplier: Number(scenario.adr_multiplier ?? 1),
                    notes: scenario.notes,
                  }}
                />
              </div>

              <div className="flex flex-col">
                {opexLines.map((l) => (
                  <div
                    key={l.id}
                    className="flex flex-col gap-2 border-b border-hairline py-2 text-body md:flex-row md:items-center md:justify-between md:gap-4"
                  >
                    <span className="min-w-0 text-ink">
                      {l.label}{" "}
                      <span className="num text-small text-muted">
                        (έτη {l.from_operating_year}
                        {l.to_operating_year ? `–${l.to_operating_year}` : "+"})
                      </span>
                    </span>
                    <div className="flex flex-wrap items-center gap-2">
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
                      <RowDeleteMenu action={deleteOpexLine.bind(null, id, l.id)} label="Ενέργειες" plain>
                        Διαγραφή
                      </RowDeleteMenu>
                    </div>
                  </div>
                ))}
                <div className="pt-2">
                  <OpexLineFormModal action={saveOpexLine.bind(null, id, scenario.id, null)} />
                </div>
              </div>
            </>
          )}
        </div>
      </OnePagerSection>

      {/* ΛΕΙΤΟΥΡΓΙΑ — the stabilised operating year */}
      {hasOperation && (
        <OnePagerSection
          title="ΛΕΙΤΟΥΡΓΙΑ"
          subtitle={[scenario?.name, scenarioResult?.referenceCalendarYear ? `έτος αναφοράς ${scenarioResult.referenceCalendarYear}` : null]
            .filter(Boolean)
            .join(" · ")}
        >
          <OnePagerRow label="Ετήσιος τζίρος" amount={revenue} />
          {(scenarioResult?.opexLines ?? []).map((l, i) => (
            <OnePagerRow key={i} label={l.label} amount={l.amount} negative note={l.note} />
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
            amount={formatPercent(operatingResult / revenue, { fixed: true })}
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
              amount={formatMultiple(cashflow.kpis.firstAmortisationYearDscr.value)}
              note={`${cashflow.kpis.firstAmortisationYearDscr.calendarYear}`}
            />
          )}
          {cashflow.kpis.minDscr && (
            <OnePagerRow
              label="Χαμηλότερη κάλυψη δόσης"
              amount={formatMultiple(cashflow.kpis.minDscr.value)}
              note={`${cashflow.kpis.minDscr.calendarYear}`}
              negative={cashflow.kpis.minDscr.value < (scenario?.dscr_covenant_min ?? 1.2)}
              alert={cashflow.kpis.minDscr.value < (scenario?.dscr_covenant_min ?? 1.2)}
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
            note={`Προεξοφλημένη ροή μετά την εξυπηρέτηση δανείου, χωρίς την αρχική επένδυση — @${formatPercent(Number(scenario?.discount_rate_pct ?? 0.09), { digits: 0 })}.`}
          />
          {cashflow.kpis.covenantBreaches.length > 0 && (
            <OnePagerRow
              label="Έτη κάτω από την απαίτηση τράπεζας"
              amount={cashflow.kpis.covenantBreaches.map((b) => b.calendarYear).join(", ")}
              negative
            />
          )}
          {scenario && <SendToCashSection projectId={id} scenarioId={scenario.id} sentCount={sentToCash ?? 0} />}
        </OnePagerSection>
      )}
    </>
  );
}
