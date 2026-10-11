import { OnePagerRow, OnePagerSection } from "@/components/onepager";
import { Button, Term } from "@/components/ui";
import { formatMoney, formatMultiple, formatPercent } from "@/lib/format";
import type { ScenarioResult, ScenarioRow } from "@/lib/finance/projectModel";
import { saveScenario, saveOpexLine, deleteOpexLine } from "./scenario-actions";
import { ScenarioFormModal } from "../LegacyFormModals";
import { OpexLineFormModal } from "../LegacyFormModals";
import { SendToCashSection } from "./FinanceSections";
import { RowDeleteMenu } from "@/components/RowDeleteMenu";

// The base scenario's blocks of the project one-pager: its assumptions
// (editable), the reference operating year (ΛΕΙΤΟΥΡΓΙΑ) and the cash flow
// KPIs (ΤΑΜΕΙΑΚΗ ΡΟΗ). Every figure is computeScenarioFromInputs()
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
      <OnePagerSection title="Λειτουργικές Παραδοχές">
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
                    className="flex flex-col gap-2 border-b border-hairline py-3 text-body md:flex-row md:items-center md:justify-between md:gap-4"
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
                <div className="pt-3">
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
