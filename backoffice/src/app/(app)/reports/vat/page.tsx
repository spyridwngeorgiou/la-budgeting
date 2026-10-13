import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import {
  Badge,
  Button,
  KpiBand,
  LINK_CLASS,
  PageHeader,
  ReportChart,
  ReportFooter,
  ReportHistory,
  ReportSection,
  SpecTable,
  Td,
  Th,
  Tr,
  cn,
} from "@/components/ui";
import { toggleVatFiled } from "./actions";
import { ArgsActionForm } from "@/components/ArgsActionForm";
import { BarChart } from "@/components/ui/BarChart";
import { addMonths, currentMonthKey, firstOfMonth, lastOfMonth, monthKeyOf, monthLabel, quarterOf, shortMonthYearLabel, todayAthens } from "@/lib/dates";
import { change, vsPrevText } from "@/lib/finance/insights";
import { KpiLink, reportIssues } from "../Insights";
import { ExportCsvLink } from "../ExportCsvLink";

const round2 = (n: number) => Math.round(n * 100) / 100;

const META =
  "Τι θα πληρώσουμε στην εφορία; Με την ημερομηνία παραστατικού και μεταφορά του πιστωτικού από περίοδο σε περίοδο· οι περίοδοι από 6 μήνες πριν έως 6 μήνες μετά.";

