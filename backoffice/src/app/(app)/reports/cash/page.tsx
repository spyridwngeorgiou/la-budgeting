import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import {
  Badge,
  Button,
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
import { ArgsActionForm } from "@/components/ArgsActionForm";
import { BandChart } from "@/components/ui/BandChart";
import { BarChart } from "@/components/ui/BarChart";
import { loadLookups } from "@/lib/data/lookups";
import { addMonths, currentMonthKey, todayAthens, firstOfMonth, isMonthKey, monthKeyOf, monthLabel, shortMonthYearLabel } from "@/lib/dates";
import { cashNarrative } from "@/lib/finance/narratives";
import {
  FORECAST_HORIZONS,
  FORECAST_SCENARIOS,
  parseHorizon,
  parseScenario,
  parseScope,
  type ForecastScenario,
  type ForecastScope,
} from "@/lib/finance/forecastParams";
import { largestOutflow, outflowBySourceRows, scenarioBalanceRows, type OutflowGroup } from "./cashCharts";
import { ExpectedIncomeFormModal } from "./ExpectedIncomeFormModal";
import { saveExpectedIncome, setExpectedIncomeStatus } from "./actions";

// Ταμείο & Πρόβλεψη -- «Θα έχουμε λεφτά;». Every figure comes from
// cash_forecast() / cash_forecast_items() (0066/0090) -- the same SQL the
// dashboard and the assistant read -- so this page computes nothing of its
// own: it picks the scenario, scope and horizon, and lays the rows out in
// the report anatomy (components/ui/ReportSection).
//
// Cloudflare CPU: one forecast by default; the other two scenarios are read
// only with «Σύγκριση σεναρίων» on (?compare=1).

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

  const [{ data: forecast, error }, { data: items }, { data: horizonOut }, { data: expected }, lookups, ...otherForecasts] =
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
        .select("id, source, amount, expected_month, probability, certainty, project_id, owner_scope, notes, scenario_id, direction, projects(display_name)")
        .eq("org_id", orgId)
        .eq("status", "expected")
        .order("expected_month"),
      loadLookups(supabase, orgId, { include: ["projects"] }),
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
            { label: t.liquidNow, value: formatMoney(first?.opening_balance ?? 0) },
            {
              label: t.lowestClose,
              value: (
                <span className={lowest && Number(lowest.closing_balance) < buffer ? "text-negative" : undefined}>
                  {lowest ? formatMoney(lowest.closing_balance) : "—"}
                </span>
              ),
              sub: lowest ? monthLabel(monthKeyOf(lowest.month)) : undefined,
            },
            {
              label: t.firstBelow,
              value: (
                <span className={firstBelow ? "text-negative" : undefined}>
                  {firstBelow ? monthLabel(monthKeyOf(firstBelow.month)) : t.noneBelow}
                </span>
              ),
              sub: T.bufferSub(formatMoney(buffer)),
            },
            { label: T.uncertain, value: formatMoney(uncertainTotal), sub: T.uncertainSub(months) },
          ]}
        />

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

        <section className="flex min-w-0 flex-col gap-4">
          <SectionHeader
            title={t.expectedTitle}
            actions={
              <span>
                <ExpectedIncomeFormModal action={saveExpectedIncome} projects={lookups.projects} />
              </span>
            }
          />
          {(expected ?? []).length === 0 ? (
            <p className="text-body text-muted">{t.expectedEmpty}</p>
          ) : (
            <SpecTable label={t.expectedTitle}>
              <tbody>
                {(expected ?? []).map((e) => {
                  const project = Array.isArray(e.projects) ? e.projects[0] : e.projects;
                  const probability = e.probability ?? (e.certainty === "certain" ? 1 : 0.5);
                  return (
                    <Tr key={e.id} className="[&>td]:align-middle">
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
                      <Td className="py-1.5">
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
                              <Button type="submit" variant="ghost" size="sm">
                                {t.expectedReceived}
                              </Button>
                            </ArgsActionForm>
                            <ArgsActionForm action={setExpectedIncomeStatus} args={[e.id, "cancelled"]}>
                              <Button type="submit" variant="ghost" size="sm">
                                {t.expectedCancel}
                              </Button>
                            </ArgsActionForm>
                          </div>
                        )}
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
        <ReportFooter dataUntil={todayAthens()} />
      </ReportSection>
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
