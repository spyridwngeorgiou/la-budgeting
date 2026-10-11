import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney } from "@/lib/format";
import { monthKeyOf, monthLabel } from "@/lib/dates";
import { el } from "@/lib/i18n/el";
import { PageHeader, SpecTable, Td, Th, Tr } from "@/components/ui";

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
    <div className="flex min-w-0 flex-col gap-10">
      <PageHeader
        title={el.nav.withholding}
        meta={
          <span className="block max-w-3xl">{el.reports.withholdingIntro}</span>
        }
      />

      {(positions ?? []).length === 0 ? (
        <p className="border-y border-hairline py-6 text-body text-muted">
          Δεν υπάρχουν ακόμα κινήσεις με παρακράτηση.
        </p>
      ) : (
        <SpecTable label={el.nav.withholding} className="max-w-2xl">
          <thead>
            <tr>
              <Th>{el.vat.period}</Th>
              <Th numeric>Παρακρατηθέν Ποσό</Th>
            </tr>
          </thead>
          <tbody>
            {(positions ?? []).map((p) => (
              <Tr key={p.period_start}>
                <Td strong className="whitespace-nowrap">
                  {p.period_start ? monthLabel(monthKeyOf(p.period_start)) : "—"}
                </Td>
                <Td numeric strong>
                  {formatMoney(p.withheld_total)}
                </Td>
              </Tr>
            ))}
          </tbody>
        </SpecTable>
      )}
    </div>
  );
}