// ΦΠΑ -- «Τι θα πληρώσουμε στην εφορία;». Read-only but for the one status
// action, «Σήμανση ως υποβλήθηκε»: the period table is the page's work, so
// it stays open. The withholding tax (v_withholding_position, its tab was
// removed) is the second table, closed. One extra query: the period before
// the window's first, for the current period's «± έναντι προηγ.».
export default async function VatPage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  // Anchored to today, not "whatever 24 rows happen to have data": a fixed
  // window around today (6 months back, 6 forward), computed fresh on every
  // request.
  const todayMonth = currentMonthKey();
  const today = todayAthens();
  const windowStart = firstOfMonth(addMonths(todayMonth, -6));
  const windowEnd = firstOfMonth(addMonths(todayMonth, 6));

  const [{ data: positions }, { data: filings }, { data: withholding }, issues] = await Promise.all([
    supabase
      .from("v_vat_position")
      .select("*")
      .eq("org_id", orgId)
      .gte("period_start", firstOfMonth(addMonths(todayMonth, -9)))
      .lte("period_start", windowEnd)
      .order("period_start", { ascending: false }),
    supabase.from("vat_periods").select("*").eq("org_id", orgId),
    supabase
      .from("v_withholding_position")
      .select("period_start, withheld_total")
      .eq("org_id", orgId)
      .order("period_start", { ascending: false })
      .limit(24),
    reportIssues(supabase, orgId, "vat"),
  ]);

  const allRows = (positions ?? []).filter((p) => p.period_start);
  const rows = allRows.filter((p) => p.period_start! >= windowStart);
  const filingByPeriod = new Map((filings ?? []).map((f) => [f.period_start, f]));
  const t = el.reports;
  type Period = (typeof rows)[number];
  const monthsOf = (p: Period) => Number(p.period_months ?? 1);
  const periodLabel = (p: Period) =>
    monthsOf(p) === 3 ? `${t.quarter} ${quarterOf(p.period_start!)}/${p.period_start!.slice(2, 4)}` : shortMonthYearLabel(monthKeyOf(p.period_start!));
  const isFiled = (p: Period) => {
    const status = filingByPeriod.get(p.period_start!)?.status;
    return status === "filed" || status === "paid";
  };
  const isCurrentPeriod = (p: Period) => {
    const startMonth = monthKeyOf(p.period_start!);
    return todayMonth >= startMonth && todayMonth <= addMonths(startMonth, monthsOf(p) - 1);
  };
  const periodEnd = (p: Period) => lastOfMonth(addMonths(monthKeyOf(p.period_start!), monthsOf(p) - 1));
  const periodHref = (p: Period) => `/transactions?scope=business&from=${p.period_start}&to=${periodEnd(p)}`;

  // The open table keeps the page short: the latest periods (where the
  // «υποβλήθηκε» work is); older ones one click away, same columns.
  const RECENT_PERIODS = 4;
  const recent = rows.slice(0, RECENT_PERIODS);
  const older = rows.slice(RECENT_PERIODS);
  const periodsTable = (list: Period[], label: string) => (
    <SpecTable label={label}>
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
        {list.map((p) => {
          const filed = isFiled(p);
          const isCurrent = isCurrentPeriod(p);
          return (
            <Tr key={p.period_start} aria-current={isCurrent ? "true" : undefined} className={isCurrent ? "bg-hover" : undefined}>
              <Td strong className={cn("border-l-2 !pl-3", isCurrent ? "border-l-navy" : "border-l-transparent")}>
                <Link href={periodHref(p)} className={cn(LINK_CLASS, "whitespace-nowrap")}>
                  {monthsOf(p) === 3 ? `${t.quarter} ${quarterOf(p.period_start!)}/${p.period_start!.slice(0, 4)}` : formatDate(p.period_start)}
                </Link>
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
  );

  // The figures: the current period (against the one before it), the next
  // deadline still ahead, the periods already started and not filed.
  const ascending = rows.slice().reverse();
  const current = rows.find(isCurrentPeriod) ?? null;
  const before = current ? (allRows.find((p) => p.period_start! < current.period_start!) ?? null) : null;
  const payable = Number(current?.payable_after_credit ?? 0);
  const credit = Math.abs(Number(current?.credit_balance ?? 0));
  const next = ascending.find((p) => p.filing_deadline && p.filing_deadline >= today && !isFiled(p)) ?? null;
  const open = rows.filter((p) => monthKeyOf(p.period_start!) <= todayMonth && !isFiled(p));
  const overdue = open.filter((p) => p.filing_deadline && p.filing_deadline < today).length;
  const against = before ? `${periodLabel(before)}` : "προηγ. περιόδου";
  const payableVsPrev = before ? vsPrevText(change(Math.max(0, payable), Math.max(0, Number(before.payable_after_credit ?? 0))), against) : null;
  const creditVsPrev = before ? vsPrevText(change(credit, Math.abs(Number(before.credit_balance ?? 0))), against) : null;

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

  // Παρακράτηση: per month, the last 24 that have any; each month opens
  // its expense transactions.
  const withheld = (withholding ?? [])
    .filter((p) => p.period_start)
    .map((p) => ({ month: monthKeyOf(p.period_start!), amount: Number(p.withheld_total ?? 0) }));
  const from12 = addMonths(todayMonth, -11);
  const withheldNow = withheld.find((r) => r.month === todayMonth)?.amount ?? 0;
  const withheld12 = withheld.filter((r) => r.month >= from12 && r.month <= todayMonth).reduce((s, r) => s + r.amount, 0);
  const rangeHref = (from: string, to: string) => `/transactions?scope=business&direction=expense&from=${from}&to=${to}`;

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title={el.nav.vat} meta={META} actions={<ExportCsvLink />} />

      {rows.length === 0 ? (
        <p className="border-y border-hairline py-6 text-body text-muted">Δεν υπάρχουν ακόμα κινήσεις για υπολογισμό θέσης ΦΠΑ.</p>
      ) : (
        <ReportSection label={el.nav.vat}>
          <KpiBand
            items={[
              {
                label: "Πληρωτέο τρέχουσας",
                value: <KpiLink href={current ? periodHref(current) : null}>{formatMoney(Math.max(0, payable))}</KpiLink>,
                sub: (
                  <>
                    {current ? periodLabel(current) : "—"}
                    {payableVsPrev && <span className="block">{payableVsPrev}</span>}
                  </>
                ),
              },
              {
                label: "Επόμενη προθεσμία",
                value: next ? formatDate(next.filing_deadline) : "—",
                sub: next ? `${periodLabel(next)} · ${formatMoney(Math.max(0, Number(next.payable_after_credit ?? 0)))}` : "καμία ανοιχτή",
              },
              {
                label: "Πιστωτικό υπόλοιπο",
                value: formatMoney(credit),
                sub: (
                  <>
                    μεταφέρεται στην επόμενη περίοδο
                    {creditVsPrev && <span className="block">{creditVsPrev}</span>}
                  </>
                ),
              },
              {
                label: "Ανοιχτές περίοδοι",
                value: String(open.length),
                sub: overdue > 0 ? `${overdue} εκπρόθεσμ${overdue === 1 ? "η" : "ες"}` : "μη υποβληθείσες",
              },
            ]}
          />
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

          {/* The page's work: open, with the «υποβλήθηκε» toggle on each period. */}
          <ReportHistory title="Περίοδοι" count={rows.length} open>
            {periodsTable(recent, el.nav.vat)}
            {older.length > 0 && (
              <ReportHistory title="Παλαιότερες περίοδοι" count={older.length} level={3}>
                {periodsTable(older, `${el.nav.vat} · παλαιότερες`)}
              </ReportHistory>
            )}
            <p className="max-w-3xl text-small text-muted">
              {t.vatLockHint} {t.vatIssuedHint}
            </p>
          </ReportHistory>

          <ReportHistory
            title="Παρακράτηση ανά μήνα"
            count={withheld.length}
            meta={`τρέχων μήνας ${formatMoney(withheldNow)} · 12 μήνες ${formatMoney(withheld12)} · μέσος όρος ${formatMoney(withheld12 / 12)}`}
          >
            <p className="max-w-3xl text-small text-muted">{t.withholdingIntro}</p>
            {withheld.length === 0 ? (
              <p className="text-body text-muted">Δεν υπάρχουν ακόμα κινήσεις με παρακράτηση.</p>
            ) : (
              <SpecTable label="Παρακράτηση" className="max-w-2xl">
                <thead>
                  <tr>
                    <Th>{el.vat.period}</Th>
                    <Th numeric>Παρακρατηθέν ποσό</Th>
                  </tr>
                </thead>
                <tbody>
                  {withheld.map((r) => (
                    <Tr key={r.month}>
                      <Td strong className="whitespace-nowrap">
                        <Link href={rangeHref(firstOfMonth(r.month), lastOfMonth(r.month))} className={LINK_CLASS}>
                          {monthLabel(r.month)}
                        </Link>
                      </Td>
                      <Td numeric strong>
                        {formatMoney(r.amount)}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </SpecTable>
            )}
          </ReportHistory>

          <ReportFooter dataUntil={today} issues={issues} />
        </ReportSection>
      )}
    </div>
  );
}
