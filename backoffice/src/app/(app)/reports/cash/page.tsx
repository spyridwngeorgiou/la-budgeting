import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney, formatPercent, formatSignedMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import {
  Badge,
  KpiBand,
  LINK_CLASS,
  NUM_CLASS,
  PageHeader,
  ReportChart,
  ReportDetail,
  ReportFooter,
  ReportHeadline,
  ReportMethod,
  ReportSection,
  SUB_CLASS,
  SectionHeader,
  Segmented,
  SpecTable,
  Td,
  Th,
  Tr,
  ViewSwitch,
  cn,
} from "@/components/ui";
import { BandChart } from "@/components/ui/BandChart";
import { BarChart } from "@/components/ui/BarChart";
import { addMonths, currentMonthKey, todayAthens, firstOfMonth, isMonthKey, monthKeyOf, monthLabel, shortMonthYearLabel } from "@/lib/dates";
import { cashNarrative } from "@/lib/finance/narratives";
import {
  FORECAST_HORIZONS,
  FORECAST_SCENARIOS,
  parseHorizon,
  parseScenario,
  parseScope,
  type ForecastScenario,
} from "@/lib/finance/forecastParams";
import { accountBalancesAt, change, contributors, latestUpTo, sumParts, topMovements, vsTarget, whyText } from "@/lib/finance/insights";
import { largestOutflow, outflowBySourceRows, scenarioBalanceRows, type OutflowGroup } from "./cashCharts";
import { ChangePanel, KpiLink, ManageLink, TargetPanel, TopMovements } from "../Insights";

// Ταμείο & Πρόβλεψη -- «Θα έχουμε λεφτά;». Every figure comes from
// cash_forecast() / cash_forecast_items() (0066/0090) -- the same SQL the
// dashboard and the assistant read -- so this page computes nothing of its
// own: it picks the scenario, scope and horizon, and lays the rows out in
// the report anatomy (components/ui/ReportSection). Read-only: the expected
// income it lists is managed on /accounts/expected.
//
// Cloudflare CPU: one forecast by default; the other two scenarios are read
// only with «Σύγκριση σεναρίων» on (?compare=1). «Τι άλλαξε» reads the
// liquid accounts and their paid months (the projects lookup the old form
// needed is gone, so the tab has one query more than before).

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

// Texts new to this tab (the rest are el.reports).
const T = {
  question: "Θα έχουμε λεφτά;",
  balanceTitle: "Υπόλοιπο ταμείου στο τέλος κάθε μήνα",
  compare: "Σύγκριση σεναρίων",
  compareOff: "Ένα σενάριο",
  compareOn: "Και τα τρία",
  belowMarked: "Μήνες κάτω από το απόθεμα",
  driversTitle: "Τι κινεί το ταμείο",
  driversCaption: "Εκροές ανά μήνα κατά πηγή, σε δική τους κλίμακα",
  driversLabel: "Εκροές ανά μήνα κατά πηγή",
  uncertain: "Αβέβαια έσοδα",
  uncertainSub: (n: number) => `σταθμισμένα, σε ${n} μήνες`,
  lowestSub: "χαμηλότερο σημείο",
  bufferSub: (amount: string) => `απόθεμα ${amount}`,
  byMonth: "Ανά μήνα",
  changeTitle: "Τι άλλαξε στα ρευστά",
  vsEndOf: (m: string) => `Έναντι τέλους ${m}`,
  movesCaption: (m: string) => `πρόβλεψη, ${m}`,
  lowestVsBuffer: "Χαμηλότερο έναντι αποθέματος",
  monthsBelow: "Μήνες κάτω από το απόθεμα",
  monthsBelowSub: (n: number) => `από ${n} μήνες`,
  targetCaption: "Η πρόβλεψη έναντι του αποθέματος ασφαλείας· προβλέψεις προηγούμενων μηνών δεν κρατούνται",
  groups: {
    open: "Ανοιχτές πληρωμές & έργα",
    installment: "Δόσεις & μισθώματα",
    loan: "Δάνεια & υποχρεώσεις",
    vat: "ΦΠΑ",
    withholding: "Παρακράτηση",
    other: "Λοιπά",
  } satisfies Record<OutflowGroup, string>,
  method: [
    "Το υπόλοιπο κάθε μήνα είναι το άνοιγμα συν τις εισροές μείον τις εκροές του μήνα· το άνοιγμα του πρώτου μήνα είναι τα σημερινά ρευστά.",
    "Τα σενάρια διαφέρουν μόνο στα αβέβαια: το βασικό σταθμίζει τα αβέβαια έσοδα με την πιθανότητά τους, το αισιόδοξο τα μετρά όλα στο 100%, το απαισιόδοξο κρατά μόνο τα βέβαια έσοδα και μετρά όλα τα έξοδα στο 100%. Οι συμβατικές κινήσεις είναι ίδιες και στα τρία.",
    "«Τι κινεί το ταμείο»: οι εκροές του επιλεγμένου σεναρίου ανά μήνα, ομαδοποιημένες κατά πηγή· το σύνολο κάθε στήλης είναι οι «Εκροές» του πίνακα.",
    "«Τι άλλαξε στα ρευστά»: το σημερινό υπόλοιπο των ρευστών λογαριασμών έναντι του τέλους του προηγούμενου μήνα και του ίδιου μήνα πέρσι, με τους λογαριασμούς που το κίνησαν περισσότερο. «Μεγαλύτερες κινήσεις»: οι μεγαλύτερες προβλεπόμενες εισροές και εκροές του επιλεγμένου μήνα.",
    "Τα αναμενόμενα έσοδα καταχωρίζονται στους Λογαριασμούς → Αναμενόμενα έσοδα.",
  ],
};

