import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatMoney, formatMultiple } from "@/lib/format";
import { el } from "@/lib/i18n/el";
import { Badge, ButtonLink, PageHeader, SpecTable, TD_CLASS, Td, Th, Tr } from "@/components/ui";
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
        r.cashflow?.kpis.minDscr ? `${formatMultiple(r.cashflow.kpis.minDscr.value)} (${r.cashflow.kpis.minDscr.calendarYear})` : "—",
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
    <div className="flex flex-col gap-10">
      <PageHeader
        eyebrow={el.nav.projects}
        title={`Σύγκριση σεναρίων — ${project.display_name}`}
        meta={project.code}
        actions={
          <ButtonLink href={`/projects/${id}`}>
            Πίσω στο έργο
          </ButtonLink>
        }
      />

      {results.length === 0 ? (
        <p className="border-y border-hairline py-6 text-body text-muted">Δεν υπάρχουν σενάρια για αυτό το έργο ακόμα.</p>
      ) : (
        // The scenarios ARE the columns: a spec table that scrolls inside
        // its frame on a phone, the label column pinned.
        <SpecTable label="Σύγκριση σεναρίων" stickyFirst>
          <thead>
            <tr>
              <Th>Μέγεθος</Th>
              {results.map(({ scenario }) => (
                <Th key={scenario.id} numeric>
                  <div className="flex items-center justify-end gap-2">
                    {scenario.name}
                    {scenario.is_base && <Badge>βάση</Badge>}
                  </div>
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <Tr key={row.label}>
                <th scope="row" className={`${TD_CLASS} text-left font-normal`}>
                  {row.label}
                </th>
                {results.map(({ scenario, result }) => (
                  <Td key={scenario.id} numeric strong>
                    {row.render(result)}
                  </Td>
                ))}
              </Tr>
            ))}
          </tbody>
        </SpecTable>
      )}
    </div>
  );
}
