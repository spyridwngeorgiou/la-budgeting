import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { Badge, Button } from "@/components/ui";
import { loadProjectModel, type ScenarioResult } from "@/lib/finance/projectModel";

// Side-by-side view of every scenario a project has, computed by the same
// computeScenarioFromInputs() as the single-scenario project page (see
// projectModel.ts) so the two views can never disagree on a number.
export async function LegacyComparePage({ id }: { id: string }) {
  const supabase = await createClient();

  const [{ data: project }, model] = await Promise.all([
    supabase.from("projects").select("display_name, code").eq("id", id).maybeSingle(),
    loadProjectModel(supabase, id),
  ]);
  if (!project || !model) notFound();
  const results = model.results;

  const rows: { label: string; render: (r: ScenarioResult) => React.ReactNode }[] = [
    { label: "Έτος αναφοράς", render: (r) => (r.referenceCalendarYear ? String(r.referenceCalendarYear) : "—") },
    { label: "Έσοδα", render: (r) => formatMoney(r.revenue) },
    { label: "Λειτουργικά έξοδα", render: (r) => formatMoney(r.opexTotal) },
    { label: "Ενοίκιο", render: (r) => formatMoney(r.annualRent) },
    { label: "Λειτουργικό αποτέλεσμα", render: (r) => formatMoney(r.operatingResult) },
    {
      label: "Ελάχιστο DSCR",
      render: (r) =>
        r.cashflow?.kpis.minDscr ? `${r.cashflow.kpis.minDscr.value.toFixed(2)}× (${r.cashflow.kpis.minDscr.calendarYear})` : "—",
    },
    {
      label: "Παραβάσεις covenant",
      render: (r) => (r.cashflow ? String(r.cashflow.kpis.covenantBreaches.length) : "—"),
    },
    {
      label: "NPV (μετά δανείου)",
      render: (r) => (r.cashflow ? formatMoney(r.cashflow.kpis.npv) : "—"),
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Σύγκριση σεναρίων — {project.display_name}</h1>
          <p className="text-sm text-ink-muted">{project.code}</p>
        </div>
        <Link href={`/projects/${id}`}>
          <Button variant="secondary">Πίσω στο έργο</Button>
        </Link>
      </div>

      {results.length === 0 ? (
        <p className="text-sm text-ink-muted">Δεν υπάρχουν σενάρια για αυτό το έργο ακόμα.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-line bg-surface">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className="p-3 text-left font-semibold text-ink">Μέγεθος</th>
                {results.map(({ scenario }) => (
                  <th key={scenario.id} className="p-3 text-right font-semibold text-ink">
                    <div className="flex items-center justify-end gap-2">
                      {scenario.name}
                      {scenario.is_base && <Badge tone="green">βάση</Badge>}
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label} className="border-b border-line last:border-0">
                  <td className="p-3 text-ink-muted">{row.label}</td>
                  {results.map(({ scenario, result }) => (
                    <td key={scenario.id} className="p-3 text-right font-mono tabular-nums text-ink">
                      {row.render(result)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
