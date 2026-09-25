import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, Button } from "@/components/ui";
import { toggleVatFiled } from "./actions";

function addMonthsIso(iso: string, delta: number): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export default async function VatPage() {
  const supabase = await createClient();

  // Anchored to today, not "whatever 24 rows happen to have data" -- the
  // same bug already found and fixed in cashflow/analysis this session: an
  // old view ordered desc-by-recency lets a far-future scheduled
  // transaction's period outrank real nearby months, or a quiet recent
  // stretch push relevant history off the end. A fixed window around today
  // (6 months back, 6 forward) is what "δυναμικό" actually means here --
  // computed fresh on every request, not a static date range.
  const todayMonth = new Date().toISOString().slice(0, 7) + "-01";
  const windowStart = addMonthsIso(todayMonth, -6);
  const windowEnd = addMonthsIso(todayMonth, 6);

  const [{ data: positions }, { data: filings }] = await Promise.all([
    supabase
      .from("v_vat_position")
      .select("*")
      .gte("period_start", windowStart)
      .lte("period_start", windowEnd)
      .order("period_start", { ascending: false }),
    supabase.from("vat_periods").select("*"),
  ]);

  const filingByPeriod = new Map((filings ?? []).map((f) => [f.period_start, f]));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{el.nav.vat}</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Υπολογίζεται με βάση την ημερομηνία τιμολογίου (accrual), με μεταφορά πιστωτικού
            υπολοίπου μήνα προς μήνα. Δείχνονται οι περίοδοι από 6 μήνες πριν έως 6 μήνες μετά τον
            τρέχοντα μήνα.
          </p>
        </div>
        <a href="/api/vat/export">
          <Button variant="secondary">Εξαγωγή CSV</Button>
        </a>
      </div>

      {(positions ?? []).length === 0 ? (
        <p className="p-6 text-center text-sm text-ink-muted">
          Δεν υπάρχουν ακόμα κινήσεις για υπολογισμό θέσης ΦΠΑ.
        </p>
      ) : (
      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg text-ink-muted">
            <tr>
              <th className="p-2">{el.vat.period}</th>
              <th className="hidden p-2 text-right sm:table-cell">{el.vat.vatIncome}</th>
              <th className="hidden p-2 text-right sm:table-cell">{el.vat.vatExpense}</th>
              <th className="hidden p-2 text-right md:table-cell">{el.vat.credit}</th>
              <th className="p-2 text-right">{el.vat.payable}</th>
              <th className="hidden p-2 md:table-cell">{el.vat.deadline}</th>
              <th className="p-2">{el.vat.filed}</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {(positions ?? []).map((p) => {
              const filing = filingByPeriod.get(p.period_start!);
              const filed = filing?.status === "filed" || filing?.status === "paid";
              const isCurrent = p.period_start === todayMonth;
              return (
                <tr key={p.period_start} className={`border-t border-line ${isCurrent ? "bg-sage/40" : ""}`}>
                  <td className="p-2">
                    {formatDate(p.period_start)}
                    {isCurrent && <span className="ml-1.5 text-xs text-sage-ink">τρέχων μήνας</span>}
                  </td>
                  <td className="hidden p-2 text-right font-mono sm:table-cell">{formatMoney(p.vat_income)}</td>
                  <td className="hidden p-2 text-right font-mono sm:table-cell">{formatMoney(p.vat_expense)}</td>
                  <td className="hidden p-2 text-right font-mono md:table-cell">
                    {formatMoney(Math.abs(p.credit_balance ?? 0))}
                  </td>
                  <td className="p-2 text-right font-mono font-medium">
                    {formatMoney(p.payable_after_credit)}
                  </td>
                  <td className="hidden p-2 text-xs text-ink-muted md:table-cell">{formatDate(p.filing_deadline)}</td>
                  <td className="p-2">
                    <Badge tone={filed ? "green" : "amber"}>
                      {filed ? el.vat.filed : el.vat.notFiled}
                    </Badge>
                  </td>
                  <td className="p-2">
                    <form action={toggleVatFiled.bind(null, p.period_start!, filed)}>
                      <button type="submit" className="text-xs text-ink-muted underline">
                        {filed ? "Αναίρεση" : "Σήμανση ως υποβλήθηκε"}
                      </button>
                    </form>
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
