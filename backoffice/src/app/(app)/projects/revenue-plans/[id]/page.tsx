import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Button, Field, Input, PageHeader, SectionHeader, Stat } from "@/components/ui";
import { computeRevenuePlan, type RoomType, type Assumption } from "@/lib/finance/revenuePlan";
import { addRoomType, deleteRoomType, deleteRevenuePlan } from "../actions";
import { YearTable } from "./YearTable";
import { todayAthens } from "@/lib/dates";

// P15 spec table cells; 44px buttons on phones.
const TH = "eyebrow border-b border-rule px-3 py-2.5 font-medium whitespace-nowrap text-muted";
const TD = "border-b border-hairline px-3 py-3";
const TF = "border-t border-ink px-3 py-3 font-medium text-ink";
const TAP = "max-md:min-h-11";

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
  const todayIso = todayAthens();
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
    <div className="flex flex-col gap-8">
      <PageHeader
        eyebrow={el.nav.revenuePlans}
        title={plan.name}
        meta={
          <>
            <span className="num">
              {plan.start_year}–{plan.start_year + plan.years - 1}
            </span>
            {project && ` · ${project.display_name}`}
            {plan.notes && <span className="mt-1 block max-w-prose">{plan.notes}</span>}
          </>
        }
        actions={
          <form action={deleteRevenuePlan.bind(null, plan.id)}>
            <Button type="submit" variant="danger" className={TAP}>
              Διαγραφή Ανάλυσης
            </Button>
          </form>
        }
      />

      <Stat label="Συνολικά Έσοδα Περιόδου" value={formatMoney(result.grandTotal)} size="lg" />

      {!plan.project_id && (
        <p className="text-small text-muted">
          Η ανάλυση δεν είναι συνδεδεμένη με έργο, οπότε δεν υπάρχει σύγκριση με πραγματικά έσοδα.
        </p>
      )}

      {plan.project_id && actualComparison.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className={TH}>Πραγματικά vs Πρόβλεψη</th>
                <th scope="col" className={`${TH} text-right`}>Πρόβλεψη</th>
                <th scope="col" className={`${TH} text-right`}>Πραγματικό</th>
                <th scope="col" className={`${TH} text-right`}>Διαφορά</th>
              </tr>
            </thead>
            <tbody>
              {actualComparison.map((r) => {
                const diffPct = r.planned > 0 ? Math.round(((r.actual - r.planned) / r.planned) * 100) : null;
                const current = r.monthKey === todayMonthKey;
                return (
                  <tr key={r.monthKey} aria-current={current ? "date" : undefined} className="hover:bg-hover">
                    <td className={`${TD} capitalize ${current ? "border-l-2 border-l-navy font-medium text-ink" : "text-text"}`}>
                      {r.label}
                    </td>
                    <td className={`${TD} num text-right whitespace-nowrap text-text`}>{formatMoney(r.planned)}</td>
                    <td className={`${TD} num text-right whitespace-nowrap text-ink`}>{formatMoney(r.actual)}</td>
                    <td className={`${TD} num text-right whitespace-nowrap ${diffPct != null ? "text-ink" : "text-muted"}`}>
                      {diffPct != null ? `${diffPct > 0 ? "+" : diffPct < 0 ? "−" : ""}${Math.abs(diffPct)}%` : "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {result.summary.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-left text-sm">
            <thead>
              <tr>
                <th scope="col" className={TH}>Τύπος Δωματίου</th>
                {years.map((y) => (
                  <th key={y} scope="col" className={`${TH} text-right`}>
                    Έτος {y}
                  </th>
                ))}
                <th scope="col" className={`${TH} text-right`}>Σύνολο</th>
              </tr>
            </thead>
            <tbody>
              {result.summary.map((s) => (
                <tr key={s.roomTypeId} className="hover:bg-hover">
                  <td className={`${TD} text-ink`}>{s.roomTypeName}</td>
                  {years.map((y) => (
                    <td key={y} className={`${TD} num text-right whitespace-nowrap text-text`}>
                      {formatMoney(s.byYear[y - 1] ?? 0)}
                    </td>
                  ))}
                  <td className={`${TD} num text-right font-medium whitespace-nowrap text-ink`}>{formatMoney(s.total)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className={TF}>Σύνολο</td>
                {result.yearTotals.map((y) => (
                  <td key={y.yearNumber} className={`${TF} num text-right whitespace-nowrap`}>
                    {formatMoney(y.annualRevenue)}
                  </td>
                ))}
                <td className={`${TF} num text-right whitespace-nowrap`}>{formatMoney(result.grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="flex flex-col gap-10">
        {(roomTypesData ?? []).map((rt) => (
          <section key={rt.id} className="flex flex-col gap-4">
            <SectionHeader
              as="h2"
              title={
                <>
                  {rt.name} <span className="num text-muted">({rt.unit_count} δωμάτια)</span>
                </>
              }
              actions={
                <form action={deleteRoomType.bind(null, plan.id, rt.id)}>
                  <Button type="submit" variant="secondary" size="sm" className={TAP}>
                    Αφαίρεση
                  </Button>
                </form>
              }
            />
            <div className="flex flex-col gap-6">
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
          </section>
        ))}
      </div>

      <section className="flex flex-col gap-4">
        <SectionHeader title="+ Νέος Τύπος Δωματίου" />
        <form action={addRoomType.bind(null, plan.id)} className="flex flex-wrap items-end gap-3">
          <Field label="Όνομα" htmlFor="room-type-name" className="min-w-48 flex-1 sm:flex-none">
            <Input id="room-type-name" name="name" required />
          </Field>
          <Field label="Αριθμός Δωματίων" htmlFor="room-type-units">
            <Input id="room-type-units" name="unit_count" type="number" min={1} required className="num w-24" />
          </Field>
          <Button type="submit" className={TAP}>
            Προσθήκη
          </Button>
        </form>
      </section>
    </div>
  );
}
