import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatDate, formatMoney, formatPercent, formatSignedMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import {
  Badge,
  KpiBand,
  LINK_CLASS,
  Notice,
  PageHeader,
  ReportChart,
  ReportDetail,
  ReportFooter,
  ReportHeadline,
  ReportMethod,
  ReportSection,
  SectionHeader,
  SpecTable,
  Td,
  Th,
  Tr,
  ViewSwitch,
  cn,
} from "@/components/ui";
import { addMonths, currentMonthKey, currentYear, firstOfMonth, isMonthKey, lastOfMonth, shortMonthLabel, todayAthens } from "@/lib/dates";
import { BUSINESS_LINES, PNL_LINES, pnlTable, type PnlGroup, type PnlRowKey, type PnlTableRow } from "@/lib/finance/pnl";
import { topCostRows } from "@/lib/finance/reportCharts";
import { pnlNarrative } from "@/lib/finance/narratives";
import { BarChart } from "@/components/ui/BarChart";

// Αποτελέσματα -- «Βγάζουμε λεφτά;». Every figure is pnl_summary() /
// v_pnl_lines (0067): net of VAT, accrual basis, only the interest of a
// loan. This page only picks the year, the grouping and whether scheduled
// rows count, then lays out rows in the shared report anatomy.

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

const DRILL_LIMIT = 200;

const round2 = (n: number) => Math.round(n * 100) / 100;
const lineOf = (t: { rows: PnlTableRow[] } | null, key: PnlRowKey) => t?.rows.find((r) => r.line === key)?.values ?? [];
const sumTo = (values: number[], last: number) => round2(values.slice(0, last + 1).reduce((s, v) => s + v, 0));

