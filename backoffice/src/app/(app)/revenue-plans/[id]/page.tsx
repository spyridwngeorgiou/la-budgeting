import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { Card, Button } from "@/components/ui";
import { computeRevenuePlan, type RoomType, type Assumption } from "@/lib/finance/revenuePlan";
import { addRoomType, deleteRoomType, deleteRevenuePlan } from "../actions";
import { YearTable } from "./YearTable";

export default async function RevenuePlanDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from("revenue_plans")
    .select("id, name, start_year, years, notes, projects(display_name)")
    .eq("id", id)
    .maybeSingle();
  if (!plan) notFound();

  const { data: roomTypesData } = await supabase
    .from("revenue_plan_room_types")
    .select("id, name, unit_count, sort_order, revenue_plan_assumptions(year_number, month_number, occupancy_pct, adr)")
    .eq("revenue_plan_id", id)
    .order("sort_order");

  const roomTypes: RoomType[] = (roomTypesData ?? []).map((rt) => ({
    id: rt.id,
    name: rt.name,
    unitCount: rt.unit_count,
  }));
  const assumptions: Assumption[] = (roomTypesData ?? []).flatMap((rt) =>
    (rt.revenue_plan_assumptions ?? []).map((a) => ({
      roomTypeId: rt.id,
      yearNumber: a.year_number,
      monthNumber: a.month_number,
      occupancyPct: a.occupancy_pct,
      adr: a.adr,
    })),
  );

  const result = computeRevenuePlan(plan.start_year, roomTypes, assumptions);
  const project = Array.isArray(plan.projects) ? plan.projects[0] : plan.projects;
  const years = Array.from({ length: plan.years }, (_, i) => i + 1);

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{plan.name}</h1>
          <p className="text-sm text-ink-muted">
            {plan.start_year}–{plan.start_year + plan.years - 1}
            {project && ` · ${project.display_name}`}
          </p>
          {plan.notes && <p className="mt-1 text-sm text-ink-muted">{plan.notes}</p>}
        </div>
        <form action={deleteRevenuePlan.bind(null, plan.id)}>
          <Button type="submit" variant="danger">
            Διαγραφή Ανάλυσης
          </Button>
        </form>
      </div>

      <Card className="border-ai-border bg-ai-bg">
        <div className="text-xs font-medium text-ai-ink">Συνολικά Έσοδα Περιόδου</div>
        <div className="font-mono text-2xl">{formatMoney(result.grandTotal)}</div>
      </Card>

      {result.summary.length > 0 && (
        <div className="overflow-x-auto rounded border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg text-ink-muted">
              <tr>
                <th className="p-2">Τύπος Δωματίου</th>
                {years.map((y) => (
                  <th key={y} className="p-2 text-right">
                    Έτος {y}
                  </th>
                ))}
                <th className="p-2 text-right font-semibold">Σύνολο</th>
              </tr>
            </thead>
            <tbody>
              {result.summary.map((s) => (
                <tr key={s.roomTypeId} className="border-t border-line">
                  <td className="p-2">{s.roomTypeName}</td>
                  {years.map((y) => (
                    <td key={y} className="p-2 text-right font-mono">
                      {formatMoney(s.byYear[y - 1] ?? 0)}
                    </td>
                  ))}
                  <td className="p-2 text-right font-mono font-semibold">{formatMoney(s.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line-strong font-semibold">
                <td className="p-2">Σύνολο</td>
                {result.yearTotals.map((y) => (
                  <td key={y.yearNumber} className="p-2 text-right font-mono">
                    {formatMoney(y.annualRevenue)}
                  </td>
                ))}
                <td className="p-2 text-right font-mono">{formatMoney(result.grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {(roomTypesData ?? []).map((rt) => (
          <Card key={rt.id}>
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium">
                {rt.name} <span className="text-ink-faint">({rt.unit_count} δωμάτια)</span>
              </div>
              <form action={deleteRoomType.bind(null, plan.id, rt.id)}>
                <Button type="submit" variant="secondary">
                  Αφαίρεση
                </Button>
              </form>
            </div>
            <div className="flex flex-col gap-4">
              {years.map((y) => (
                <YearTable
                  key={y}
                  planId={plan.id}
                  roomTypeId={rt.id}
                  yearNumber={y}
                  calendarYear={plan.start_year + y - 1}
                  months={result.roomTypeYears.find((ry) => ry.roomTypeId === rt.id && ry.yearNumber === y)?.months ?? []}
                />
              ))}
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <h2 className="mb-2 text-sm font-medium text-ink-muted">+ Νέος Τύπος Δωματίου</h2>
        <form action={addRoomType.bind(null, plan.id)} className="flex flex-wrap items-end gap-3">
          <div className="flex flex-col">
            <label className="mb-1 text-xs font-medium text-ink-muted">Όνομα</label>
            <input name="name" required className="rounded-md border border-line-strong px-3 py-2 text-sm" />
          </div>
          <div className="flex flex-col">
            <label className="mb-1 text-xs font-medium text-ink-muted">Αριθμός Δωματίων</label>
            <input name="unit_count" type="number" min={1} required className="w-24 rounded-md border border-line-strong px-3 py-2 text-sm" />
          </div>
          <Button type="submit">Προσθήκη</Button>
        </form>
      </Card>
    </div>
  );
}
