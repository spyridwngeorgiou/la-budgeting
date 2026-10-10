import Link from "next/link";
import { Badge, Button, DataTable, EmptyState, Field, Input, KeyValue, SectionHeader, Segmented, Select } from "@/components/ui";
import { formatMoney } from "@/lib/format";
import { currentYear } from "@/lib/dates";
import { withParams } from "@/lib/url";
import { aiEnabled } from "@/lib/ai/client";
import { el } from "@/lib/i18n/el";
import { projects } from "@/lib/i18n/v2/projects";
import type { ScenarioResult, ScenarioRow } from "@/lib/finance/projectModel";
import {
  createScenario,
  deleteOpexLine,
  deleteScenario,
  removeScenarioFromCash,
  saveOpexLine,
  saveScenario,
  sendScenarioToCash,
  setBaseScenario,
  setScenarioRevenuePlan,
} from "@/app/(app)/projects/[id]/scenario-actions";
import { createRevenuePlan } from "@/app/(app)/projects/revenue-plans/actions";
import { AiCreateForm } from "@/app/(app)/projects/revenue-plans/AiCreateForm";
import { OpexFields, OPEX_KIND_LABELS, ScenarioFields } from "./forms/fields";
import { DrawerButton } from "./DrawerButton";
import { ActionButton } from "./ActionButton";
import { percent, times } from "./format";
import { requireTab } from "./data";

const t = projects.scenarios;
type Params = Record<string, string | string[] | undefined>;
type Item = { scenario: ScenarioRow; result: ScenarioResult };