export default async function PnlPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const thisYear = currentYear();
  const yearRaw = Number(one(sp.year));
  const year = Number.isInteger(yearRaw) && yearRaw >= 2000 && yearRaw <= thisYear + 5 ? yearRaw : thisYear;
  const group: PnlGroup = one(sp.by) === "line" ? "business_line" : "month";
  const withScheduled = one(sp.scheduled) === "1";
  const cellBucket = one(sp.cell) ?? null;
  const cellLine = one(sp.line) ?? null;

  const from = `${year}-01-01`;
  const to = `${year}-12-31`;

  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const summary = (p_from: string, p_to: string, p_group: PnlGroup) =>
    supabase.rpc("pnl_summary", { p_org: orgId, p_from, p_to, p_group, p_include_scheduled: withScheduled });
  // The table's own grouping, plus what the charts need: the year by month
  // and by business line (one of the two is the table's own rows), last
  // year by month, and the year's largest cost categories. Four RPCs.
  const [{ data, error }, other, lastYear, { data: costCategories }] = await Promise.all([
    summary(from, to, group),
    summary(from, to, group === "month" ? "business_line" : "month"),
    summary(`${year - 1}-01-01`, `${year - 1}-12-31`, "month"),
    supabase.rpc("pnl_cost_categories", { p_org: orgId, p_from: from, p_to: to, p_include_scheduled: withScheduled, p_limit: 8 }),
  ]);
  if (error) throw error;

  const buckets =
    group === "month"
      ? Array.from({ length: 12 }, (_, i) => addMonths(`${year}-01`, i))
      : BUSINESS_LINES.filter((b) => (data ?? []).some((r) => r.bucket === b));
  const table = pnlTable(data ?? [], buckets);
  const t = el.reports;

  const months = Array.from({ length: 12 }, (_, i) => addMonths(`${year}-01`, i));
  const monthTable = group === "month" ? table : pnlTable(other.data ?? [], months);
  const lineTable = pnlTable(group === "business_line" ? (data ?? []) : (other.data ?? []), [...BUSINESS_LINES]);
  const lastYearRows = lastYear.data ?? [];
  const lastYearTable =
    lastYearRows.length > 0 ? pnlTable(lastYearRows.map((r) => ({ ...r, bucket: `${year}${r.bucket.slice(4)}` })), months) : null;

  // «Έως τώρα»: the current year up to this month (the whole year when the
  // scheduled rows count), a past or future year in full. Last year is
  // compared over the same months.
  const nowIndex = Number(currentMonthKey().slice(5, 7)) - 1;
  const last = year === thisYear && !withScheduled ? nowIndex : 11;
  const revenue = lineOf(monthTable, "revenue");
  const result = lineOf(monthTable, "result");
  const prevResult = lineOf(lastYearTable, "result");
  const revenueYtd = sumTo(revenue, last);
  const grossYtd = sumTo(lineOf(monthTable, "gross_profit"), last);
  const resultYtd = sumTo(result, last);
  const resultLastYearYtd = lastYearTable ? sumTo(prevResult, last) : null;
  const change =
    // Only meaningful on a profit base; from a loss the band shows the
    // difference in euros instead.
    resultLastYearYtd != null && resultLastYearYtd > 0 ? (resultYtd - resultLastYearYtd) / resultLastYearYtd : null;
  const periodSub = last === 11 ? String(year) : `${shortMonthLabel(months[0])} – ${shortMonthLabel(months[last])} ${year}`;

  // The monthly result as signed bars; the cumulative result of the year
  // (and of last year, faint) on its own scale on the right.
  let cum = 0;
  let cumPrev = 0;
  const chartRows = months.map((m, i) => {
    cum += result[i] ?? 0;
    cumPrev += prevResult[i] ?? 0;
    return {
      label: shortMonthLabel(m),
      result: round2(result[i] ?? 0),
      cumulative: i <= last ? round2(cum) : null,
      lastYear: lastYearTable ? round2(cumPrev) : null,
    };
  });
  const hasMonthly = revenue.some((v) => v !== 0) || result.some((v) => v !== 0);
  const lineRevenue = lineOf(lineTable, "revenue");
  const lineResult = lineOf(lineTable, "result");
  const lineRows = BUSINESS_LINES.map((b, i) => ({
    label: t.businessLines[b as keyof typeof t.businessLines] ?? b,
    revenue: lineRevenue[i] ?? 0,
    result: lineResult[i] ?? 0,
  })).filter((r) => r.revenue !== 0 || r.result !== 0);
  const topCosts = topCostRows(costCategories ?? []);

  const query = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams();
    const base: Record<string, string | null> = {
      year: year === thisYear ? null : String(year),
      by: group === "business_line" ? "line" : null,
      scheduled: withScheduled ? "1" : null,
      cell: null,
      line: null,
      ...patch,
    };
    for (const [k, v] of Object.entries(base)) if (v) p.set(k, v);
    const s = p.toString();
    return s ? `/reports/pnl?${s}` : "/reports/pnl";
  };

  // Drill-down: the transactions behind one cell.
  const drillable = cellLine && (PNL_LINES as readonly string[]).includes(cellLine);
  let drill: { id: string; tx_date: string; amount: number; label: string; scheduled: boolean }[] = [];
  let drillTruncated = false;
  if (drillable && cellLine) {
    let q = supabase
      .from("v_pnl_lines")
      .select("transaction_id, tx_date, signed_amount, is_scheduled")
      .eq("org_id", orgId)
      .eq("line", cellLine)
      .eq("scope", "business")
      .order("tx_date")
      .limit(DRILL_LIMIT + 1);
    if (cellBucket && group === "month" && isMonthKey(cellBucket)) {
      q = q.gte("tx_date", firstOfMonth(cellBucket)).lte("tx_date", lastOfMonth(cellBucket));
    } else {
      q = q.gte("tx_date", from).lte("tx_date", to);
      if (cellBucket && group === "business_line" && (BUSINESS_LINES as readonly string[]).includes(cellBucket)) {
        q = q.eq("business_line", cellBucket as (typeof BUSINESS_LINES)[number]);
      }
    }
    if (!withScheduled) q = q.eq("is_scheduled", false);
    const { data: lines, error: drillError } = await q;
    if (drillError) throw drillError;
    drillTruncated = (lines ?? []).length > DRILL_LIMIT;
    const rows = (lines ?? []).slice(0, DRILL_LIMIT);
    const ids = rows.map((r) => r.transaction_id).filter((id): id is string => !!id);
    const { data: txs } = ids.length
      ? await supabase.from("transactions").select("id, description, counterparty_name").in("id", ids)
      : { data: [] };
    const byId = new Map((txs ?? []).map((x) => [x.id, x]));
    drill = rows.map((r) => {
      const tx = byId.get(r.transaction_id ?? "");
      return {
        id: r.transaction_id ?? "",
        tx_date: r.tx_date ?? "",
        amount: Number(r.signed_amount ?? 0),
        label: tx?.description?.trim() || tx?.counterparty_name || "—",
        scheduled: Boolean(r.is_scheduled),
      };
    });
  }

  const bucketLabel = (b: string) =>
    group === "month" ? shortMonthLabel(b) : (t.businessLines[b as keyof typeof t.businessLines] ?? b);
  const years = [thisYear - 2, thisYear - 1, thisYear, thisYear + 1];
  const today = todayAthens();
  const dataUntil = year < thisYear ? to : year === thisYear ? today : null;

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <PageHeader title={t.pnlTitle} />

      <div className="print-hide flex flex-wrap items-start gap-x-8 gap-y-4">
        <ViewSwitch
          label={t.year}
          options={years.map((y) => ({ key: String(y), label: String(y), href: query({ year: y === thisYear ? null : String(y) }) }))}
          active={String(year)}
        />
        <ViewSwitch
          label={t.includeScheduled}
          options={[
            { key: "0", label: el.common.no, href: query({ scheduled: null }) },
            { key: "1", label: el.common.yes, href: query({ scheduled: "1" }) },
          ]}
          active={withScheduled ? "1" : "0"}
        />
      </div>

      <ReportSection label={t.pnlTitle}>
        {hasMonthly && (
          <>
            <ReportHeadline>{pnlNarrative({ year, revenueYtd, resultYtd, resultLastYearYtd })}</ReportHeadline>
            <KpiBand
              items={[
                { label: "Έσοδα έτους", value: formatMoney(revenueYtd), sub: periodSub },
                {
                  label: "Μικτό περιθώριο",
                  value: revenueYtd > 0 ? formatPercent(grossYtd / revenueYtd) : "—",
                  sub: `${t.lines.gross_profit} ${formatMoney(grossYtd)}`,
                },
                { label: "Αποτέλεσμα έτους", value: formatMoney(resultYtd), sub: periodSub },
                {
                  label: "Μεταβολή έναντι πέρσι",
                  value:
                    change != null
                      ? formatPercent(change, { digits: 0, signed: true })
                      : resultLastYearYtd != null
                        ? formatSignedMoney(resultYtd - resultLastYearYtd)
                        : "—",
                  sub: resultLastYearYtd != null ? `${year - 1}: ${formatMoney(resultLastYearYtd)}` : "χωρίς στοιχεία πέρσι",
                },
              ]}
            />
            <ReportChart
              title="Αποτέλεσμα ανά μήνα"
              caption={`Στήλες: το αποτέλεσμα κάθε μήνα · γραμμή: σωρευτικά από τον Ιανουάριο, σε δική της κλίμακα δεξιά${lastYearTable ? ` · αχνή: ${year - 1}` : ""}`}
            >
              <BarChart
                label="Αποτέλεσμα ανά μήνα και σωρευτικό αποτέλεσμα έτους"
                data={chartRows}
                xKey="label"
                series={[
                  { key: "result", name: t.lines.result, tone: "navy", signed: true },
                  { key: "cumulative", name: `Σωρευτικό ${year}`, kind: "line", tone: "navy", axis: "right" },
                  ...(lastYearTable
                    ? [{ key: "lastYear", name: `Σωρευτικό ${year - 1}`, kind: "line" as const, faint: true, axis: "right" as const }]
                    : []),
                ]}
              />
            </ReportChart>
          </>
        )}

        {lineRows.length > 0 && (
          <ReportChart title={t.byLine} caption={`Έσοδα και αποτέλεσμα ανά κλάδο · ${year}`}>
            <BarChart
              label="Έσοδα και αποτέλεσμα ανά κλάδο"
              data={lineRows}
              xKey="label"
              layout="rows"
              series={[
                { key: "revenue", name: t.lines.revenue, tone: "navy" },
                { key: "result", name: t.lines.result, tone: "accent" },
              ]}
            />
          </ReportChart>
        )}

        {topCosts.length > 0 && (
          <ReportChart title={`${t.topCostsTitle} · ${year}`}>
            <BarChart
              label={t.topCostsLabel}
              data={topCosts}
              xKey="label"
              layout="rows"
              series={[{ key: "amount", name: t.pnlCost, tone: "accent" }]}
            />
          </ReportChart>
        )}

        {buckets.length === 0 ? (
          <p className="border-y border-hairline py-6 text-body text-muted">{t.pnlEmpty}</p>
        ) : (
          <ReportDetail title={group === "month" ? t.byMonth : t.byLine}>
            <div className="flex min-w-0 flex-col gap-4">
              <ViewSwitch
                label={t.pnlView}
                className="print-hide"
                options={[
                  { key: "month", label: t.byMonth, href: query({ by: null }) },
                  { key: "business_line", label: t.byLine, href: query({ by: "line" }) },
                ]}
                active={group}
              />
              <SpecTable label={t.pnlTitle} stickyFirst>
                <thead>
                  <tr>
                    <Th />
                    {buckets.map((b) => (
                      <Th key={b} numeric>
                        {bucketLabel(b)}
                      </Th>
                    ))}
                    <Th numeric>{t.total}</Th>
                  </tr>
                </thead>
                <tbody>
                  {table.rows.map((row) => {
                    const isSum = row.line === "gross_profit" || row.line === "result";
                    if (!isSum && row.total === 0 && row.line !== "revenue") return null;
                    // Subtotal rows sit over an ink rule, like the spec sheet's totals.
                    return (
                      <Tr key={row.line} total={isSum}>
                        <Td strong className="whitespace-nowrap">
                          {t.lines[row.line]}
                          {row.line === "unclassified" && row.total !== 0 && (
                            <span className="ml-1.5">
                              <Badge tone="amber">!</Badge>
                            </span>
                          )}
                        </Td>
                        {buckets.map((b, i) => {
                          const v = row.values[i];
                          const cell = v === 0 ? <span className="text-muted">—</span> : formatMoney(v);
                          const active = cellLine === row.line && cellBucket === b;
                          return (
                            <Td key={b} numeric className={cn(active && "bg-hover outline outline-1 -outline-offset-1 outline-navy")}>
                              {isSum || v === 0 ? (
                                cell
                              ) : (
                                <Link href={query({ cell: b, line: row.line })} scroll={false} className={LINK_CLASS}>
                                  {cell}
                                </Link>
                              )}
                            </Td>
                          );
                        })}
                        <Td numeric strong>
                          {isSum || row.total === 0 ? (
                            formatMoney(row.total)
                          ) : (
                            <Link href={query({ line: row.line })} scroll={false} className={LINK_CLASS}>
                              {formatMoney(row.total)}
                            </Link>
                          )}
                        </Td>
                      </Tr>
                    );
                  })}
                </tbody>
              </SpecTable>
              {table.rows.some((r) => r.line === "unclassified" && r.total !== 0) && (
                <Notice tone="warning" size="small" internal>
                  <Link href="/reports/quality" className="text-ink underline underline-offset-4">
                    {t.lines.unclassified}
                  </Link>
                  : {t.unclassifiedHint}
                </Notice>
              )}
            </div>
          </ReportDetail>
        )}

        {drillable && cellLine && (
          <section className="flex min-w-0 flex-col gap-4">
            <SectionHeader
              title={`${t.drillDown}: ${t.lines[cellLine as keyof typeof t.lines]}${cellBucket ? ` · ${bucketLabel(cellBucket)}` : ` · ${year}`}`}
              actions={
                <div className="flex items-center gap-4 text-small">
                  {drill.length > 0 && drill.length <= 100 && (
                    <Link
                      href={`/transactions?ids=${drill.map((d) => d.id).join(",")}`}
                      className="inline-flex items-center text-ink underline underline-offset-4 max-md:min-h-11"
                    >
                      {t.pnlOpenInTransactions}
                    </Link>
                  )}
                  <Link href={query({})} scroll={false} className="inline-flex items-center text-ink underline underline-offset-4 max-md:min-h-11">
                    {el.common.close}
                  </Link>
                </div>
              }
            />
            {drill.length === 0 ? (
              <p className="text-body text-muted">{t.noItems}</p>
            ) : (
              <SpecTable label={t.drillDown}>
                <tbody>
                  {drill.map((d) => (
                    <Tr key={d.id}>
                      <Td className="num whitespace-nowrap text-muted">{formatDate(d.tx_date)}</Td>
                      <Td strong className="w-full">
                        <Link href={`/transactions?ids=${d.id}`} className={LINK_CLASS}>
                          {d.label}
                        </Link>
                        {d.scheduled && <span className="ml-1 text-small text-muted">({t.pnlScheduledTag})</span>}
                      </Td>
                      <Td numeric strong>
                        {formatMoney(d.amount)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </SpecTable>
            )}
            {drillTruncated && <p className="text-small text-muted">{t.pnlDrillTruncated}</p>}
          </section>
        )}

        <ReportMethod>
          <p>{t.pnlIntro}</p>
          <p>
            «Έως τώρα»: για το τρέχον έτος οι μήνες ως και τον τρέχοντα (όλο το έτος όταν μετρούν τα προγραμματισμένα)· η
            σύγκριση με πέρσι γίνεται στους ίδιους μήνες. Μικτό περιθώριο = μικτό κέρδος / έσοδα.
          </p>
        </ReportMethod>
        <ReportFooter dataUntil={dataUntil} />
      </ReportSection>
    </div>
  );
}
