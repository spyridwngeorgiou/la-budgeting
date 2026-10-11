import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, Button, PageHeader, buttonClass, cn } from "@/components/ui";
import { toggleVatFiled } from "./actions";
import { ActionForm } from "@/components/ActionForm";
import { FRAME, NUM, TABLE, TD, TH, TOUCH } from "../ui";
import { addMonths, currentMonthKey, firstOfMonth, monthKeyOf, quarterOf } from "@/lib/dates";

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
  const windowStart = firstOfMonth(addMonths(todayMonth, -6));
  const windowEnd = firstOfMonth(addMonths(todayMonth, 6));

  const [{ data: positions }, { data: filings }] = await Promise.all([
    supabase
      .from("v_vat_position")
      .select("*")
      .eq("org_id", orgId)
      .gte("period_start", windowStart)
      .lte("period_start", windowEnd)
      .order("period_start", { ascending: false }),
    supabase.from("vat_periods").select("*").eq("org_id", orgId),
  ]);

  const filingByPeriod = new Map((filings ?? []).map((f) => [f.period_start, f]));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title={el.nav.vat}
        meta={
          <span className="block max-w-3xl">
            Υπολογίζεται με βάση την ημερομηνία τιμολογίου (accrual), με μεταφορά πιστωτικού
            υπολοίπου από περίοδο σε περίοδο. Δείχνονται οι περίοδοι από 6 μήνες πριν έως 6 μήνες μετά τον
            τρέχοντα μήνα. {el.reports.vatLockHint}
          </span>
        }
        actions={
          <a href="/api/vat/export" className={buttonClass("secondary", "md", TOUCH)}>
            Εξαγωγή CSV
          </a>
        }
      />

      {(positions ?? []).length === 0 ? (
        <p className="border-y border-hairline py-6 text-sm text-muted">
          Δεν υπάρχουν ακόμα κινήσεις για υπολογισμό θέσης ΦΠΑ.
        </p>
      ) : (
        <div className={FRAME}>
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  {el.vat.period}
                </th>
                <th scope="col" className={cn(TH, "hidden text-right sm:table-cell")}>
                  {el.vat.vatIncome}
                </th>
                <th scope="col" className={cn(TH, "hidden text-right sm:table-cell")}>
                  {el.vat.vatExpense}
                </th>
                <th scope="col" className={cn(TH, "hidden text-right md:table-cell")}>
                  {el.vat.credit}
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  {el.vat.payable}
                </th>
                <th scope="col" className={cn(TH, "hidden md:table-cell")}>
                  {el.vat.deadline}
                </th>
                <th scope="col" className={TH}>
                  {el.vat.filed}
                </th>
                <th scope="col" className={TH} />
              </tr>
            </thead>
            <tbody>
              {(positions ?? []).map((p) => {
                const filing = filingByPeriod.get(p.period_start!);
                const filed = filing?.status === "filed" || filing?.status === "paid";
                const startMonth = monthKeyOf(p.period_start!);
                const isCurrent =
                  todayMonth >= startMonth && todayMonth <= addMonths(startMonth, Number(p.period_months ?? 1) - 1);
                return (
                  <tr key={p.period_start} aria-current={isCurrent ? "true" : undefined} className={isCurrent ? "bg-hover" : "hover:bg-hover"}>
                    <td className={cn(TD, "border-l-2 text-ink", isCurrent ? "border-l-navy" : "border-l-transparent")}>
                      <span className="whitespace-nowrap">
                        {Number(p.period_months ?? 1) === 3
                          ? `${el.reports.quarter} ${quarterOf(p.period_start!)}/${p.period_start!.slice(0, 4)}`
                          : formatDate(p.period_start)}
                      </span>
                      {p.is_locked && <span className="ml-1.5 text-xs text-muted">{el.reports.vatLocked}</span>}
                      {isCurrent && <span className="ml-1.5 text-xs font-medium text-navy">τρέχουσα περίοδος</span>}
                    </td>
                    <td className={cn(TD, NUM, "hidden sm:table-cell")}>{formatMoney(p.vat_income)}</td>
                    <td className={cn(TD, NUM, "hidden sm:table-cell")}>{formatMoney(p.vat_expense)}</td>
                    <td className={cn(TD, NUM, "hidden md:table-cell")}>{formatMoney(Math.abs(p.credit_balance ?? 0))}</td>
                    <td className={cn(TD, NUM, "font-medium text-ink")}>{formatMoney(p.payable_after_credit)}</td>
                    <td className={cn(TD, "num hidden whitespace-nowrap text-muted md:table-cell")}>{formatDate(p.filing_deadline)}</td>
                    <td className={TD}>
                      <Badge tone={filed ? "neutral" : "amber"}>{filed ? el.vat.filed : el.vat.notFiled}</Badge>
                    </td>
                    <td className={cn(TD, "py-1.5 text-right")}>
                      <ActionForm action={toggleVatFiled.bind(null, p.period_start!, filed)}>
                        <Button type="submit" variant="ghost" size="sm" className={TOUCH}>
                          {filed ? "Αναίρεση" : "Σήμανση ως υποβλήθηκε"}
                        </Button>
                      </ActionForm>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