// Σενάρια: as many as you like, one of them the base (the header's figures
// and the classic page read the base). One scenario in detail -- its
// assumptions, opex, operating year and cash flow, «Στείλε στο ταμείο» --
// then all of them side by side (absorbs /projects/[id]/compare), then the
// revenue analyses that feed them. Every figure is
// computeScenarioFromInputs() (projectModel.ts), loaded once in data.ts.
export async function ScenariosTab({ id, searchParams }: { id: string; searchParams: Params }) {
  const core = await requireTab(id, "scenarios");
  const { supabase, results, canEdit, inputs } = core;
  const wanted = typeof searchParams.s === "string" ? searchParams.s : null;
  const selected: Item | null = results.find((r) => r.scenario.id === wanted) ?? core.base ?? results[0] ?? null;

  const [{ data: plans }, { count: sentCount }] = await Promise.all([
    supabase
      .from("revenue_plans")
      .select("id, name, project_id, start_year, years")
      .eq("org_id", core.rollup.org_id ?? "")
      .order("name"),
    selected
      ? supabase.from("expected_income").select("id", { count: "exact", head: true }).eq("scenario_id", selected.scenario.id).eq("status", "expected")
      : Promise.resolve({ count: 0 }),
  ]);
  const linkedPlans = (plans ?? []).filter((p) => p.project_id === id);
  const planName = (planId: string | null) => (plans ?? []).find((p) => p.id === planId)?.name ?? null;
  const revenueSource = (s: ScenarioRow) => planName(s.revenue_plan_id) ?? (Number(s.flat_annual_revenue ?? 0) > 0 ? t.flat : t.noRevenue);
  const select = (scenarioId: string) => withParams(`/projects/${id}/scenarios`, searchParams, { s: scenarioId });
  const kpis = (r: ScenarioResult) => r.cashflow?.kpis ?? null;

  const compareRows: { key: string; label: string; render: (r: ScenarioResult) => React.ReactNode }[] = [
    { key: "year", label: t.referenceYear, render: (r) => r.referenceCalendarYear ?? "—" },
    { key: "revenue", label: t.revenue, render: (r) => formatMoney(r.revenue) },
    { key: "opex", label: t.opexTotal, render: (r) => formatMoney(r.opexTotal) },
    { key: "rent", label: t.rent, render: (r) => formatMoney(r.annualRent) },
    { key: "result", label: t.result, render: (r) => formatMoney(r.operatingResult) },
    { key: "dscr", label: t.minDscr, render: (r) => (kpis(r)?.minDscr ? `${times(kpis(r)!.minDscr!.value)} (${kpis(r)!.minDscr!.calendarYear})` : "—") },
    { key: "breaches", label: t.breaches, render: (r) => (kpis(r) ? kpis(r)!.covenantBreaches.length : "—") },
    { key: "npv", label: t.npv, render: (r) => (kpis(r) ? formatMoney(kpis(r)!.npv) : "—") },
  ];

  return (
    <div className="flex flex-col gap-12">
      <section className="flex flex-col gap-4">
        <SectionHeader
          numeral={1}
          title={t.title}
          actions={
            canEdit && (
              <DrawerButton label={t.add} title={t.addTitle} action={createScenario.bind(null, id)}>
                <ScenarioFields initial={{ name: results.length ? "" : "Βασικό" }} />
              </DrawerButton>
            )
          }
        />
        {results.length === 0 ? (
          <EmptyState title={t.none} body={t.noneBody} />
        ) : (
          <DataTable<Item>
            rows={results}
            rowKey={(r) => r.scenario.id}
            rowHref={(r) => select(r.scenario.id)}
            columns={[
              {
                key: "name",
                header: t.name,
                primary: true,
                cell: (r) => (
                  <span className="inline-flex items-center gap-2">
                    {r.scenario.name}
                    {r.scenario.is_base && <Badge tone="navy">{t.base}</Badge>}
                    {r.scenario.id === selected?.scenario.id && <span className="sr-only">({t.show})</span>}
                  </span>
                ),
              },
              { key: "source", header: t.revenueSource, cell: (r) => revenueSource(r.scenario) },
              { key: "revenue", header: t.revenue, numeric: true, cell: (r) => formatMoney(r.result.revenue) },
              { key: "dscr", header: t.minDscr, numeric: true, cell: (r) => times(kpis(r.result)?.minDscr?.value ?? null) },
              { key: "npv", header: t.npv, numeric: true, cell: (r) => (kpis(r.result) ? formatMoney(kpis(r.result)!.npv) : "—") },
            ]}
            rowActions={
              canEdit
                ? (r) =>
                    r.scenario.is_base ? null : (
                      <div className="flex flex-col items-stretch p-1">
                        <ActionButton action={setBaseScenario.bind(null, id, r.scenario.id)}>{t.makeBase}</ActionButton>
                        <ActionButton action={deleteScenario.bind(null, id, r.scenario.id)} variant="danger" confirm={`${projects.finance.delete}: ${r.scenario.name};`}>
                          {projects.finance.delete}
                        </ActionButton>
                      </div>
                    )
                : undefined
            }
          />
        )}
      </section>

      {selected && (
        <ScenarioDetail
          id={id}
          item={selected}
          canEdit={canEdit}
          plans={plans ?? []}
          sentCount={sentCount ?? 0}
          picker={
            results.length > 1 && (
              <Segmented
                label={t.show}
                active={selected.scenario.id}
                options={results.map((r) => ({ key: r.scenario.id, label: r.scenario.name, href: select(r.scenario.id) }))}
                className="flex-wrap"
              />
            )
          }
        />
      )}

      {results.length > 1 && (
        <section id="compare" className="flex scroll-mt-24 flex-col gap-4">
          <SectionHeader numeral={4} title={t.compare} />
          <DataTable
            mode="scroll"
            rows={compareRows}
            rowKey={(row) => row.key}
            columns={[
              { key: "metric", header: t.metric, primary: true, cell: (row) => row.label },
              ...results.map((r) => ({
                key: r.scenario.id,
                header: (
                  <span className="inline-flex items-center gap-2">
                    {r.scenario.name}
                    {r.scenario.is_base && <Badge tone="navy">{t.base}</Badge>}
                  </span>
                ),
                numeric: true,
                cell: (row: (typeof compareRows)[number]) => row.render(r.result),
              })),
            ]}
          />
        </section>
      )}

      <section className="flex flex-col gap-4">
        <SectionHeader numeral={results.length > 1 ? 5 : 4} title={t.plans} />
        <DataTable
          rows={linkedPlans}
          rowKey={(p) => p.id}
          empty={t.noPlans}
          rowHref={(p) => `/projects/revenue-plans/${p.id}`}
          columns={[
            { key: "name", header: t.planName, primary: true, cell: (p) => p.name },
            { key: "years", header: t.planYears, numeric: true, cell: (p) => `${p.start_year}–${p.start_year + p.years - 1}` },
            {
              key: "used",
              header: "",
              cell: (p) =>
                results
                  .filter((r) => r.scenario.revenue_plan_id === p.id)
                  .map((r) => r.scenario.name)
                  .join(", "),
            },
          ]}
        />
        {canEdit && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <form action={createRevenuePlan} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="project_id" value={id} />
              <Field label={t.planName} className="min-w-48 flex-1">
                <Input name="name" required />
              </Field>
              <Field label={t.startYear}>
                <Input name="start_year" type="number" defaultValue={currentYear()} required className="w-28" />
              </Field>
              <Field label={t.planYears}>
                <Input name="years" type="number" min={1} max={10} defaultValue={3} required className="w-20" />
              </Field>
              <Button type="submit" variant="secondary">
                {t.newPlan}
              </Button>
            </form>
            {aiEnabled() && <AiCreateForm projectId={id} />}
          </div>
        )}
      </section>

      {inputs.leaseSchedule && inputs.leaseSchedule.diagnostics.length > 0 && (
        <aside className="border-l-2 border-warning pl-4">
          <p className="eyebrow text-warning">{t.modelNotes}</p>
          <ul className="mt-1 list-disc pl-4 text-small text-text">
            {inputs.leaseSchedule.diagnostics.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        </aside>
      )}
    </div>
  );
}

