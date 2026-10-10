import Link from "next/link";
import { Amount, Badge, ButtonLink, DataTable, MenuLink, MenuSeparator, SectionHeader, Segmented, Stat, StatRow, Toolbar, type Column } from "@/components/ui";
import { TrendChart } from "@/components/ui/TrendChart";
import { formatDate, formatMoney } from "@/lib/format";
import { currentMonthKey, firstOfMonth, isMonthKey, monthKeyOf, monthLabel, shortMonthYearLabel } from "@/lib/dates";
import { el } from "@/lib/i18n/el";
import { money } from "@/lib/i18n/v2/money";
import { withParams } from "@/lib/url";
import { FORECAST_HORIZONS, FORECAST_SCENARIOS, parseHorizon, parseScenario, parseScope } from "@/lib/finance/forecastParams";
import type { DealStage } from "@/lib/domain/enums";
import type { Params } from "./filters";
import { loadOptions, one, requireInternal } from "./data";
import { closeBrokerageDeal, removeBrokerageDeal, saveBrokerageDeal, saveExpected, setExpectedStatus } from "./actions";
import { RowAction, UrlDrawer } from "./client";
import { DealFields, ExpectedFields } from "./fields";

// «Ροή»: the cash forecast, cash_forecast() / cash_forecast_items() (0066)
// -- the same SQL as «Σήμερα» and the assistant; nothing is computed here
// -- with the two hand-kept inputs under it: expected income and the
// brokerage deals (still brokerage_deals until Phase 7), each edited in a
// drawer (?income=<id|new>, ?deal=<id|new>).

const PATH = "/money/flow";
const r = el.reports;
const t = money.flow;
const signed = (v: number) => <Amount value={v} format={formatMoney} />;
const OPEN_STAGES: DealStage[] = ["lead", "offer", "preliminary"];

