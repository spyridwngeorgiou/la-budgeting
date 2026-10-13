import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney, formatSignedMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import {
  Badge,
  KpiBand,
  LINK_CLASS,
  NUM_CLASS,
  PageHeader,
  ReportChart,
  ReportFooter,
  ReportHistory,
  ReportSection,
  SUB_CLASS,
  Segmented,
  SpecTable,
  Td,
  Th,
  Tr,
  ViewSwitch,
  cn,
} from "@/components/ui";
import { BandChart } from "@/components/ui/BandChart";
import { addMonths, currentMonthKey, todayAthens, firstOfMonth, isMonthKey, monthKeyOf, monthLabel, shortMonthYearLabel } from "@/lib/dates";
import {
  FORECAST_HORIZONS,
  FORECAST_SCENARIOS,
  parseHorizon,
  parseScenario,
  parseScope,
  type ForecastScenario,
} from "@/lib/finance/forecastParams";
import { accountBalancesAt, change, latestUpTo, sumParts, txIdsHref, vsPrevText, vsTarget } from "@/lib/finance/insights";
import { scenarioBalanceRows } from "./cashCharts";
import { KpiLink, reportIssues } from "../Insights";
import { ExportCsvLink } from "../ExportCsvLink";

// Ταμείο & Πρόβλεψη -- «Θα έχουμε λεφτά;». Every figure comes from
// cash_forecast() / cash_forecast_items() (0066/0090) -- the same SQL the
// dashboard and the assistant read -- so this page computes nothing of its
// own: it picks the scenario, scope and horizon, and lays the rows out in
// the report anatomy (components/ui/ReportSection): four figures, the
// balance chart, the month history (closed; ?month= opens it on that
// month's inflows and outflows). Read-only: expected income is managed on
// /accounts/expected.
//
// Cloudflare CPU: one forecast by default; the other two scenarios are read
// only with «Σύγκριση σεναρίων» on (?compare=1), a month's items only when
// a month is open (?month=).

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Texts new to this tab (the rest are el.reports).
const T = {
  meta: "Θα έχουμε λεφτά; Τα σημερινά ρευστά συν κάθε γνωστή μελλοντική κίνηση, μήνα προς μήνα· τα σενάρια διαφέρουν μόνο στα αβέβαια έσοδα.",
  balanceTitle: "Υπόλοιπο ταμείου στο τέλος κάθε μήνα",
  compare: "Σύγκριση σεναρίων",
  compareOff: "Ένα σενάριο",
  compareOn: "Και τα τρία",
  belowMarked: "Μήνες κάτω από το απόθεμα",
  liquidSub: "ρευστοί λογαριασμοί",
  lowestSub: (amount: string, month: string, gap: string) => `χαμηλότερο ${amount} · ${month} (${gap})`,
  monthsBelowSub: (n: number, of: number) => `${n} από ${of} μήνες κάτω από το απόθεμα`,
  expected: "Αναμενόμενα έσοδα",
  expectedSub: (n: number, uncertain: string) => `${n} ${n === 1 ? "εγγραφή" : "εγγραφές"} · αβέβαια στην πρόβλεψη ${uncertain}`,
  openInTransactions: "Άνοιγμα στις κινήσεις →",
};