function ScenarioDetail({
  id,
  item: { scenario, result },
  canEdit,
  plans,
  sentCount,
  picker,
}: {
  id: string;
  item: Item;
  canEdit: boolean;
  plans: { id: string; name: string; project_id: string | null }[];
  sentCount: number;
  picker: React.ReactNode;
}) {
  const cashflow = result.cashflow;
  const covenant = Number(scenario.dscr_covenant_min);
  const opexLines = (scenario.opex_lines ?? []).slice().sort((a, b) => Number(a.sort_order ?? 0) - Number(b.sort_order ?? 0));
  const st = el.sendToCash;

  return (
    <>
      <section className="flex flex-col gap-4">
        <SectionHeader
          numeral={2}
          title={
            <span className="inline-flex flex-wrap items-center gap-3">
              {scenario.name}
              {scenario.is_base && <Badge tone="navy">{t.base}</Badge>}
            </span>
          }
          actions={
            canEdit && (
              <>
                {!scenario.is_base && <ActionButton action={setBaseScenario.bind(null, id, scenario.id)}>{t.makeBase}</ActionButton>}
                <DrawerButton label={t.editAssumptions} title={t.assumptions} eyebrow={scenario.name} action={saveScenario.bind(null, id, scenario.id)}>
                  <ScenarioFields initial={scenario} />
                </DrawerButton>
              </>
            )
          }
        />
        {picker}
        <KeyValue
          columns={2}
          items={[
            { label: t.revenueGrowth, value: percent(Number(scenario.revenue_growth_pct)), numeric: true },
            { label: t.opexGrowth, value: percent(Number(scenario.opex_growth_pct)), numeric: true },
            { label: t.growthAfter, value: scenario.growth_starts_after_operating_year, numeric: true },
            { label: t.discount, value: percent(Number(scenario.discount_rate_pct)), numeric: true },
            { label: t.covenant, value: `≥ ${times(covenant)}`, numeric: true },
            { label: t.adr, value: percent(Number(scenario.adr_multiplier ?? 1)), numeric: true },
          ]}
        />
        {canEdit && (
          <form action={setScenarioRevenuePlan.bind(null, id, scenario.id)} className="flex flex-wrap items-end gap-3">
            <Field label={t.plan} className="min-w-64">
              <Select name="revenue_plan_id" defaultValue={scenario.revenue_plan_id ?? ""}>
                <option value="">{t.planNone}</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                    {p.project_id && p.project_id !== id ? ` ${t.otherProject}` : ""}
                  </option>
                ))}
              </Select>
            </Field>
            <Button type="submit" variant="secondary">
              {t.update}
            </Button>
          </form>
        )}

        <div className="flex flex-col gap-3 pt-2">
          <div className="flex items-baseline justify-between gap-3">
            <p className="eyebrow text-muted">{t.opex}</p>
            {canEdit && (
              <DrawerButton label={t.addOpex} title={t.opexTitle} eyebrow={scenario.name} action={saveOpexLine.bind(null, id, scenario.id, null)}>
                <OpexFields />
              </DrawerButton>
            )}
          </div>
          <DataTable
            rows={opexLines}
            rowKey={(l) => l.id}
            empty={t.noOpex}
            columns={[
              {
                key: "label",
                header: t.opex,
                primary: true,
                cell: (l) =>
                  canEdit ? (
                    <DrawerButton asLink label={l.label} title={t.opexTitle} eyebrow={scenario.name} action={saveOpexLine.bind(null, id, scenario.id, l.id)}>
                      <OpexFields initial={l} />
                    </DrawerButton>
                  ) : (
                    l.label
                  ),
              },
              { key: "kind", header: projects.finance.kind, cell: (l) => OPEX_KIND_LABELS[l.kind] },
              {
                key: "years",
                header: t.opexYears,
                numeric: true,
                cell: (l) => `${l.from_operating_year}${l.to_operating_year ? `–${l.to_operating_year}` : "+"}`,
              },
            ]}
            rowActions={canEdit ? (l) => <ActionButton action={deleteOpexLine.bind(null, id, l.id)}>{projects.finance.delete}</ActionButton> : undefined}
          />
        </div>
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader numeral={3} title={`${t.operation} · ${t.cashflow}`} />
        {result.hasOperation ? (
          <div className="grid grid-cols-1 gap-x-10 gap-y-6 lg:grid-cols-2">
            <KeyValue
              items={[
                { label: t.referenceYear, value: result.referenceCalendarYear ?? "—", numeric: true },
                { label: t.revenue, value: formatMoney(result.revenue), numeric: true },
                ...result.opexLines.map((l) => ({ label: l.label, value: `−${formatMoney(l.amount)}`, numeric: true })),
                ...(result.annualRent > 0 ? [{ label: t.rent, value: `−${formatMoney(result.annualRent)}`, numeric: true }] : []),
                { label: t.result, value: formatMoney(result.operatingResult), numeric: true },
                { label: t.margin, value: percent(result.revenue ? result.operatingResult / result.revenue : null), numeric: true },
              ]}
            />
            {cashflow && (
              <KeyValue
                items={[
                  ...(cashflow.kpis.firstAmortisationYearDscr
                    ? [{ label: `${t.firstDscr} (${cashflow.kpis.firstAmortisationYearDscr.calendarYear})`, value: times(cashflow.kpis.firstAmortisationYearDscr.value), numeric: true }]
                    : []),
                  ...(cashflow.kpis.minDscr
                    ? [
                        {
                          label: `${t.minDscr} (${cashflow.kpis.minDscr.calendarYear})`,
                          value: <span className={cashflow.kpis.minDscr.value < covenant ? "text-negative" : undefined}>{times(cashflow.kpis.minDscr.value)}</span>,
                          numeric: true,
                        },
                      ]
                    : []),
                  { label: t.cumulative, value: formatMoney(cashflow.kpis.cumulativeTotal), numeric: true },
                  {
                    label: <span title={t.npvNote(percent(Number(scenario.discount_rate_pct)))}>{t.npv}</span>,
                    value: formatMoney(cashflow.kpis.npv),
                    numeric: true,
                  },
                  ...(cashflow.kpis.covenantBreaches.length > 0
                    ? [{ label: t.breaches, value: <span className="text-negative">{cashflow.kpis.covenantBreaches.map((b) => b.calendarYear).join(", ")}</span> }]
                    : []),
                ]}
              />
            )}
          </div>
        ) : (
          <p className="text-sm text-muted">{t.noCashflow}</p>
        )}

        {cashflow && (
          <DataTable
            mode="scroll"
            rows={cashflow.years}
            rowKey={(y) => String(y.calendarYear)}
            columns={[
              { key: "year", header: t.year, primary: true, cell: (y) => y.calendarYear },
              { key: "revenue", header: t.revenue, numeric: true, cell: (y) => formatMoney(y.revenue) },
              { key: "opex", header: t.opexTotal, numeric: true, cell: (y) => formatMoney(y.opex) },
              { key: "rent", header: t.rent, numeric: true, cell: (y) => formatMoney(y.rent) },
              { key: "ds", header: t.debtService, numeric: true, cell: (y) => formatMoney(y.debtService) },
              { key: "net", header: t.net, numeric: true, cell: (y) => formatMoney(y.netFlow) },
              { key: "cum", header: t.cumulative, numeric: true, cell: (y) => formatMoney(y.cumulative) },
              {
                key: "dscr",
                header: t.dscr,
                numeric: true,
                cell: (y) => <span className={y.dscr != null && y.dscr < covenant ? "text-negative" : undefined}>{times(y.dscr)}</span>,
              },
            ]}
          />
        )}

        {cashflow && canEdit && (
          <div className="flex flex-col gap-2 border-t border-hairline pt-4">
            <p className="eyebrow text-muted">{st.title}</p>
            <p className="max-w-prose text-small text-muted">{st.hint}</p>
            <ActionButton
              action={sendScenarioToCash.bind(null, id, scenario.id)}
              variant="primary"
              fields={
                <>
                  <Field label={st.months}>
                    <Select name="months" defaultValue="24">
                      {[12, 24, 36].map((m) => (
                        <option key={m} value={m}>
                          {m} {st.monthsUnit}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label={st.probability}>
                    <Input type="number" name="probability_pct" min="1" max="100" step="5" defaultValue={80} className="w-24" />
                  </Field>
                </>
              }
            >
              {sentCount > 0 ? st.resend : st.send}
            </ActionButton>
            {sentCount > 0 && (
              <div className="flex flex-wrap items-center gap-2 text-small text-muted">
                <Link href="/reports/cash" className="underline-offset-4 hover:underline">
                  {sentCount} {st.sent}
                </Link>
                <ActionButton action={removeScenarioFromCash.bind(null, id, scenario.id)}>{st.remove}</ActionButton>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