export async function FlowTab({ sp }: { sp: Params }) {
  const { supabase, orgId, canEdit } = await requireInternal();
  const scenario = parseScenario(sp.scenario);
  const scope = parseScope(sp.scope);
  const months = parseHorizon(sp.months, 12);
  const todayMonth = currentMonthKey();
  const selected = isMonthKey(one(sp.month)) ? one(sp.month)! : todayMonth;
  const view = { scenario: one(sp.scenario), scope: one(sp.scope), months: one(sp.months), month: one(sp.month) };
  const here = (changes: Record<string, string | null> = {}) => withParams(PATH, view, changes);

  const [forecast, items, expected, deals, weights, options] = await Promise.all([
    supabase.rpc("cash_forecast", { p_org: orgId, p_months: months, p_scenario: scenario, p_scope: scope ?? undefined }),
    supabase.rpc("cash_forecast_items", { p_org: orgId, p_month: firstOfMonth(selected), p_scenario: scenario, p_scope: scope ?? undefined }),
    supabase
      .from("expected_income")
      .select("id, source, amount, expected_month, probability, certainty, project_id, contact_id, owner_scope, notes, scenario_id, direction, projects(display_name)")
      .eq("org_id", orgId)
      .eq("status", "expected")
      .order("expected_month"),
    supabase
      .from("brokerage_deals")
      .select("id, property_label, price, commission_pct, commission_amount, stage, expected_close_date, client_contact_id, project_id, notes, contacts(name)")
      .eq("org_id", orgId)
      .in("stage", OPEN_STAGES)
      .order("expected_close_date", { ascending: true, nullsFirst: false }),
    supabase.from("v_cash_forecast_items").select("ref_id, amount, probability").eq("org_id", orgId).eq("source", "deal"),
    loadOptions(supabase, orgId, ["contacts", "projects"]),
  ]);
  if (forecast.error) throw forecast.error;

  const rows = forecast.data ?? [];
  const first = rows[0];
  const buffer = Number(first?.min_buffer ?? 0);
  const firstBelow = rows.find((m) => m.below_buffer);
  const lowest = rows.reduce<(typeof rows)[number] | null>((lo, m) => (!lo || Number(m.closing_balance) < Number(lo.closing_balance) ? m : lo), null);
  const chart = rows.map((m) => ({ label: shortMonthYearLabel(monthKeyOf(m.month)), closing: Number(m.closing_balance) }));
  const weighted = new Map((weights.data ?? []).map((w) => [w.ref_id, Number(w.amount) * Number(w.probability)]));

  type Month = (typeof rows)[number];
  const monthColumns: Column<Month>[] = [
    {
      key: "month",
      header: r.month,
      cell: (m) => {
        const key = monthKeyOf(m.month);
        return (
          <span className="inline-flex flex-wrap items-center gap-1.5 whitespace-nowrap">
            <Link href={here({ month: key === todayMonth ? null : key })} scroll={false} className={key === selected ? "text-ink underline underline-offset-4" : "text-ink hover:underline"}>
              {shortMonthYearLabel(key)}
            </Link>
            {m.below_buffer && <Badge tone="negative">{r.belowBuffer}</Badge>}
          </span>
        );
      },
    },
    { key: "opening", header: r.opening, numeric: true, cell: (m) => formatMoney(m.opening_balance) },
    { key: "in", header: r.inflow, numeric: true, cell: (m) => signed(Number(m.inflow)) },
    { key: "out", header: r.outflow, numeric: true, cell: (m) => signed(-Number(m.outflow)) },
    { key: "net", header: r.net, numeric: true, cell: (m) => signed(Number(m.net)) },
    { key: "closing", header: r.closing, numeric: true, cell: (m) => formatMoney(m.closing_balance) },
  ];

  type Item = NonNullable<typeof items.data>[number];
  const itemColumns: Column<Item>[] = [
    {
      key: "label",
      header: r.breakdown,
      primary: true,
      cell: (i) => (
        <span className="flex flex-col">
          <span>{i.label || r.sources[i.source as keyof typeof r.sources] || i.source}</span>
          <span className="text-small text-muted">
            {r.sources[i.source as keyof typeof r.sources] ?? i.source} · {formatDate(i.due_date)}
            {Number(i.probability) < 1 && ` · ${Math.round(Number(i.probability) * 100)}%`}
          </span>
        </span>
      ),
    },
    { key: "flag", header: "", cell: (i) => i.is_overdue && <Badge tone="negative">{r.overdue}</Badge> },
    {
      key: "amount",
      header: r.weighted,
      numeric: true,
      cell: (i) => signed(i.direction === "income" ? Number(i.weighted_amount) : -Number(i.weighted_amount)),
    },
  ];

  type Expected = NonNullable<typeof expected.data>[number];
  const expectedColumns: Column<Expected>[] = [
    {
      key: "source",
      header: r.expectedSource,
      primary: true,
      cell: (e) => (
        <span className="flex flex-col">
          <span>{e.source}</span>
          {(e.projects || e.scenario_id) && (
            <span className="text-small text-muted">
              {[(Array.isArray(e.projects) ? e.projects[0] : e.projects)?.display_name, e.scenario_id && r.expectedFromScenario].filter(Boolean).join(" · ")}
            </span>
          )}
        </span>
      ),
    },
    { key: "month", header: r.expectedMonth, cell: (e) => (e.expected_month ? monthLabel(monthKeyOf(e.expected_month)) : "—") },
    { key: "p", header: r.probability, numeric: true, cell: (e) => `${Math.round((e.probability ?? (e.certainty === "certain" ? 1 : 0.5)) * 100)}%` },
    { key: "amount", header: r.expectedAmount, numeric: true, cell: (e) => signed(e.direction === "expense" ? -Number(e.amount) : Number(e.amount)) },
  ];

  type Deal = NonNullable<typeof deals.data>[number];
  const dealColumns: Column<Deal>[] = [
    { key: "property", header: el.deals.property, primary: true, cell: (d) => d.property_label },
    { key: "client", header: el.deals.client, cell: (d) => (Array.isArray(d.contacts) ? d.contacts[0] : d.contacts)?.name ?? "—" },
    { key: "stage", header: el.deals.stage, cell: (d) => <Badge>{el.deals.stages[d.stage]}</Badge> },
    { key: "close", header: el.deals.expectedClose, cell: (d) => (d.expected_close_date ? formatDate(d.expected_close_date) : "—") },
    {
      key: "commission",
      header: el.deals.commission,
      numeric: true,
      cell: (d) => formatMoney(d.commission_amount ?? Math.round(Number(d.price) * Number(d.commission_pct) * 100) / 100),
    },
    { key: "weighted", header: t.weighted, numeric: true, cell: (d) => formatMoney(weighted.get(d.id) ?? 0) },
  ];

  const incomeId = canEdit ? one(sp.income) : null;
  const dealId = canEdit ? one(sp.deal) : null;
  const editingIncome = incomeId && incomeId !== "new" ? (expected.data ?? []).find((e) => e.id === incomeId && !e.scenario_id) : undefined;
  const editingDeal = dealId && dealId !== "new" ? (deals.data ?? []).find((d) => d.id === dealId) : undefined;
  const scopeOptions = [
    { key: "all", label: r.scopeAll, href: here({ scope: null }) },
    { key: "corporate", label: el.account.ownerValues.corporate, href: here({ scope: "corporate" }) },
    { key: "personal", label: el.account.ownerValues.personal, href: here({ scope: "personal" }) },
  ];

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-col gap-4">
        <Toolbar label={r.scenario}>
          <Segmented
            label={r.scenario}
            active={scenario}
            options={FORECAST_SCENARIOS.map((s) => ({ key: s, label: r.scenarios[s], href: here({ scenario: s === "base" ? null : s }) }))}
          />
          <Segmented label={r.scope} active={scope ?? "all"} options={scopeOptions} />
          <Segmented
            label={r.horizon}
            active={String(months)}
            options={FORECAST_HORIZONS.map((h) => ({ key: String(h), label: `${h} ${r.months}`, href: here({ months: h === 12 ? null : String(h) }) }))}
          />
        </Toolbar>
        <p className="text-small text-muted">{r.scenarioHint[scenario]}</p>
        <StatRow>
          <Stat label={r.liquidNow} value={formatMoney(first?.opening_balance ?? 0)} />
          <Stat label={r.buffer} value={formatMoney(buffer)} />
          <Stat
            label={r.lowestClose}
            value={<span className={lowest && Number(lowest.closing_balance) < buffer ? "text-negative" : undefined}>{lowest ? formatMoney(lowest.closing_balance) : "—"}</span>}
            sub={lowest ? monthLabel(monthKeyOf(lowest.month)) : undefined}
          />
          <Stat
            label={r.firstBelow}
            value={<span className={firstBelow ? "text-negative" : undefined}>{firstBelow ? monthLabel(monthKeyOf(firstBelow.month)) : r.noneBelow}</span>}
          />
        </StatRow>
        <TrendChart
          data={chart}
          xKey="label"
          series={[{ key: "closing", name: t.closing }]}
          format={formatMoney}
          threshold={buffer ? { value: buffer, label: r.buffer } : undefined}
          todayX={shortMonthYearLabel(todayMonth)}
          label={t.chart}
        />
      </div>

      <div className="grid gap-10 xl:grid-cols-[3fr_2fr]">
        <DataTable rows={rows} columns={monthColumns} rowKey={(m) => m.month} mode="scroll" caption={t.months} />
        <section className="flex flex-col gap-3">
          <SectionHeader as="h3" title={`${r.breakdown}: ${monthLabel(selected)}`} />
          <DataTable rows={items.data ?? []} columns={itemColumns} rowKey={(i) => i.item_key} empty={r.noItems} />
        </section>
      </div>

      <section className="flex flex-col gap-4">
        <SectionHeader
          numeral={1}
          title={r.expectedTitle}
          actions={canEdit && <ButtonLink href={here({ income: "new" })} variant="secondary" size="sm">+ {t.expectedAdd}</ButtonLink>}
        />
        <DataTable
          rows={expected.data ?? []}
          columns={expectedColumns}
          rowKey={(e) => e.id}
          empty={r.expectedEmpty}
          rowActions={
            canEdit
              ? (e) =>
                  e.scenario_id ? (
                    <p className="px-3 py-2 text-small text-muted">{t.managedByScenario}</p>
                  ) : (
                    <>
                      <MenuLink href={here({ income: e.id })}>{el.common.edit}</MenuLink>
                      <RowAction action={setExpectedStatus.bind(null, e.id, "received")}>{r.expectedReceived}</RowAction>
                      <RowAction action={setExpectedStatus.bind(null, e.id, "cancelled")}>{r.expectedCancel}</RowAction>
                    </>
                  )
              : undefined
          }
        />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader
          numeral={2}
          title={t.brokerage}
          actions={canEdit && <ButtonLink href={here({ deal: "new" })} variant="secondary" size="sm">+ {t.dealAdd}</ButtonLink>}
        />
        <DataTable
          rows={deals.data ?? []}
          columns={dealColumns}
          rowKey={(d) => d.id}
          empty={el.deals.empty}
          rowActions={
            canEdit
              ? (d) => (
                  <>
                    <MenuLink href={here({ deal: d.id })}>{el.common.edit}</MenuLink>
                    <RowAction action={closeBrokerageDeal.bind(null, d.id)} confirm={t.closeConfirm}>{el.deals.close}</RowAction>
                    <MenuSeparator />
                    <RowAction action={removeBrokerageDeal.bind(null, d.id)} confirm={t.deleteConfirm} tone="danger">
                      {el.common.delete}
                    </RowAction>
                  </>
                )
              : undefined
          }
        />
      </section>

      {(incomeId === "new" || editingIncome) && (
        <UrlDrawer
          title={editingIncome ? r.expectedEdit : r.expectedAdd}
          action={saveExpected.bind(null, editingIncome?.id ?? null)}
          closeHref={here()}
        >
          <ExpectedFields initial={editingIncome} projects={options.projects} />
        </UrlDrawer>
      )}
      {(dealId === "new" || editingDeal) && (
        <UrlDrawer title={editingDeal ? el.deals.edit : el.deals.add} action={saveBrokerageDeal.bind(null, editingDeal?.id ?? null)} closeHref={here()}>
          <DealFields initial={editingDeal} contacts={options.contacts} projects={options.projects} />
        </UrlDrawer>
      )}
    </div>
  );
}
