import { createClient } from "@/lib/supabase/server";
import { getCurrentOrg } from "@/lib/supabase/org";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge } from "@/components/ui";

export default async function CashflowPage() {
  const supabase = await createClient();

  const [{ data: monthly }, org] = await Promise.all([
    supabase.from("v_cashflow_monthly").select("*").order("month"),
    getCurrentOrg(supabase),
  ]);

  const buffer = Number((org.settings as Record<string, unknown>)?.min_cash_buffer ?? 50000);

  const byMonth = new Map<string, { inflow: number; outflow: number; weighted: number }>();
  for (const row of monthly ?? []) {
    const key = row.month!;
    const existing = byMonth.get(key) ?? { inflow: 0, outflow: 0, weighted: 0 };
    existing.inflow += Number(row.inflow ?? 0);
    existing.outflow += Number(row.outflow ?? 0);
    existing.weighted += Number(row.weighted_expected_inflow ?? 0);
    byMonth.set(key, existing);
  }

  const months = [...byMonth.keys()].sort();
  let running = 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">Ταμείο — Ρευστότητα</h1>
      <p className="text-sm text-ink-muted">
        Προγραμματισμένες κινήσεις δεν προσμετρώνται εδώ (πραγματική ταμειακή ροή, όχι
        δεσμευμένο budget). Απόθεμα ασφαλείας: {formatMoney(buffer)}.
      </p>

      {months.length === 0 ? (
        <p className="p-6 text-center text-sm text-ink-muted">
          Δεν υπάρχουν ακόμα πληρωμένες κινήσεις για πρόβλεψη ταμείου.
        </p>
      ) : (
      <div className="overflow-x-auto rounded border border-line">
        <table className="w-full text-left text-sm">
          <thead className="bg-bg text-ink-muted">
            <tr>
              <th className="p-2">Μήνας</th>
              <th className="p-2 text-right">Εισροές</th>
              <th className="p-2 text-right">Εκροές</th>
              <th className="p-2 text-right">Καθαρό</th>
              <th className="p-2 text-right">Σωρευτικό</th>
              <th className="p-2"></th>
            </tr>
          </thead>
          <tbody>
            {months.map((month) => {
              const m = byMonth.get(month)!;
              const net = m.inflow - m.outflow;
              running += net;
              const belowBuffer = running < buffer;
              return (
                <tr key={month} className="border-t border-line">
                  <td className="p-2">{formatDate(month)}</td>
                  <td className="p-2 text-right font-mono text-sage-ink">{formatMoney(m.inflow)}</td>
                  <td className="p-2 text-right font-mono">{formatMoney(m.outflow)}</td>
                  <td className={`p-2 text-right font-mono ${net < 0 ? "text-red-ink" : ""}`}>
                    {formatMoney(net)}
                  </td>
                  <td className="p-2 text-right font-mono font-medium">{formatMoney(running)}</td>
                  <td className="p-2">
                    {belowBuffer && <Badge tone="red">κάτω από απόθεμα</Badge>}
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
