import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { Card, Button, AiSpark } from "@/components/ui";
import { computeRevenuePlan } from "@/lib/finance/revenuePlan";
import { createRevenuePlan } from "./actions";
import { AiCreateForm } from "./AiCreateForm";
import { aiEnabled } from "@/lib/ai/client";

export default async function RevenuePlansPage() {
  const supabase = await createClient();
  const { data: plans } = await supabase
    .from("revenue_plans")
    .select("id, name, start_year, years, projects(display_name), revenue_plan_room_types(id, name, unit_count, revenue_plan_assumptions(year_number, month_number, occupancy_pct, adr))")
    .order("created_at", { ascending: false });

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        <AiSpark className="text-ai-ink" />
        <h1 className="text-xl font-semibold">Εκτιμήσεις Εσόδων</h1>
      </div>
      <p className="text-sm text-ink-muted">
        Αναλύσεις εσόδων τύπου ξενοδοχείου/φιλοξενίας (τύποι δωματίων × πληρότητα × ADR ανά μήνα).
      </p>

      {aiEnabled() ? (
        <AiCreateForm />
      ) : (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800">
          Ο βοηθός AI δεν είναι ενεργοποιημένος -- μπορείτε ακόμα να φτιάξετε μια ανάλυση χειροκίνητα
          παρακάτω.
        </p>
      )}

      <details className="rounded-md border border-line bg-surface p-3">
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

      {(plans ?? []).length === 0 ? (
        <p className="text-sm text-ink-faint">Καμία ανάλυση ακόμα.</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(plans ?? []).map((p) => {
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
            return (
              <Link key={p.id} href={`/revenue-plans/${p.id}`}>
                <Card className="h-full transition-colors hover:border-ai-border hover:bg-ai-bg">
                  <div className="text-sm font-medium">{p.name}</div>
                  {project && <div className="text-xs text-ink-muted">{project.display_name}</div>}
                  <div className="mt-2 text-xs text-ink-muted">
                    {p.start_year}–{p.start_year + p.years - 1} · {roomTypes.length} τύποι δωματίων
                  </div>
                  <div className="mt-2 font-mono text-lg">{formatMoney(result.grandTotal)}</div>
                  <div className="text-xs text-ink-faint">συνολικά έσοδα περιόδου</div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
