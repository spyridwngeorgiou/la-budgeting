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
    .select("id, name, start_year, years, notes, project_id, projects(display_name)")
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

  // Actual-vs-plan: a revenue plan was previously a one-time forecast with
  // nothing ever checking it against what actually happened. Only possible
  // when the plan is linked to a project (project_id) -- that's the only
  // way to know which income transactions belong to it. Calendar mapping is
  // exact (calendarYear = start_year + yearNumber - 1, month_number is a
  // real calendar month), same math computeRevenuePlan already uses, so no
  // separate date logic is needed here.
  const todayIso = new Date().toISOString().slice(0, 10);
  const todayMonthKey = todayIso.slice(0, 7);
  let actualComparison: { monthKey: string; label: string; planned: number; actual: number }[] = [];

  if (plan.project_id) {
    const { data: actualTx } = await supabase
      .from("transactions")
      .select("tx_date, gross_amount")
      .eq("project_id", plan.project_id)
      .eq("direction", "income")
      .neq("status", "cancelled")
      .gte("tx_date", `${plan.start_year}-01-01`)
      .lte("tx_date", todayIso);

    const actualByMonth = new Map<string, number>();
    for (const tx of actualTx ?? []) {
      const key = tx.tx_date.slice(0, 7);
      actualByMonth.set(key, (actualByMonth.get(key) ?? 0) + Number(tx.gross_amount ?? 0));
    }

    const plannedByMonth = new Map<string, number>();
    for (const yt of result.yearTotals) {
      const calendarYear = plan.start_year + yt.yearNumber - 1;
      yt.monthlyRevenue.forEach((rev, i) => {
        plannedByMonth.set(`${calendarYear}-${String(i + 1).padStart(2, "0")}`, rev);
      });
    }

    actualComparison = [...plannedByMonth.keys()]
      .filter((key) => key <= todayMonthKey)
      .sort()
      .map((key) => ({
        monthKey: key,
        label: new Date(key + "-01T00:00:00Z").toLocaleDateString("el-GR", { month: "short", year: "2-digit", timeZone: "UTC" }),
        planned: plannedByMonth.get(key) ?? 0,
        actual: actualByMonth.get(key) ?? 0,
      }));
  }

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

      <Card>
        <div className="text-xs font-medium text-ink-muted">Συνολικά Έσοδα Περιόδου</div>
        <div className="font-mono text-2xl">{formatMoney(result.grandTotal)}</div>
      </Card>

      {!plan.project_id && (
        <p className="text-xs text-ink-faint">
          Η ανάλυση δεν είναι συνδεδεμένη με έργο, οπότε δεν υπάρχει σύγκριση με πραγματικά έσοδα.
        </p>
      )}

      {plan.project_id && actualComparison.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-left text-sm">
            <thead className="bg-bg text-ink-muted">
              <tr>
                <th className="p-2">Πραγματικά vs Πρόβλεψη</th>
                <th className="p-2 text-right">Πρόβλεψη</th>
                <th className="p-2 text-right">Πραγματικό</th>
                <th className="p-2 text-right">Διαφορά</th>
              </tr>
            </thead>
            <tbody>
              {actualComparison.map((r) => {
                const diffPct = r.planned > 0 ? Math.round(((r.actual - r.planned) / r.planned) * 100) : null;
                return (
                  <tr key={r.monthKey} className={`border-t border-line ${r.monthKey === todayMonthKey ? "bg-sage/40" : ""}`}>
                    <td className="p-2 capitalize">{r.label}</td>
                    <td className="p-2 text-right font-mono text-ink-muted">{formatMoney(r.planned)}</td>
                    <td className="p-2 text-right font-mono">{formatMoney(r.actual)}</td>
                    <td className={`p-2 text-right font-mono ${diffPct != null && diffPct < 0 ? "text-red-ink" : diffPct != null ? "text-sage-ink" : "text-ink-faint"}`}>
                      {diffPct != null ? `${diffPct > 0 ? "+" : ""}${diffPct}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result.summary.length > 0 && (
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full table-fixed border-collapse text-left text-sm">
            <colgroup>
              <col />
              {years.map((y) => (
                <col key={y} className="w-28" />
              ))}
              <col className="w-32" />
            </colgroup>
            <thead className="bg-bg text-ink-muted">
              <tr>
                <th className="p-2 font-medium">Τύπος Δωματίου</th>
                {years.map((y) => (
                  <th key={y} className="p-2 text-right font-medium">
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
