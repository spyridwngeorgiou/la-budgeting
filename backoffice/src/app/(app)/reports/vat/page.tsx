import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import {
  Badge,
  Button,
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
  buttonClass,
  cn,
} from "@/components/ui";
import { toggleVatFiled } from "./actions";
import { ArgsActionForm } from "@/components/ArgsActionForm";
import { BarChart } from "@/components/ui/BarChart";
import { vatNarrative } from "@/lib/finance/narratives";
import { addMonths, currentMonthKey, firstOfMonth, lastOfMonth, monthKeyOf, quarterOf, shortMonthYearLabel, todayAthens } from "@/lib/dates";
import { change, contributors, latestUpTo, topMovements, whyText, type Part } from "@/lib/finance/insights";
import { ChangePanel, KpiLink, TopMovements } from "../Insights";

const round2 = (n: number) => Math.round(n * 100) / 100;

// ΦΠΑ -- «Τι θα πληρώσουμε στην εφορία;». Read-only but for the one status
// action, «Σήμανση ως υποβλήθηκε». The positions are read from 15 months
// back (the table and chart still show 6 back, 6 ahead) so «Τι άλλαξε» can
// compare the last closed period with the same one last year; «Μεγαλύτερες
// κινήσεις» is the one extra query (that period's 5 largest VAT rows).
export default async function VatPage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  // Anchored to today, not "whatever 24 rows happen to have data" -- the
  // same bug already found and fixed in cashflow/analysis this session: an
  // old view ordered desc-by-recency lets a far-future scheduled
  // transaction's period outrank real nearby months, or a quiet recent
  // stretch push relevant history off the end. A fixed window around today
  // (6 months back, 6 forward) is what "δυναμικό" actually means here --
  // computed fresh on every request, not a static date range.
  const todayMonth = currentMonthKey();
  const today = todayAthens();
  const windowStart = firstOfMonth(addMonths(todayMonth, -6));
  const windowEnd = firstOfMonth(addMonths(todayMonth, 6));

  const [{ data: positions }, { data: filings }] = await Promise.all([
    supabase
      .from("v_vat_position")
      .select("*")
      .eq("org_id", orgId)
      .gte("period_start", firstOfMonth(addMonths(todayMonth, -15)))
      .lte("period_start", windowEnd)
      .order("period_start", { ascending: false }),
    supabase.from("vat_periods").select("*").eq("org_id", orgId),
  ]);

  const allRows = (positions ?? []).filter((p) => p.period_start);
  const rows = allRows.filter((p) => p.period_start! >= windowStart);
  const filingByPeriod = new Map((filings ?? []).map((f) => [f.period_start, f]));
  const t = el.reports;
  const monthsOf = (p: (typeof rows)[number]) => Number(p.period_months ?? 1);
  const periodLabel = (p: (typeof rows)[number]) =>
    monthsOf(p) === 3 ? `${t.quarter} ${quarterOf(p.period_start!)}/${p.period_start!.slice(2, 4)}` : shortMonthYearLabel(monthKeyOf(p.period_start!));
  const isFiled = (p: (typeof rows)[number]) => {
    const status = filingByPeriod.get(p.period_start!)?.status;
    return status === "filed" || status === "paid";
  };
  const isCurrentPeriod = (p: (typeof rows)[number]) => {
    const startMonth = monthKeyOf(p.period_start!);
    return todayMonth >= startMonth && todayMonth <= addMonths(startMonth, monthsOf(p) - 1);
  };

  // The figures: the current period, the next deadline still ahead, the
  // periods already started and not filed.
  const ascending = rows.slice().reverse();
  const current = rows.find(isCurrentPeriod) ?? null;
  const payable = Number(current?.payable_after_credit ?? 0);
  const credit = Math.abs(Number(current?.credit_balance ?? 0));
  const next = ascending.find((p) => p.filing_deadline && p.filing_deadline >= today && !isFiled(p)) ?? null;
  const open = rows.filter((p) => monthKeyOf(p.period_start!) <= todayMonth && !isFiled(p));
  const overdue = open.filter((p) => p.filing_deadline && p.filing_deadline < today).length;

  // Per period: VAT on sales vs VAT on purchases (bars), the net position on
  // its own scale -- issued solid, issued + forecast faint.
  const chart = ascending.map((p) => ({
    label: periodLabel(p),
    out: round2(Number(p.vat_income ?? 0)),
    in: round2(Number(p.vat_expense ?? 0)),
    issued: round2(Number(p.net_issued ?? 0)),
    withForecast: round2(Number(p.net_position ?? 0)),
  }));
  const hasForecast = rows.some((p) => Number(p.net_scheduled ?? 0) !== 0);

  // «Τι άλλαξε»: the last period that has ended, against the one before it
  // and the same period last year; «why» = VAT on sales vs on purchases.
  const periodEnd = (p: (typeof rows)[number]) => lastOfMonth(addMonths(monthKeyOf(p.period_start!), monthsOf(p) - 1));
  const closed = allRows.find((p) => periodEnd(p) < today) ?? null;
  const findStart = (start: string) => allRows.find((p) => p.period_start === start) ?? null;
  const before = closed ? (allRows.find((p) => p.period_start! < closed.period_start!) ?? null) : null;
  const lastYear = closed ? findStart(firstOfMonth(addMonths(monthKeyOf(closed.period_start!), -12))) : null;
  const parts = (p: (typeof rows)[number]): Part[] => [
    { key: "out", label: el.vat.vatIncome, amount: Number(p.vat_income ?? 0) },
    { key: "in", label: el.vat.vatExpense, amount: -Number(p.vat_expense ?? 0) },
  ];
  const net = (p: (typeof rows)[number]) => round2(Number(p.vat_income ?? 0) - Number(p.vat_expense ?? 0));
  const periodHref = (p: (typeof rows)[number]) => `/transactions?scope=business&from=${p.period_start}&to=${periodEnd(p)}`;
  const changes = closed
    ? [before, lastYear].map((other, i) => ({
        label: `Καθαρός ΦΠΑ ${periodLabel(closed)} έναντι ${other ? periodLabel(other) : i === 0 ? "προηγούμενης" : "πέρσι"}`,
        change: change(net(closed), other ? net(other) : null),
        why: other ? whyText(contributors(parts(closed), parts(other))) : null,
        href: periodHref(closed),
      }))
    : [];
  // «Μεγαλύτερες κινήσεις»: the closed period's largest VAT rows (sales
  // positive, purchases negative).
  const { data: vatRows } = closed
    ? await supabase
        .from("transactions")
        .select("id, tx_date, description, counterparty_name, direction, vat_amount")
        .eq("org_id", orgId)
        .eq("scope", "business")
        .neq("status", "cancelled")
        .gte("tx_date", closed.period_start!)
        .lte("tx_date", periodEnd(closed))
        .order("vat_amount", { ascending: false })
        .limit(5)
    : { data: [] };
  const topMoves = topMovements(
    (vatRows ?? []).map((r) => ({
      id: r.id,
      date: r.tx_date,
      label: r.counterparty_name?.trim() || r.description?.trim() || "—",
      amount: (r.direction === "income" ? 1 : -1) * Number(r.vat_amount ?? 0),
    })),
  );
  const coverage = latestUpTo(topMoves.map((m) => m.date), today);
  const exportLink = (
    <a href="/api/vat/export" className={buttonClass("secondary", "md")}>
      Εξαγωγή CSV
    </a>
  );

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <PageHeader title={el.nav.vat} actions={exportLink} />

      {rows.length === 0 ? (
        <p className="border-y border-hairline py-6 text-body text-muted">
          Δεν υπάρχουν ακόμα κινήσεις για υπολογισμό θέσης ΦΠΑ.
        </p>
      ) : (
        <ReportSection label={el.nav.vat}>
          <ReportHeadline>{vatNarrative({ payable, deadline: current?.filing_deadline ?? null, credit })}</ReportHeadline>
          <KpiBand
            items={[
              {
                label: "Πληρωτέο τρέχουσας",
                value: <KpiLink href={current ? periodHref(current) : null}>{formatMoney(Math.max(0, payable))}</KpiLink>,
                sub: current ? periodLabel(current) : "—",
              },
              {
                label: "Επόμενη προθεσμία",
                value: next ? formatDate(next.filing_deadline) : "—",
                sub: next ? `${periodLabel(next)} · ${formatMoney(Math.max(0, Number(next.payable_after_credit ?? 0)))}` : "καμία ανοιχτή",
              },
              { label: "Πιστωτικό υπόλοιπο", value: formatMoney(credit), sub: "μεταφέρεται στην επόμενη περίοδο" },
              {
                label: "Ανοιχτές περίοδοι",
                value: String(open.length),
                sub: overdue > 0 ? `${overdue} εκπρόθεσμ${overdue === 1 ? "η" : "ες"}` : "μη υποβληθείσες",
              },
            ]}
          />
          <ChangePanel items={changes} coverage={coverage ?? today} />
          <ReportChart
            title="ΦΠΑ ανά περίοδο"
            caption={`Στήλες: ΦΠΑ εκροών και εισροών · γραμμή: καθαρό (θετικό = πληρωτέο), σε δική του κλίμακα δεξιά${hasForecast ? " · αχνή: μαζί με το προβλεπόμενο" : ""}`}
          >
            <BarChart
              label={t.vatChartLabel}
              data={chart}
              xKey="label"
              series={[
                { key: "out", name: el.vat.vatIncome, tone: "navy" },
                { key: "in", name: el.vat.vatExpense, tone: "accent" },
                { key: "issued", name: `Καθαρό ${t.vatIssued.toLowerCase()}`, kind: "line", tone: "navy", axis: "right" },
                ...(hasForecast
                  ? [{ key: "withForecast", name: `Καθαρό με ${t.vatScheduled.toLowerCase()}`, kind: "line" as const, faint: true, axis: "right" as const }]
                  : []),
              ]}
              marker={next?.filing_deadline ? { x: periodLabel(next), label: `${t.vatNextDeadline} ${formatDate(next.filing_deadline)}` } : undefined}
            />
          </ReportChart>
          {closed && <TopMovements rows={topMoves} caption={`ΦΠΑ, ${periodLabel(closed)}`} />}
          <ReportDetail title="Ανά περίοδο" meta={`${rows.length} περίοδοι`}>
            <SpecTable label={el.nav.vat}>
              <thead>
                <tr>
                  {/* Same inset as the body's first cells, which carry the 2px marker. */}
                  <Th className="border-l-2 border-l-transparent !pl-3">{el.vat.period}</Th>
                  <Th numeric className="hidden sm:table-cell">
                    {el.vat.vatIncome}
                  </Th>
                  <Th numeric className="hidden sm:table-cell">
                    {el.vat.vatExpense}
                  </Th>
                  <Th numeric className="hidden lg:table-cell">
                    {t.vatIssued}
                  </Th>
                  <Th numeric className="hidden lg:table-cell">
                    {t.vatScheduled}
                  </Th>
                  <Th numeric className="hidden md:table-cell">
                    {el.vat.credit}
                  </Th>
                  <Th numeric>{el.vat.payable}</Th>
                  <Th className="hidden md:table-cell">{el.vat.deadline}</Th>
                  <Th>{el.vat.filed}</Th>
                  <Th />
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const filed = isFiled(p);
                  const isCurrent = isCurrentPeriod(p);
                  return (
                    <Tr key={p.period_start} aria-current={isCurrent ? "true" : undefined} className={isCurrent ? "bg-hover" : undefined}>
                      <Td strong className={cn("border-l-2 !pl-3", isCurrent ? "border-l-navy" : "border-l-transparent")}>
                        <span className="whitespace-nowrap">
                          {monthsOf(p) === 3
                            ? `${t.quarter} ${quarterOf(p.period_start!)}/${p.period_start!.slice(0, 4)}`
                            : formatDate(p.period_start)}
                        </span>
                        {p.is_locked && <span className="ml-1.5 text-small text-muted">{t.vatLocked}</span>}
                        {isCurrent && <span className="ml-1.5 text-small font-medium text-navy">τρέχουσα περίοδος</span>}
                      </Td>
                      <Td numeric className="hidden sm:table-cell">
                        {formatMoney(p.vat_income)}
                      </Td>
                      <Td numeric className="hidden sm:table-cell">
                        {formatMoney(p.vat_expense)}
                      </Td>
                      <Td numeric className="hidden lg:table-cell">
                        {formatMoney(p.net_issued)}
                      </Td>
                      <Td numeric className="hidden text-muted lg:table-cell">
                        {formatMoney(p.net_scheduled)}
                      </Td>
                      <Td numeric className="hidden md:table-cell">
                        {formatMoney(Math.abs(p.credit_balance ?? 0))}
                      </Td>
                      <Td numeric strong className="font-medium">
                        {formatMoney(p.payable_after_credit)}
                      </Td>
                      <Td className="num hidden whitespace-nowrap text-muted md:table-cell">{formatDate(p.filing_deadline)}</Td>
                      <Td>
                        <Badge tone={filed ? "neutral" : "amber"}>{filed ? el.vat.filed : el.vat.notFiled}</Badge>
                      </Td>
                      <Td className="py-1.5 text-right">
                        <ArgsActionForm action={toggleVatFiled} args={[p.period_start!, filed]}>
                          <Button type="submit" variant="ghost" size="sm">
                            {filed ? "Αναίρεση" : "Σήμανση ως υποβλήθηκε"}
                          </Button>
                        </ArgsActionForm>
                      </Td>
                    </Tr>
                  );
                })}
              </tbody>
            </SpecTable>
          </ReportDetail>
          <ReportMethod>
            <p>
              Υπολογίζεται με βάση την ημερομηνία τιμολογίου (accrual), με μεταφορά πιστωτικού υπολοίπου από περίοδο σε
              περίοδο. Δείχνονται οι περίοδοι από 6 μήνες πριν έως 6 μήνες μετά τον τρέχοντα μήνα.
            </p>
            <p>{t.vatLockHint}</p>
            <p>{t.vatIssuedHint}</p>
            <p>«Ανοιχτές περίοδοι»: όσες έχουν ξεκινήσει και δεν έχουν σημειωθεί ως υποβληθείσες.</p>
          </ReportMethod>
          <ReportFooter dataUntil={today} />
        </ReportSection>
      )}
    </div>
  );
}