export default async function CashPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const scenario = parseScenario(sp.scenario);
  const scope = parseScope(sp.scope);
  const months = parseHorizon(sp.months, 12);
  const compare = (Array.isArray(sp.compare) ? sp.compare[0] : sp.compare) === "1";
  const todayMonth = currentMonthKey();
  const selectedRaw = Array.isArray(sp.month) ? sp.month[0] : sp.month;
  // The drill-down: a month picked in the history opens it on that month.
  const selected = isMonthKey(selectedRaw) ? selectedRaw : null;

  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const forecastOf = (s: ForecastScenario) =>
    supabase.rpc("cash_forecast", { p_org: orgId, p_months: months, p_scenario: s, p_scope: scope ?? undefined });
  const others = compare ? FORECAST_SCENARIOS.filter((s) => s !== scenario) : [];

  const lastMonth = addMonths(todayMonth, -1);
  const today = todayAthens();

  const [{ data: forecast, error }, { data: items }, { data: expected }, { data: liquidAccounts }, { data: ledger }, issues, ...otherForecasts] =
    await Promise.all([
      forecastOf(scenario),
      selected
        ? supabase.rpc("cash_forecast_items", {
            p_org: orgId,
            p_month: firstOfMonth(selected),
            p_scenario: scenario,
            p_scope: scope ?? undefined,
          })
        : Promise.resolve({ data: [] as Item[] }),
      // «Αναμενόμενα έσοδα»: the open entries of Λογαριασμοί → Αναμενόμενα.
      supabase.from("expected_income").select("amount, direction").eq("org_id", orgId).eq("status", "expected"),
      // The liquid balance now against the end of last month.
      supabase
        .from("v_account_balances")
        .select("account_id, name, current_balance, opening_balance_date")
        .eq("org_id", orgId)
        .eq("is_liquid", true),
      supabase
        .from("v_account_ledger_monthly")
        .select("account_id, month, inflow, outflow")
        .eq("org_id", orgId)
        .gte("month", lastMonth),
      reportIssues(supabase, orgId, "cash"),
      ...others.map((s) => forecastOf(s)),
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
  const uncertainTotal = rows.reduce((s, r) => s + Number(r.uncertain_inflow ?? 0), 0);
  const monthsBelow = rows.filter((r) => r.below_buffer).length;

  // The balance per scenario: the selected one first (annotated, marked).
  const byScenario: Record<string, typeof rows> = { [scenario]: rows };
  others.forEach((s, i) => (byScenario[s] = otherForecasts[i]?.data ?? []));
  const balanceData = scenarioBalanceRows(byScenario, shortMonthYearLabel);
  const balanceSeries = [scenario, ...others].map((s) => ({ key: s, name: t.scenarios[s] }));

  const query = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | null> = {
      scenario: scenario === "base" ? null : scenario,
      scope,
      months: months === 12 ? null : String(months),
      month: selected,
      compare: compare ? "1" : null,
      ...patch,
    };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/reports/cash?${s}` : "/reports/cash";
  };

  const monthItems = (items ?? []) as Item[];
  const inflowItems = monthItems.filter((i) => i.direction === "income");
  const outflowItems = monthItems.filter((i) => i.direction === "expense");
  const monthTxHref = txIdsHref(monthItems.filter((i) => i.item_key.startsWith("tx:")).map((i) => i.ref_id));

  // The liquid balance now against the end of last month.
  const liquidChange =
    (liquidAccounts ?? []).length === 0
      ? null
      : change(
          sumParts(accountBalancesAt(liquidAccounts ?? [], ledger ?? [], todayMonth, todayMonth)),
          sumParts(accountBalancesAt(liquidAccounts ?? [], ledger ?? [], lastMonth, todayMonth)),
        );
  const lowestKey = lowest ? monthKeyOf(lowest.month) : null;
  const lowestGap = lowest ? vsTarget(Number(lowest.closing_balance), buffer).gap : null;
  const expectedIncome = (expected ?? []).filter((e) => e.direction !== "expense");
  const expectedTotal = expectedIncome.reduce((s, e) => s + Number(e.amount ?? 0), 0);
  const coverage = latestUpTo((ledger ?? []).map((l) => l.month), today);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title={t.cashTitle} meta={T.meta} actions={<ExportCsvLink />} />

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

      <ReportSection label={t.cashTitle}>
        <KpiBand
          items={[
            {
              label: t.liquidNow,
              value: <KpiLink href="/accounts">{formatMoney(first?.opening_balance ?? 0)}</KpiLink>,
              sub: (liquidChange && vsPrevText(liquidChange)) ?? T.liquidSub,
            },
            {
              label: t.buffer,
              value: formatMoney(buffer),
              sub:
                lowest && lowestKey ? (
                  <Link href={query({ month: lowestKey })} scroll={false} className={cn(LINK_CLASS, (lowestGap ?? 0) < 0 && "text-negative")}>
                    {T.lowestSub(formatMoney(lowest.closing_balance), monthLabel(lowestKey), formatSignedMoney(lowestGap))}
                  </Link>
                ) : undefined,
            },
            {
              label: t.firstBelow,
              value: (
                <KpiLink href={firstBelow ? query({ month: monthKeyOf(firstBelow.month) }) : null}>
                  <span className={firstBelow ? "text-negative" : undefined}>
                    {firstBelow ? monthLabel(monthKeyOf(firstBelow.month)) : t.noneBelow}
                  </span>
                </KpiLink>
              ),
              sub: T.monthsBelowSub(monthsBelow, rows.length),
            },
            {
              label: T.expected,
              value: <KpiLink href="/accounts/expected">{formatMoney(expectedTotal)}</KpiLink>,
              sub: T.expectedSub(expectedIncome.length, formatMoney(uncertainTotal)),
            },
          ]}
        />

        {balanceData.length > 0 && (
          <ReportChart
            title={T.balanceTitle}
            caption={`${months} ${t.months} · ${compare ? balanceSeries.map((s) => s.name).join(", ") : `${t.scenarios[scenario]}: ${t.scenarioHint[scenario]}`}`}
            actions={
              <Segmented
                label={T.compare}
                options={[
                  { key: "off", label: T.compareOff, href: query({ compare: null }) },
                  { key: "on", label: T.compareOn, href: query({ compare: "1" }) },
                ]}
                active={compare ? "on" : "off"}
                className="[&>a]:pointer-coarse:min-h-11"
              />
            }
          >
            <BandChart
              data={balanceData}
              xKey="label"
              series={balanceSeries}
              label={T.balanceTitle}
              threshold={{ value: buffer, label: t.buffer }}
              markBelow={T.belowMarked}
            />
          </ReportChart>
        )}

        <ReportHistory count={rows.length} open>
          <SpecTable label={t.cashTitle} stickyFirst>
            <thead>
              <tr>
                {/* Same inset as the body's first cells, which carry the 2px marker. */}
                <Th className="border-l-2 border-l-transparent !pl-3">{t.month}</Th>
                <Th numeric className="hidden md:table-cell">
                  {t.opening}
                </Th>
                <Th numeric>{t.inflow}</Th>
                <Th numeric>{t.outflow}</Th>
                <Th numeric className="hidden sm:table-cell">
                  {t.net}
                </Th>
                <Th numeric>{t.closing}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = monthKeyOf(r.month);
                const isSelected = key === selected;
                return (
                  <Tr key={key} aria-current={isSelected ? "true" : undefined} className={isSelected ? "bg-hover" : undefined}>
                    <Td strong className={cn("border-l-2 !pl-3", isSelected ? "!bg-hover border-l-navy" : "border-l-transparent")}>
                      <Link
                        href={query({ month: isSelected ? null : key })}
                        className={cn(LINK_CLASS, "inline-flex items-center whitespace-nowrap max-md:min-h-11", isSelected && "font-medium")}
                        scroll={false}
                      >
                        {shortMonthYearLabel(key)}
                      </Link>
                      {r.below_buffer && (
                        <span className="ml-1.5">
                          <Badge tone="red">{t.belowBuffer}</Badge>
                        </span>
                      )}
                    </Td>
                    <Td numeric className="hidden md:table-cell">
                      {formatMoney(r.opening_balance)}
                    </Td>
                    <Td numeric>
                      {formatMoney(r.inflow)}
                      {Number(r.uncertain_inflow) > 0 && (
                        <span className={SUB_CLASS}>
                          {t.uncertainPart} {formatMoney(r.uncertain_inflow)}
                        </span>
                      )}
                    </Td>
                    <Td numeric>{formatMoney(r.outflow)}</Td>
                    <Td numeric className="hidden sm:table-cell">
                      {formatMoney(r.net)}
                    </Td>
                    <Td numeric strong className="font-medium">
                      {formatMoney(r.closing_balance)}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </SpecTable>

          {selected ? (
            <section className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-hairline pb-2">
                <h3 className="text-body font-medium text-ink">
                  {t.breakdown}: {monthLabel(selected)}
                </h3>
                <span className="flex items-center gap-4 text-small">
                  {monthTxHref && (
                    <Link href={monthTxHref} className="inline-flex items-center text-ink underline underline-offset-4 max-md:min-h-11">
                      {T.openInTransactions}
                    </Link>
                  )}
                  <Link href={query({ month: null })} scroll={false} className="inline-flex items-center text-ink underline underline-offset-4 max-md:min-h-11">
                    {el.common.close}
                  </Link>
                </span>
              </div>
              {monthItems.length === 0 ? (
                <p className="text-body text-muted">{t.noItems}</p>
              ) : (
                <div className="grid min-w-0 grid-cols-1 gap-6 md:grid-cols-2">
                  <ItemList title={t.inflow} items={inflowItems} />
                  <ItemList title={t.outflow} items={outflowItems} />
                </div>
              )}
            </section>
          ) : (
            <p className="text-small text-muted">{t.breakdownHint}</p>
          )}
        </ReportHistory>

        <ReportFooter dataUntil={coverage ?? today} issues={issues} />
      </ReportSection>
    </div>
  );
}

type Item = {
  item_key: string;
  source: string;
  direction: string;
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
  // Παρακράτηση is a table on the ΦΠΑ tab.
  if (i.source === "withholding") return "/reports/vat";
  // The hand-kept rows open where they are managed.
  if (i.source === "liability") return "/accounts/assets";
  if (i.source === "expected") return "/accounts/expected";
  return null;
}

function ItemList({ title, items }: { title: string; items: Item[] }) {
  if (items.length === 0) return null;
  const t = el.reports;
  const total = items.reduce((s, i) => s + Number(i.weighted_amount), 0);
  return (
    <div className="min-w-0">
      <div className="flex justify-between gap-3 border-b border-rule pb-2">
        <span className="eyebrow text-muted">{title}</span>
        <span className="num text-body text-ink">{formatMoney(total)}</span>
      </div>
      <ul className="flex flex-col text-body">
        {items.map((i) => {
          const href = itemHref(i);
          const sourceLabel = t.sources[i.source as keyof typeof t.sources] ?? i.source;
          return (
            <li
              key={i.item_key}
              className={cn("flex items-start justify-between gap-3 border-b border-hairline py-2.5", i.is_overdue && "border-l-2 border-l-negative pl-3")}
            >
              <span className="min-w-0 text-ink">
                {href ? (
                  <Link href={href} className={LINK_CLASS}>
                    {i.label || sourceLabel}
                  </Link>
                ) : (
                  i.label || sourceLabel
                )}
                <span className={SUB_CLASS}>
                  {sourceLabel} · {formatDate(i.due_date)}
                  {i.is_overdue && <span className="text-negative"> · {t.overdue}</span>}
                  {Number(i.probability) < 1 && ` · ${Math.round(Number(i.probability) * 100)}%`}
                </span>
              </span>
              <span className={cn("shrink-0 text-ink", NUM_CLASS)}>
                {formatMoney(i.weighted_amount)}
                {Number(i.weighted_amount) !== Number(i.amount) && (
                  <span className={SUB_CLASS}>{formatMoney(i.amount)}</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
