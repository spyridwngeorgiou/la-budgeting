import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, Button, PageHeader, SectionHeader, Stat, StatRow, cn } from "@/components/ui";
import { ArgsActionForm } from "@/components/ArgsActionForm";
import { BarChart } from "@/components/ui/BarChart";
import { FRAME, LINK, NUM, ROW, SUB, TABLE, TD, TH, TOUCH, ViewSwitch } from "../ui";
import { loadLookups } from "@/lib/data/lookups";
import { currentMonthKey, firstOfMonth, isMonthKey, monthKeyOf, monthLabel, shortMonthYearLabel } from "@/lib/dates";
import { cashChartRows } from "@/lib/finance/reportCharts";
import {
  FORECAST_HORIZONS,
  FORECAST_SCENARIOS,
  parseHorizon,
  parseScenario,
  parseScope,
  type ForecastScenario,
  type ForecastScope,
} from "@/lib/finance/forecastParams";
import { ExpectedIncomeFormModal } from "./ExpectedIncomeFormModal";
import { saveExpectedIncome, setExpectedIncomeStatus } from "./actions";

// Ταμείο & Πρόβλεψη. Every figure comes from cash_forecast() /
// cash_forecast_items() (0066) -- the same SQL the dashboard and the
// assistant read -- so this page computes nothing of its own: it only picks
// the scenario, scope and horizon, and lays the rows out.

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function CashPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const scenario = parseScenario(sp.scenario);
  const scope = parseScope(sp.scope);
  const months = parseHorizon(sp.months, 12);
  const todayMonth = currentMonthKey();
  const selectedRaw = Array.isArray(sp.month) ? sp.month[0] : sp.month;
  const selected = isMonthKey(selectedRaw) ? selectedRaw : todayMonth;

  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const [{ data: forecast, error }, { data: items }, { data: expected }, lookups] = await Promise.all([
    supabase.rpc("cash_forecast", { p_org: orgId, p_months: months, p_scenario: scenario, p_scope: scope ?? undefined }),
    supabase.rpc("cash_forecast_items", {
      p_org: orgId,
      p_month: firstOfMonth(selected),
      p_scenario: scenario,
      p_scope: scope ?? undefined,
    }),
    supabase
      .from("expected_income")
      .select("id, source, amount, expected_month, probability, certainty, project_id, owner_scope, notes, scenario_id, direction, projects(display_name)")
      .eq("org_id", orgId)
      .eq("status", "expected")
      .order("expected_month"),
    loadLookups(supabase, orgId, { include: ["projects"] }),
  ]);
  if (error) throw error;

  const rows = forecast ?? [];
  const t = el.reports;
  const first = rows[0];
  const buffer = Number(first?.min_buffer ?? 0);
  const firstBelow = rows.find((r) => r.below_buffer);
  const lowest = rows.reduce<(typeof rows)[number] | null>(
    (lo, r) => (lo === null || Number(r.closing_balance) < Number(lo.closing_balance) ? r : lo),
    null,
  );

  const chartRows = cashChartRows(rows, shortMonthYearLabel);

  const query = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | null> = {
      scenario: scenario === "base" ? null : scenario,
      scope,
      months: months === 12 ? null : String(months),
      month: selected === todayMonth ? null : selected,
      ...patch,
    };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/reports/cash?${s}` : "/reports/cash";
  };

  const inflowItems = (items ?? []).filter((i) => i.direction === "income");
  const outflowItems = (items ?? []).filter((i) => i.direction === "expense");

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title={t.cashTitle} meta={<span className="block max-w-3xl">{t.cashIntro}</span>} />

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-start gap-x-8 gap-y-4">
          <ViewSwitch
            label={t.scenario}
            options={FORECAST_SCENARIOS.map((s) => ({ key: s, label: t.scenarios[s], href: query({ scenario: s === "base" ? null : s }) }))}
            active={scenario}
          />
          <ViewSwitch
            label={t.scope}
            options={[
              { key: "all", label: t.scopeAll, href: query({ scope: null }) },
              { key: "corporate", label: el.account.ownerValues.corporate, href: query({ scope: "corporate" }) },
              { key: "personal", label: el.account.ownerValues.personal, href: query({ scope: "personal" }) },
            ]}
            active={scope ?? "all"}
          />
          <ViewSwitch
            label={t.horizon}
            options={FORECAST_HORIZONS.map((h) => ({ key: String(h), label: `${h} ${t.months}`, href: query({ months: h === 12 ? null : String(h) }) }))}
            active={String(months)}
          />
        </div>
        <p className="text-small text-muted">{t.scenarioHint[scenario as ForecastScenario]}</p>
      </div>

      <StatRow>
        <Stat label={t.liquidNow} value={formatMoney(first?.opening_balance ?? 0)} />
        <Stat label={t.buffer} value={formatMoney(buffer)} />
        <Stat
          label={t.lowestClose}
          value={
            <span className={lowest && Number(lowest.closing_balance) < buffer ? "text-negative" : undefined}>
              {lowest ? formatMoney(lowest.closing_balance) : "—"}
            </span>
          }
          sub={lowest ? monthLabel(monthKeyOf(lowest.month)) : undefined}
        />
        <Stat
          label={t.firstBelow}
          value={
            <span className={firstBelow ? "text-negative" : undefined}>
              {firstBelow ? monthLabel(monthKeyOf(firstBelow.month)) : t.noneBelow}
            </span>
          }
        />
      </StatRow>

      <BarChart
        label={t.cashChartLabel}
        data={chartRows}
        xKey="label"
        series={[
          { key: "inflow", name: t.inflow, tone: "navy" },
          { key: "outflow", name: t.outflow, tone: "accent" },
          { key: "balance", name: t.closing, kind: "line", tone: "ink" },
        ]}
        threshold={{ value: buffer, label: t.buffer }}
      />

      <div className="grid min-w-0 grid-cols-1 gap-8 lg:grid-cols-[3fr_2fr]">
        <div className={FRAME}>
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  {t.month}
                </th>
                <th scope="col" className={cn(TH, "hidden text-right md:table-cell")}>
                  {t.opening}
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  {t.inflow}
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  {t.outflow}
                </th>
                <th scope="col" className={cn(TH, "hidden text-right sm:table-cell")}>
                  {t.net}
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  {t.closing}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = monthKeyOf(r.month);
                const isSelected = key === selected;
                return (
                  <tr key={key} aria-current={isSelected ? "true" : undefined} className={isSelected ? "bg-hover" : "hover:bg-hover"}>
                    <td className={cn(TD, "border-l-2 text-ink", isSelected ? "border-l-navy" : "border-l-transparent")}>
                      <Link
                        href={query({ month: key === todayMonth ? null : key })}
                        className={cn(LINK, "inline-flex items-center whitespace-nowrap max-md:min-h-11", isSelected && "font-medium")}
                        scroll={false}
                      >
                        {shortMonthYearLabel(key)}
                      </Link>
                      {r.below_buffer && (
                        <span className="ml-1.5">
                          <Badge tone="red">{t.belowBuffer}</Badge>
                        </span>
                      )}
                    </td>
                    <td className={cn(TD, NUM, "hidden md:table-cell")}>{formatMoney(r.opening_balance)}</td>
                    <td className={cn(TD, NUM)}>
                      {formatMoney(r.inflow)}
                      {Number(r.uncertain_inflow) > 0 && (
                        <span className="block text-xs text-muted">
                          {t.uncertainPart} {formatMoney(r.uncertain_inflow)}
                        </span>
                      )}
                    </td>
                    <td className={cn(TD, NUM)}>{formatMoney(r.outflow)}</td>
                    <td className={cn(TD, NUM, "hidden sm:table-cell")}>{formatMoney(r.net)}</td>
                    <td className={cn(TD, NUM, "font-medium text-ink")}>{formatMoney(r.closing_balance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <section className="flex min-w-0 flex-col gap-3">
          <SectionHeader title={`${t.breakdown}: ${monthLabel(selected)}`} />
          <p className="text-small text-muted">{t.breakdownHint}</p>
          {(items ?? []).length === 0 ? (
            <p className="text-sm text-muted">{t.noItems}</p>
          ) : (
            <div className="flex flex-col gap-6">
              <ItemList title={t.inflow} items={inflowItems} />
              <ItemList title={t.outflow} items={outflowItems} />
            </div>
          )}
        </section>
      </div>

      <section className="flex min-w-0 flex-col gap-3">
        <SectionHeader
          title={t.expectedTitle}
          actions={<ExpectedIncomeFormModal action={saveExpectedIncome} projects={lookups.projects} />}
        />
        {(expected ?? []).length === 0 ? (
          <p className="text-sm text-muted">{t.expectedEmpty}</p>
        ) : (
          <div className={FRAME}>
            <table className={TABLE}>
              <tbody>
                {(expected ?? []).map((e) => {
                  const project = Array.isArray(e.projects) ? e.projects[0] : e.projects;
                  const probability = e.probability ?? (e.certainty === "certain" ? 1 : 0.5);
                  return (
                    <tr key={e.id} className={ROW}>
                      <td className="min-w-40 py-2.5 pr-3 align-middle text-ink">
                        {e.source}
                        {e.direction === "expense" && <span className="ml-1 text-xs text-muted">({el.transaction.expense})</span>}
                        {project && <span className="ml-1 text-xs text-muted">· {project.display_name}</span>}
                        {e.scenario_id && <span className="ml-1 text-xs text-muted">· {t.expectedFromScenario}</span>}
                      </td>
                      <td className="py-2.5 pr-3 align-middle whitespace-nowrap text-muted">
                        {e.expected_month ? monthLabel(monthKeyOf(e.expected_month)) : "—"}
                      </td>
                      <td className={cn("py-2.5 pr-3 align-middle text-ink", NUM)}>{formatMoney(e.amount)}</td>
                      <td className={cn("py-2.5 pr-3 align-middle text-xs text-muted", NUM)}>{Math.round(probability * 100)}%</td>
                      <td className="py-1.5 align-middle">
                        {!e.scenario_id && (
                          <div className="flex items-center justify-end gap-1">
                            <ExpectedIncomeFormModal
                              action={saveExpectedIncome}
                              id={e.id}
                              projects={lookups.projects}
                              trigger={el.common.edit}
                              initial={{
                                source: e.source,
                                amount: Number(e.amount),
                                expected_month: e.expected_month,
                                probability: e.probability,
                                project_id: e.project_id,
                                owner_scope: e.owner_scope as ForecastScope,
                                notes: e.notes,
                              }}
                            />
                            <ArgsActionForm action={setExpectedIncomeStatus} args={[e.id, "received"]}>
                              <Button type="submit" variant="ghost" size="sm" className={TOUCH}>
                                {t.expectedReceived}
                              </Button>
                            </ArgsActionForm>
                            <ArgsActionForm action={setExpectedIncomeStatus} args={[e.id, "cancelled"]}>
                              <Button type="submit" variant="ghost" size="sm" className={TOUCH}>
                                {t.expectedCancel}
                              </Button>
                            </ArgsActionForm>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

type Item = {
  item_key: string;
  source: string;
  ref_id: string;
  label: string;
  due_date: string;
  is_overdue: boolean;
  amount: number;
  probability: number;
  weighted_amount: number;
};

function itemHref(i: Item): string | null {
  if (i.item_key.startsWith("tx:")) return `/transactions?ids=${i.ref_id}`;
  if (i.source === "deal") return "/projects/deals";
  if (i.source === "vat") return "/reports/vat";
  if (i.source === "withholding") return "/reports/withholding";
  if (i.source === "liability") return "/reports/net-worth";
  return null;
}

function ItemList({ title, items }: { title: string; items: Item[] }) {
  if (items.length === 0) return null;
  const t = el.reports;
  const total = items.reduce((s, i) => s + Number(i.weighted_amount), 0);
  return (
    <div>
      <div className="flex justify-between gap-3 border-b border-rule pb-2">
        <span className="eyebrow text-muted">{title}</span>
        <span className="num text-sm text-ink">{formatMoney(total)}</span>
      </div>
      <ul className="flex flex-col text-sm">
        {items.map((i) => {
          const href = itemHref(i);
          const sourceLabel = t.sources[i.source as keyof typeof t.sources] ?? i.source;
          return (
            <li
              key={i.item_key}
              className={cn(ROW, "flex items-start justify-between gap-3 py-2.5", i.is_overdue && "border-l-2 border-l-negative pl-3")}
            >
              <span className="min-w-0 text-ink">
                {href ? (
                  <Link href={href} className={LINK}>
                    {i.label || sourceLabel}
                  </Link>
                ) : (
                  i.label || sourceLabel
                )}
                <span className={SUB}>
                  {sourceLabel} · {formatDate(i.due_date)}
                  {i.is_overdue && <span className="text-negative"> · {t.overdue}</span>}
                  {Number(i.probability) < 1 && ` · ${Math.round(Number(i.probability) * 100)}%`}
                </span>
              </span>
              <span className={cn("shrink-0 text-ink", NUM)}>
                {formatMoney(i.weighted_amount)}
                {Number(i.weighted_amount) !== Number(i.amount) && (
                  <span className="block text-xs text-muted">{formatMoney(i.amount)}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
