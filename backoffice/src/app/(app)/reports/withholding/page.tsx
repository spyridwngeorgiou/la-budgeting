import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney, formatDate } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { PageHeader, cn } from "@/components/ui";
import { FRAME, NUM, TABLE, TD, TH } from "../ui";

export default async function WithholdingPage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const { data: positions } = await supabase
    .from("v_withholding_position")
    .select("*")
    .eq("org_id", orgId)
    .order("period_start", { ascending: false })
    .limit(24);

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader
        title={el.nav.withholding}
        meta={
          <span className="block max-w-3xl">
            Παρακράτηση φόρου σε πληρωμές προς προμηθευτές/συνεργάτες, μηνιαία, μόνο στην πλευρά
            των εξόδων.
          </span>
        }
      />

      {(positions ?? []).length === 0 ? (
        <p className="border-y border-hairline py-6 text-sm text-muted">
          Δεν υπάρχουν ακόμα κινήσεις με παρακράτηση.
        </p>
      ) : (
        <div className={cn(FRAME, "max-w-2xl")}>
          <table className={TABLE}>
            <thead>
              <tr>
                <th scope="col" className={TH}>
                  {el.vat.period}
                </th>
                <th scope="col" className={cn(TH, "text-right")}>
                  Παρακρατηθέν Ποσό
                </th>
              </tr>
            </thead>
            <tbody>
              {(positions ?? []).map((p) => (
                <tr key={p.period_start} className="hover:bg-hover">
                  <td className={cn(TD, "num text-ink")}>{formatDate(p.period_start)}</td>
                  <td className={cn(TD, NUM, "text-ink")}>{formatMoney(p.withheld_total)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
