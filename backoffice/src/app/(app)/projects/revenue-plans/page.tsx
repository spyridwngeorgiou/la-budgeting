import { createClient } from "@/lib/supabase/server";
import { Notice, PageHeader, SectionHeader, Term } from "@/components/ui";
import { computeRevenuePlan } from "@/lib/finance/revenuePlan";
import { AiCreateForm } from "./AiCreateForm";
import { ManualPlanForm } from "./ManualPlanForm";
import { RevenuePlansGrid, type RevenuePlanRow } from "./RevenuePlansGrid";
import { aiEnabled } from "@/lib/ai/client";
import { getCurrentOrgId } from "@/lib/supabase/org";

export default async function RevenuePlansPage() {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const { data: plans } = await supabase
    .from("revenue_plans")
    .select("id, name, start_year, years, projects(display_name), revenue_plan_room_types(id, name, unit_count, revenue_plan_assumptions(year_number, month_number, occupancy_pct, adr))")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  const planRows: RevenuePlanRow[] = (plans ?? []).map((p) => {
    const roomTypes = (p.revenue_plan_room_types ?? []).map((rt) => ({
      id: rt.id,
      name: rt.name,
      unitCount: rt.unit_count,
    }));
    const assumptions = (p.revenue_plan_room_types ?? []).flatMap((rt) =>
      (rt.revenue_plan_assumptions ?? []).map((a) => ({
        roomTypeId: rt.id,
        yearNumber: a.year_number,
        monthNumber: a.month_number,
        occupancyPct: a.occupancy_pct,
        adr: a.adr,
      })),
    );
    const result = computeRevenuePlan(p.start_year, roomTypes, assumptions);
    const project = Array.isArray(p.projects) ? p.projects[0] : p.projects;
    return {
      id: p.id,
      name: p.name,
      projectName: project?.display_name ?? null,
      startYear: p.start_year,
      years: p.years,
      roomTypeCount: roomTypes.length,
      grandTotal: result.grandTotal,
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Εκτιμήσεις Εσόδων"
        meta={
          <span className="block max-w-prose">
            Αναλύσεις εσόδων τύπου ξενοδοχείου/φιλοξενίας (τύποι δωματίων × πληρότητα ×{" "}
            <Term title="ADR (Average Daily Rate) — μέση τιμή δωματίου ανά διανυκτέρευση.">ADR</Term> ανά μήνα), με
            σύγκριση έναντι πραγματικών εσόδων όταν η ανάλυση συνδέεται με έργο.
          </span>
        }
      />

      <section className="flex flex-col gap-4">
        <SectionHeader title="Νέα Ανάλυση Εσόδων" />

        {aiEnabled() ? (
          <AiCreateForm />
        ) : (
          <Notice tone="warning" className="max-w-prose">
            Ο βοηθός AI δεν είναι ενεργοποιημένος· μπορείτε ακόμα να φτιάξετε μια ανάλυση χειροκίνητα
            παρακάτω.
          </Notice>
        )}

        <ManualPlanForm />
      </section>

      <section className="flex flex-col gap-4">
        <SectionHeader title="Υπάρχουσες Αναλύσεις" />
        <RevenuePlansGrid plans={planRows} />
      </section>
    </div>
  );
}
