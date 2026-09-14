import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge } from "@/components/ui";
import { toggleVatFiled } from "./actions";

export default async function VatPage() {
  const supabase = await createClient();

  const [{ data: positions }, { data: filings }] = await Promise.all([
    supabase.from("v_vat_position").select("*").order("period_start", { ascending: false }).limit(24),
    supabase.from("vat_periods").select("*"),
  ]);

  const filingByPeriod = new Map((filings ?? []).map((f) => [f.period_start, f]));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{el.nav.vat}</h1>
      <p className="text-sm text-ink-muted">
        Υπολογίζεται με βάση την ημερομηνία τιμολογίου (accrual), με μεταφορά πιστωτικού
        υπολοίπου μήνα προς μήνα.
      </p>

      {(positions ?? []).length === 0 ? (
        <p className="p-6 text-center text-sm text-ink-muted">
          Δεν υπάρχουν ακόμα κινήσεις για υπολογισμό θέσης ΦΠΑ.
        </p>
      ) : (
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg text-ink-muted">
            <tr>
              <th className="p-2">{el.vat.period}</th>
              <th className="p-2 text-right">{el.vat.vatIncome}</th>
              <th className="p-2 text-right">{el.vat.vatExpense}</th>
              <th className="p-2 text-right">{el.vat.credit}</th>
              <th className="p-2 text-right">{el.vat.payable}</th>
              <th className="p-2">{el.vat.deadline}</th>
              <th className="p-2">{el.vat.filed}</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {(positions ?? []).map((p) => {
              const filing = filingByPeriod.get(p.period_start!);
              const filed = filing?.status === "filed" || filing?.status === "paid";
              return (
                <tr key={p.period_start} className="border-t border-line">
                  <td className="p-2">{formatDate(p.period_start)}</td>
                  <td className="p-2 text-right font-mono">{formatMoney(p.vat_income)}</td>
                  <td className="p-2 text-right font-mono">{formatMoney(p.vat_expense)}</td>
                  <td className="p-2 text-right font-mono">
                    {formatMoney(Math.abs(p.credit_balance ?? 0))}
                  </td>
                  <td className="p-2 text-right font-mono font-medium">
                    {formatMoney(p.payable_after_credit)}
                  </td>
                  <td className="p-2 text-xs text-ink-muted">{formatDate(p.filing_deadline)}</td>
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
