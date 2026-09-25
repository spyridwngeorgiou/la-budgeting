import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";

export default async function WithholdingPage() {
  const supabase = await createClient();
  const { data: positions } = await supabase
    .from("v_withholding_position")
    .select("*")
    .order("period_start", { ascending: false })
    .limit(24);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{el.nav.withholding}</h1>
      <p className="text-sm text-ink-muted">
        Παρακράτηση φόρου σε πληρωμές προς προμηθευτές/συνεργάτες, μηνιαία, μόνο στην πλευρά
        των εξόδων.
      </p>

      {(positions ?? []).length === 0 ? (
        <p className="p-6 text-center text-sm text-ink-muted">
          Δεν υπάρχουν ακόμα κινήσεις με παρακράτηση.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg text-ink-muted">
              <tr>
                <th className="p-2">{el.vat.period}</th>
                <th className="p-2 text-right">Παρακρατηθέν Ποσό</th>
              </tr>
            </thead>
            <tbody>
              {(positions ?? []).map((p) => (
                <tr key={p.period_start} className="border-t border-line">
                  <td className="p-2">{formatDate(p.period_start)}</td>
                  <td className="p-2 text-right font-mono">{formatMoney(p.withheld_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
