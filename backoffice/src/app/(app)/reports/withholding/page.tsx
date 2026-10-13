import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney } from "@/lib/format";
import { addMonths, currentMonthKey, firstOfMonth, lastOfMonth, monthKeyOf, monthLabel, shortMonthYearLabel, todayAthens } from "@/lib/dates";
import { el } from "@/lib/i18n/el";
import { withholdingNarrative } from "@/lib/finance/narratives";
import { change, contributors, latestUpTo, topMovements, whyText } from "@/lib/finance/insights";
import { ChangePanel, KpiLink, TopMovements } from "../Insights";
import {
  KpiBand,
  PageHeader,
  ReportChart,
  ReportDetail,
  ReportFooter,
  ReportHeadline,
  ReportMethod,
  ReportSection,
  SpecTable,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { BarChart } from "@/components/ui/BarChart";

// «Τι οφείλουμε από παρακρατήσεις;» -- the reference report tab for the
// shared anatomy (components/ui/ReportSection): conclusion, figures, one
// chart, the same table as before (folded on a phone), how it is computed.
export default async function WithholdingPage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const thisMonth = currentMonthKey();
  // «Τι άλλαξε» looks at the last complete month; its five largest
  // withholdings are the one extra query («Μεγαλύτερες κινήσεις»).
  const focusMonth = addMonths(thisMonth, -1);
  const focusFrom = firstOfMonth(focusMonth);
  const focusTo = lastOfMonth(focusMonth);
  const [{ data: positions }, { data: topRows }] = await Promise.all([
    supabase
      .from("v_withholding_position")
      .select("*")
      .eq("org_id", orgId)
      .order("period_start", { ascending: false })
      .limit(24),
    // The same rows v_withholding_position sums (business expenses, paid or
    // invoiced), largest first.
    supabase
      .from("transactions")
      .select("id, tx_date, description, counterparty_name, withholding_amount")
      .eq("org_id", orgId)
      .eq("scope", "business")
      .eq("direction", "expense")
      .in("status", ["paid", "pending"])
      .gt("withholding_amount", 0)
      .gte("tx_date", focusFrom)
      .lte("tx_date", focusTo)
      .order("withholding_amount", { ascending: false })
      .limit(5),
  ]);

  const rows = (positions ?? []).filter((p) => p.period_start);
  const from12 = addMonths(thisMonth, -11);
  const byMonth = rows.map((p) => ({ month: monthKeyOf(p.period_start!), amount: Number(p.withheld_total ?? 0) }));
  const current = byMonth.find((r) => r.month === thisMonth)?.amount ?? 0;
  const last12 = byMonth.filter((r) => r.month >= from12 && r.month <= thisMonth).reduce((s, r) => s + r.amount, 0);
  const latest = byMonth[0] ?? null;
  // A fixed 24-month window up to this month (or the latest month, when a
  // pending invoice is dated ahead): quiet months show as gaps, not missing.
  const amountOf = new Map(byMonth.map((r) => [r.month, r.amount]));
  const end = latest && latest.month > thisMonth ? latest.month : thisMonth;
  const chart = Array.from({ length: 24 }, (_, i) => addMonths(end, i - 23)).map((m) => ({
    label: shortMonthYearLabel(m),
    withheld: amountOf.get(m) ?? 0,
  }));

  const topMoves = topMovements(
    (topRows ?? []).map((r) => ({
      id: r.id,
      date: r.tx_date,
      label: r.counterparty_name?.trim() || r.description?.trim() || "—",
      amount: Number(r.withholding_amount ?? 0),
    })),
  );
  // «why»: the month's largest withholdings (one figure, no parts).
  const why = whyText(contributors(topMoves.slice(0, 2).map((m, i) => ({ key: `${m.id ?? i}`, label: m.label, amount: m.amount })), []));
  const focusAmount = amountOf.get(focusMonth) ?? 0;
  const rangeHref = (from: string, to: string) => `/transactions?scope=business&direction=expense&from=${from}&to=${to}`;
  const changes = rows.length
    ? [addMonths(focusMonth, -1), addMonths(focusMonth, -12)].map((m) => ({
        label: `${monthLabel(focusMonth)} έναντι ${monthLabel(m)}`,
        change: change(focusAmount, amountOf.get(m) ?? 0),
        why,
        href: rangeHref(focusFrom, focusTo),
      }))
    : [];
  const coverage = latestUpTo([...topMoves.map((m) => m.date), latest?.month], todayAthens());

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <PageHeader
        title={el.nav.withholding}
        meta={rows.length === 0 ? <span className="block max-w-3xl">{el.reports.withholdingIntro}</span> : undefined}
      />

      {rows.length === 0 ? (
        <p className="border-y border-hairline py-6 text-body text-muted">Δεν υπάρχουν ακόμα κινήσεις με παρακράτηση.</p>
      ) : (
        <ReportSection label={el.nav.withholding}>
          <ReportHeadline>
            {withholdingNarrative({ month: latest?.month ?? null, current: latest?.amount ?? 0, last12 })}
          </ReportHeadline>
          <KpiBand
            items={[
              {
                label: "Τρέχων μήνας",
                value: <KpiLink href={rangeHref(firstOfMonth(thisMonth), lastOfMonth(thisMonth))}>{formatMoney(current)}</KpiLink>,
                sub: monthLabel(thisMonth),
              },
              {
                label: "Σύνολο 12μ",
                value: <KpiLink href={rangeHref(firstOfMonth(from12), lastOfMonth(thisMonth))}>{formatMoney(last12)}</KpiLink>,
                sub: `${monthLabel(from12)} – ${monthLabel(thisMonth)}`,
              },
              { label: "Μέσος όρος μήνα", value: formatMoney(last12 / 12), sub: "τελευταίοι 12 μήνες" },
            ]}
          />
          <ChangePanel items={changes} coverage={coverage} />
          <ReportChart
            title="Παρακρατήσεις ανά μήνα"
            caption={`${monthLabel(addMonths(end, -23))} – ${monthLabel(end)} · αποδίδονται ως το τέλος του επόμενου μήνα`}
          >
            <BarChart
              data={chart}
              xKey="label"
              series={[{ key: "withheld", name: "Παρακρατηθέν ποσό", tone: "navy" }]}
              label="Παρακρατήσεις ανά μήνα, τελευταίοι 24 μήνες"
              marker={end === thisMonth ? undefined : { x: shortMonthYearLabel(thisMonth), label: "τρέχων μήνας" }}
            />
          </ReportChart>
          <TopMovements rows={topMoves} caption={monthLabel(focusMonth)} />
          <ReportDetail title="Ανά μήνα" meta={`${rows.length} μήνες`}>
            <SpecTable label={el.nav.withholding} className="max-w-2xl">
              <thead>
                <tr>
                  <Th>{el.vat.period}</Th>
                  <Th numeric>Παρακρατηθέν Ποσό</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <Tr key={p.period_start}>
                    <Td strong className="whitespace-nowrap">
                      {monthLabel(monthKeyOf(p.period_start!))}
                    </Td>
                    <Td numeric strong>
                      {formatMoney(p.withheld_total)}
                    </Td>
                  </Tr>
                ))}
              </tbody>
            </SpecTable>
          </ReportDetail>
          <ReportMethod>
            <p>{el.reports.withholdingIntro}</p>
          </ReportMethod>
          <ReportFooter dataUntil={coverage ?? latest?.month ?? null} />
        </ReportSection>
      )}
    </div>
  );
}