export default async function CashPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const scenario = parseScenario(sp.scenario);
  const scope = parseScope(sp.scope);
  const months = parseHorizon(sp.months, 12);
  const compare = (Array.isArray(sp.compare) ? sp.compare[0] : sp.compare) === "1";
  const todayMonth = currentMonthKey();
  const selectedRaw = Array.isArray(sp.month) ? sp.month[0] : sp.month;
  const selected = isMonthKey(selectedRaw) ? selectedRaw : todayMonth;
  const horizonEnd = firstOfMonth(addMonths(todayMonth, months));

  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const forecastOf = (s: ForecastScenario) =>
    supabase.rpc("cash_forecast", { p_org: orgId, p_months: months, p_scenario: s, p_scope: scope ?? undefined });
  const others = compare ? FORECAST_SCENARIOS.filter((s) => s !== scenario) : [];

  const lastMonth = addMonths(todayMonth, -1);
  const yearAgo = addMonths(todayMonth, -12);
  const today = todayAthens();

  const [{ data: forecast, error }, { data: items }, { data: horizonOut }, { data: expected }, { data: liquidAccounts }, { data: ledger }, ...otherForecasts] =
    await Promise.all([
      forecastOf(scenario),
      supabase.rpc("cash_forecast_items", {
        p_org: orgId,
        p_month: firstOfMonth(selected),
        p_scenario: scenario,
        p_scope: scope ?? undefined,
      }),
      // Every outflow of the horizon, for «Τι κινεί το ταμείο» and the
      // headline's driver (the lowest month's largest outflow).
      supabase
        .rpc("cash_forecast_items", { p_org: orgId, p_scenario: scenario, p_scope: scope ?? undefined })
        .select("month, source, label, weighted_amount")
        .eq("direction", "expense")
        .lt("month", horizonEnd),
      supabase
        .from("expected_income")
        .select("id, source, amount, expected_month, probability, certainty, scenario_id, direction, projects(display_name)")
        .eq("org_id", orgId)
        .eq("status", "expected")
        .order("expected_month"),
      // «Τι άλλαξε»: the liquid accounts today and their paid months since
      // the same month last year (as on /reports/net-worth).
      supabase
        .from("v_account_balances")
        .select("account_id, name, current_balance, opening_balance_date")
        .eq("org_id", orgId)
        .eq("is_liquid", true),
      supabase
        .from("v_account_ledger_monthly")
        .select("account_id, month, inflow, outflow")
        .eq("org_id", orgId)
        .gt("month", yearAgo),
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

  // The balance per scenario: the selected one first (annotated, marked).
  const byScenario: Record<string, typeof rows> = { [scenario]: rows };
  others.forEach((s, i) => (byScenario[s] = otherForecasts[i]?.data ?? []));
  const balanceData = scenarioBalanceRows(byScenario, shortMonthYearLabel);
  const balanceSeries = [scenario, ...others].map((s) => ({ key: s, name: t.scenarios[s] }));

  const outItems = (horizonOut ?? []) as { month: string | null; source: string | null; label: string | null; weighted_amount: number | null }[];
  const drivers = outflowBySourceRows(rows, outItems, shortMonthYearLabel);
  const lowestKey = lowest ? monthKeyOf(lowest.month) : null;
  const driverItem = lowestKey ? largestOutflow(outItems, lowestKey) : null;
  const driverName = driverItem ? driverItem.label?.trim() || t.sources[driverItem.source as keyof typeof t.sources] || null : null;

  const query = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | null> = {
      scenario: scenario === "base" ? null : scenario,
      scope,
      months: months === 12 ? null : String(months),
      month: selected === todayMonth ? null : selected,
      compare: compare ? "1" : null,
      ...patch,
    };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/reports/cash?${s}` : "/reports/cash";
  };

  const inflowItems = (items ?? []).filter((i) => i.direction === "income");
  const outflowItems = (items ?? []).filter((i) => i.direction === "expense");

  // «Τι άλλαξε»: the liquid balance now against the end of last month and
  // of the same month last year, and the accounts that moved it most.
  const at = (m: string) => accountBalancesAt(liquidAccounts ?? [], ledger ?? [], m, todayMonth);
  const liquidParts = at(todayMonth);
  const changes =
    (liquidAccounts ?? []).length === 0
      ? []
      : [lastMonth, yearAgo].map((m) => {
          const before = at(m);
          return {
            label: T.vsEndOf(monthLabel(m)),
            change: change(sumParts(liquidParts), sumParts(before)),
            why: whyText(contributors(liquidParts, before)),
            href: "/accounts",
          };
        });
  // «Μεγαλύτερες κινήσεις»: the selected month's largest items, inflows
  // positive, outflows negative.
  const topItems = topMovements(
    ((items ?? []) as Item[]).map((i) => ({
      id: i.item_key.startsWith("tx:") ? i.ref_id : null,
      date: i.due_date,
      label: i.label?.trim() || t.sources[i.source as keyof typeof t.sources] || i.source,
      amount: (i.direction === "income" ? 1 : -1) * Number(i.weighted_amount ?? 0),
      href: i.item_key.startsWith("tx:") ? null : itemHref(i),
    })),
  );
  // Σε σχέση με τον στόχο: the forecast against the safety buffer.
  const lowestVsBuffer = lowest ? vsTarget(Number(lowest.closing_balance), buffer) : null;
  const monthsBelow = rows.filter((r) => r.below_buffer).length;
  const coverage = latestUpTo((ledger ?? []).map((l) => l.month), today);

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <PageHeader title={t.cashTitle} meta={T.question} />

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

      <ReportSection label={t.cashTitle}>
        {lowest && (
          <ReportHeadline>
            {cashNarrative({
              lowest: { amount: Number(lowest.closing_balance), month: monthKeyOf(lowest.month) },
              driver: driverName ? `«${driverName}»` : null,
              firstBelowBuffer: firstBelow ? monthKeyOf(firstBelow.month) : null,
              buffer,
              horizonMonths: months,
            })}
          </ReportHeadline>
        )}

        <KpiBand
          items={[
            { label: t.liquidNow, value: <KpiLink href="/accounts">{formatMoney(first?.opening_balance ?? 0)}</KpiLink> },
            {
              label: t.lowestClose,
              value: (
                <KpiLink href={lowestKey ? query({ month: lowestKey === todayMonth ? null : lowestKey }) : null}>
                  <span className={lowest && Number(lowest.closing_balance) < buffer ? "text-negative" : undefined}>
                    {lowest ? formatMoney(lowest.closing_balance) : "—"}
                  </span>
                </KpiLink>
              ),
              sub: lowest ? monthLabel(monthKeyOf(lowest.month)) : undefined,
            },
            {
              label: t.firstBelow,
              value: (
                <KpiLink href={firstBelow ? query({ month: monthKeyOf(firstBelow.month) === todayMonth ? null : monthKeyOf(firstBelow.month) }) : null}>
                  <span className={firstBelow ? "text-negative" : undefined}>
                    {firstBelow ? monthLabel(monthKeyOf(firstBelow.month)) : t.noneBelow}
                  </span>
                </KpiLink>
              ),
              sub: T.bufferSub(formatMoney(buffer)),
            },
            {
              label: T.uncertain,
              value: <KpiLink href="/accounts/expected">{formatMoney(uncertainTotal)}</KpiLink>,
              sub: T.uncertainSub(months),
            },
          ]}
        />

        <ChangePanel title={T.changeTitle} items={changes} coverage={coverage} />

        {lowest && lowestVsBuffer && (
          <TargetPanel
            caption={T.targetCaption}
            items={[
              {
                label: T.lowestVsBuffer,
                value: (
                  <span className={(lowestVsBuffer.gap ?? 0) < 0 ? "text-negative" : undefined}>
                    {formatSignedMoney(lowestVsBuffer.gap)}
                  </span>
                ),
                sub: `${monthLabel(monthKeyOf(lowest.month))}${lowestVsBuffer.share != null && lowestVsBuffer.share >= 0 ? ` · ${formatPercent(lowestVsBuffer.share, { digits: 0 })} του αποθέματος` : ""}`,
              },
              {
                label: T.monthsBelow,
                value: <span className={monthsBelow > 0 ? "text-negative" : undefined}>{String(monthsBelow)}</span>,
                sub: T.monthsBelowSub(rows.length),
              },
            ]}
          />
        )}

        {balanceData.length > 0 && (
          <ReportChart
            title={T.balanceTitle}
            caption={compare ? `${months} ${t.months} · ${balanceSeries.map((s) => s.name).join(", ")}` : `${months} ${t.months} · ${t.scenarios[scenario]}`}
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

        {drivers.groups.length > 0 && (
          <ReportChart title={T.driversTitle} caption={T.driversCaption}>
            <BarChart
              data={drivers.data}
              xKey="label"
              stacked
              series={drivers.groups.map((g) => ({ key: g, name: T.groups[g] }))}
              label={T.driversLabel}
            />
          </ReportChart>
        )}

        <ReportDetail title={T.byMonth} meta={`${rows.length} ${t.months}`}>
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
                        href={query({ month: key === todayMonth ? null : key })}
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
        </ReportDetail>

        <section className="flex min-w-0 flex-col gap-4">
          <SectionHeader title={`${t.breakdown}: ${monthLabel(selected)}`} />
          <p className="text-small text-muted">{t.breakdownHint}</p>
          {(items ?? []).length === 0 ? (
            <p className="text-body text-muted">{t.noItems}</p>
          ) : (
            <div className="flex flex-col gap-6">
              <ItemList title={t.inflow} items={inflowItems} />
              <ItemList title={t.outflow} items={outflowItems} />
            </div>
          )}
        </section>

        <TopMovements rows={topItems} caption={T.movesCaption(monthLabel(selected))} />

        <section className="flex min-w-0 flex-col gap-4">
          {/* Read-only: managed on Λογαριασμοί → Αναμενόμενα έσοδα. */}
          <SectionHeader title={t.expectedTitle} actions={<ManageLink href="/accounts/expected" />} />
          {(expected ?? []).length === 0 ? (
            <p className="text-body text-muted">{t.expectedEmpty}</p>
          ) : (
            <SpecTable label={t.expectedTitle}>
              <tbody>
                {(expected ?? []).map((e) => {
                  const project = Array.isArray(e.projects) ? e.projects[0] : e.projects;
                  const probability = e.probability ?? (e.certainty === "certain" ? 1 : 0.5);
                  return (
                    <Tr key={e.id}>
                      <Td strong className="min-w-40">
                        {e.source}
                        {e.direction === "expense" && <span className="ml-1 text-small text-muted">({el.transaction.expense})</span>}
                        {project && <span className="ml-1 text-small text-muted">· {project.display_name}</span>}
                        {e.scenario_id && <span className="ml-1 text-small text-muted">· {t.expectedFromScenario}</span>}
                      </Td>
                      <Td className="whitespace-nowrap text-muted">
                        {e.expected_month ? monthLabel(monthKeyOf(e.expected_month)) : "—"}
                      </Td>
                      <Td numeric strong>
                        {formatMoney(e.amount)}
                      </Td>
                      <Td numeric className="text-small text-muted">
                        {Math.round(probability * 100)}%
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </SpecTable>
          )}
        </section>

        <ReportMethod>
          <p>{t.cashIntro}</p>
          {T.method.map((m, i) => (
            <p key={i}>{m}</p>
          ))}
        </ReportMethod>
        <ReportFooter dataUntil={coverage ?? today} />
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
  if (i.source === "withholding") return "/reports/withholding";
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
    <div>
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
