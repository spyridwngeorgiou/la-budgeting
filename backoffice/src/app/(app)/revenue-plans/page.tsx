import { createClient } from "@/lib/supabase/server";
import { Button, Term } from "@/components/ui";
import { computeRevenuePlan } from "@/lib/finance/revenuePlan";
import { createRevenuePlan } from "./actions";
import { AiCreateForm } from "./AiCreateForm";
import { RevenuePlansGrid, type RevenuePlanRow } from "./RevenuePlansGrid";
import { aiEnabled } from "@/lib/ai/client";

export default async function RevenuePlansPage() {
  const supabase = await createClient();
  const { data: plans } = await supabase
    .from("revenue_plans")
    .select("id, name, start_year, years, projects(display_name), revenue_plan_room_types(id, name, unit_count, revenue_plan_assumptions(year_number, month_number, occupancy_pct, adr))")
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
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-xl font-semibold">Εκτιμήσεις Εσόδων</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Αναλύσεις εσόδων τύπου ξενοδοχείου/φιλοξενίας (τύποι δωματίων × πληρότητα ×{" "}
          <Term title="ADR (Average Daily Rate) — μέση τιμή δωματίου ανά διανυκτέρευση.">ADR</Term> ανά μήνα), με
          σύγκριση έναντι πραγματικών εσόδων όταν η ανάλυση συνδέεται με έργο.
        </p>
      </div>

      <section className="flex flex-col gap-3 rounded-md border border-line-strong bg-surface p-4">
        <h2 className="text-sm font-semibold text-ink">Νέα Ανάλυση Εσόδων</h2>

        {aiEnabled() ? (
          <AiCreateForm />
        ) : (
          <p className="rounded-md border border-amber-ink/40 bg-amber-bg p-3 text-sm text-amber-ink">
            Ο βοηθός AI δεν είναι ενεργοποιημένος -- μπορείτε ακόμα να φτιάξετε μια ανάλυση χειροκίνητα
            παρακάτω.
          </p>
        )}

        <details className="rounded-md border border-line bg-bg p-3">
          <summary className="cursor-pointer text-sm font-medium text-ink-muted">
            ή ξεκίνα μια κενή ανάλυση χειροκίνητα
          </summary>
          <form action={createRevenuePlan} className="mt-3 flex flex-wrap items-end gap-3">
            <div className="flex flex-col">
              <label className="mb-1 text-xs font-medium text-ink-muted">Όνομα</label>
              <input name="name" required className="rounded-md border border-line-strong px-3 py-2 text-sm" />
            </div>
            <div className="flex flex-col">
              <label className="mb-1 text-xs font-medium text-ink-muted">Έτος Έναρξης</label>
              <input
                name="start_year"
                type="number"
                defaultValue={new Date().getFullYear()}
                required
                className="w-28 rounded-md border border-line-strong px-3 py-2 text-sm"
              />
            </div>
            <div className="flex flex-col">
              <label className="mb-1 text-xs font-medium text-ink-muted">Έτη</label>
              <input
                name="years"
                type="number"
                min={1}
                max={10}
                defaultValue={3}
                required
                className="w-20 rounded-md border border-line-strong px-3 py-2 text-sm"
              />
            </div>
            <Button type="submit" variant="secondary">
              Δημιουργία
            </Button>
          </form>
        </details>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink">Υπάρχουσες Αναλύσεις</h2>
        <RevenuePlansGrid plans={planRows} />
      </section>
    </div>
  );
}
