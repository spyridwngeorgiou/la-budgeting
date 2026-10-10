import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Pills } from "@/components/Pills";
import { Badge, Card } from "@/components/ui";
import { ActionForm } from "@/components/ActionForm";
import { loadLookups } from "@/lib/data/lookups";
import { currentMonthKey, firstOfMonth, isMonthKey, monthKeyOf, monthLabel, shortMonthYearLabel } from "@/lib/dates";
import {
  FORECAST_HORIZONS,
  FORECAST_SCENARIOS,
  parseHorizon,
  parseScenario,
  parseScope,
  type ForecastScenario,
  type ForecastScope,
} from "@/lib/finance/forecastParams";
import { CashflowChart } from "./CashflowChart";
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

  const chartRows = rows.map((r) => {
    const key = monthKeyOf(r.month);
    return {
      month: key,
      label: shortMonthYearLabel(key),
      inflow: Number(r.inflow),
      outflow: Number(r.outflow),
      running: Number(r.closing_balance),
      isToday: key === todayMonth,
    };
  });

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
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">{t.cashTitle}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink-muted">{t.cashIntro}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <Pills
          label={t.scenario}
          options={FORECAST_SCENARIOS.map((s) => ({ key: s, label: t.scenarios[s], href: query({ scenario: s === "base" ? null : s }) }))}
          active={scenario}
        />
        <Pills
          label={t.scope}
          options={[
            { key: "all", label: t.scopeAll, href: query({ scope: null }) },
            { key: "corporate", label: el.account.ownerValues.corporate, href: query({ scope: "corporate" }) },
            { key: "personal", label: el.account.ownerValues.personal, href: query({ scope: "personal" }) },
          ]}
          active={scope ?? "all"}
        />
        <Pills
          label={t.horizon}
          options={FORECAST_HORIZONS.map((h) => ({ key: String(h), label: `${h} ${t.months}`, href: query({ months: h === 12 ? null : String(h) }) }))}
          active={String(months)}
        />
      </div>
      <p className="-mt-2 text-xs text-ink-faint">{t.scenarioHint[scenario as ForecastScenario]}</p>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
        <Card>
          <div className="text-xs text-ink-muted">{t.liquidNow}</div>
          <div className="font-mono text-lg">{formatMoney(first?.opening_balance ?? 0)}</div>
        </Card>
        <Card>
          <div className="text-xs text-ink-muted">{t.buffer}</div>
          <div className="font-mono text-lg">{formatMoney(buffer)}</div>
        </Card>
        <Card>
          <div className="text-xs text-ink-muted">{t.lowestClose}</div>
          <div className={`font-mono text-lg ${lowest && Number(lowest.closing_balance) < buffer ? "text-red-ink" : ""}`}>
            {lowest ? formatMoney(lowest.closing_balance) : "—"}
          </div>
          {lowest && <div className="text-xs text-ink-faint">{monthLabel(monthKeyOf(lowest.month))}</div>}
        </Card>
        <Card className={firstBelow ? "border-red-ink/40 bg-red-bg" : undefined}>
          <div className="text-xs text-ink-muted">{t.firstBelow}</div>
          <div className={`font-mono text-lg ${firstBelow ? "text-red-ink" : ""}`}>
            {firstBelow ? monthLabel(monthKeyOf(firstBelow.month)) : t.noneBelow}
          </div>
        </Card>
      </div>

      <CashflowChart rows={chartRows} buffer={buffer} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[3fr_2fr]">
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg text-ink-muted">
              <tr>
                <th className="p-2">{t.month}</th>
                <th className="hidden p-2 text-right md:table-cell">{t.opening}</th>
                <th className="p-2 text-right">{t.inflow}</th>
                <th className="p-2 text-right">{t.outflow}</th>
                <th className="hidden p-2 text-right sm:table-cell">{t.net}</th>
                <th className="p-2 text-right">{t.closing}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = monthKeyOf(r.month);
                const isSelected = key === selected;
                return (
                  <tr key={key} className={`border-t border-line ${isSelected ? "bg-sage/40" : ""}`}>
                    <td className="p-2">
                      <Link href={query({ month: key === todayMonth ? null : key })} className="hover:underline" scroll={false}>
                        {shortMonthYearLabel(key)}
                      </Link>
                      {r.below_buffer && (
                        <span className="ml-1.5">
                          <Badge tone="red">{t.belowBuffer}</Badge>
                        </span>
                      )}
                    </td>
                    <td className="hidden p-2 text-right font-mono md:table-cell">{formatMoney(r.opening_balance)}</td>
                    <td className="p-2 text-right font-mono text-sage-ink">
                      {formatMoney(r.inflow)}
                      {Number(r.uncertain_inflow) > 0 && (
                        <div className="text-[10px] font-normal text-ink-faint">
                          {t.uncertainPart} {formatMoney(r.uncertain_inflow)}
                        </div>
                      )}
                    </td>
                    <td className="p-2 text-right font-mono">{formatMoney(r.outflow)}</td>
                    <td className={`hidden p-2 text-right font-mono sm:table-cell ${Number(r.net) < 0 ? "text-red-ink" : ""}`}>
                      {formatMoney(r.net)}
                    </td>
                    <td className="p-2 text-right font-mono font-medium">{formatMoney(r.closing_balance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <section className="rounded-lg border border-line p-3">
          <h2 className="text-sm font-medium">
            {t.breakdown}: {monthLabel(selected)}
          </h2>
          <p className="mb-2 text-xs text-ink-faint">{t.breakdownHint}</p>
          {(items ?? []).length === 0 ? (
            <p className="text-sm text-ink-muted">{t.noItems}</p>
          ) : (
            <div className="flex flex-col gap-3">
              <ItemList title={t.inflow} items={inflowItems} />
              <ItemList title={t.outflow} items={outflowItems} />
            </div>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-line p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-sm font-medium">{t.expectedTitle}</h2>
          <ExpectedIncomeFormModal action={saveExpectedIncome.bind(null, null)} projects={lookups.projects} />
        </div>
        {(expected ?? []).length === 0 ? (
          <p className="text-sm text-ink-muted">{t.expectedEmpty}</p>
        ) : (
          <table className="w-full text-left text-sm">
            <tbody>
              {(expected ?? []).map((e) => {
                const project = Array.isArray(e.projects) ? e.projects[0] : e.projects;
                const probability = e.probability ?? (e.certainty === "certain" ? 1 : 0.5);
                return (
                  <tr key={e.id} className="border-t border-line first:border-0">
                    <td className="py-1.5 pr-2">
                      {e.source}
                      {e.direction === "expense" && <span className="ml-1 text-xs text-ink-faint">({el.transaction.expense})</span>}
                      {project && <span className="ml-1 text-xs text-ink-muted">· {project.display_name}</span>}
                      {e.scenario_id && <span className="ml-1 text-xs text-ink-faint">· {t.expectedFromScenario}</span>}
                    </td>
                    <td className="py-1.5 pr-2 text-ink-muted">{e.expected_month ? monthLabel(monthKeyOf(e.expected_month)) : "—"}</td>
                    <td className="py-1.5 pr-2 text-right font-mono">{formatMoney(e.amount)}</td>
                    <td className="py-1.5 pr-2 text-right text-xs text-ink-muted">{Math.round(probability * 100)}%</td>
                    <td className="py-1.5">
                      {!e.scenario_id && (
                        <div className="flex items-center justify-end gap-1.5">
                          <ExpectedIncomeFormModal
                            action={saveExpectedIncome.bind(null, e.id)}
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
                          <ActionForm action={setExpectedIncomeStatus.bind(null, e.id, "received")}>
                            <button type="submit" className="text-xs text-ink-muted underline">
                              {t.expectedReceived}
                            </button>
                          </ActionForm>
                          <ActionForm action={setExpectedIncomeStatus.bind(null, e.id, "cancelled")}>
                            <button type="submit" className="text-xs text-ink-muted underline">
                              {t.expectedCancel}
                            </button>
                          </ActionForm>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
  if (i.source === "liability") return "/reports/net-worth";
  return null;
}

function ItemList({ title, items }: { title: string; items: Item[] }) {
  if (items.length === 0) return null;
  const t = el.reports;
  const total = items.reduce((s, i) => s + Number(i.weighted_amount), 0);
  return (
    <div>
      <div className="mb-1 flex justify-between text-xs font-medium text-ink-muted">
        <span>{title}</span>
        <span className="font-mono">{formatMoney(total)}</span>
      </div>
      <ul className="flex flex-col gap-1 text-sm">
        {items.map((i) => {
          const href = itemHref(i);
          const sourceLabel = t.sources[i.source as keyof typeof t.sources] ?? i.source;
          return (
            <li key={i.item_key} className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                {href ? (
                  <Link href={href} className="hover:underline">
                    {i.label || sourceLabel}
                  </Link>
                ) : (
                  i.label || sourceLabel
                )}
                <span className="block text-xs text-ink-faint">
                  {sourceLabel} · {formatDate(i.due_date)}
                  {i.is_overdue && <span className="text-red-ink"> · {t.overdue}</span>}
                  {Number(i.probability) < 1 && ` · ${Math.round(Number(i.probability) * 100)}%`}
                </span>
              </span>
              <span className="shrink-0 text-right font-mono">
                {formatMoney(i.weighted_amount)}
                {Number(i.weighted_amount) !== Number(i.amount) && (
                  <span className="block text-[10px] text-ink-faint">{formatMoney(i.amount)}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
