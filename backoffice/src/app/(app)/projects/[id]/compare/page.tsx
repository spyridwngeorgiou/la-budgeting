import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { formatMoney } from "@/lib/format";
import { Badge, Button } from "@/components/ui";
import { computeLeaseSchedule } from "@/lib/finance/lease";
import { computeLoanSchedule } from "@/lib/finance/loan";
import { computeScenarioResult } from "@/lib/finance/scenarioResult";

// Side-by-side view of every scenario a project has, sharing the exact same
// Λειτουργία → Ταμειακή Ροή derivation as the single-scenario project page
// (see scenarioResult.ts) so the two views can never disagree on a number.
export default async function ProjectComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const [{ data: project }, { data: lease }, { data: loans }, { data: scenarios }] = await Promise.all([
    supabase
      .from("projects")
      .select("display_name, code, opening_date")
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("project_leases")
      .select(
        "kind, term_years, lease_start_month, lease_indexed_terms!lease_indexed_terms_lease_id_fkey(base_monthly_amount, stamp_duty_pct, stamp_duty_surcharge_pct, escalation_pct, escalation_first_year, stepups_escalate, stepups_stampable, lease_step_ups(from_lease_year, monthly_amount))",
      )
      .eq("project_id", id)
      .maybeSingle(),
    supabase
      .from("loans")
      .select("id, label, principal, interest_rate, term_years, grace_years, loan_drawdowns(scheduled_month, amount)")
      .eq("project_id", id),
    supabase
      .from("project_scenarios")
      .select(
        "id, name, is_base, sort_order, flat_annual_revenue, revenue_plan_id, revenue_growth_pct, opex_growth_pct, growth_starts_after_operating_year, discount_rate_pct, dscr_covenant_min, opex_lines(id, annual_amount, from_operating_year, to_operating_year)",
      )
      .eq("project_id", id)
      .order("sort_order"),
  ]);

  if (!project) notFound();

  const indexedTerms = Array.isArray(lease?.lease_indexed_terms)
    ? lease?.lease_indexed_terms[0]
    : lease?.lease_indexed_terms;

  const leaseSchedule =
    lease && indexedTerms
      ? computeLeaseSchedule(
          {
            baseMonthlyAmount: Number(indexedTerms.base_monthly_amount ?? 0),
            stampDutyPct: Number(indexedTerms.stamp_duty_pct ?? 0),
            stampDutySurchargePct: Number(indexedTerms.stamp_duty_surcharge_pct ?? 0),
            escalationPct: Number(indexedTerms.escalation_pct ?? 0),
            escalationFirstYear: Number(indexedTerms.escalation_first_year ?? 2),
            termYears: Number(lease.term_years ?? 1),
            stepUpsEscalate: Boolean(indexedTerms.stepups_escalate),
            stepUpsStampable: Boolean(indexedTerms.stepups_stampable),
          },
          ((indexedTerms.lease_step_ups ?? []) as { from_lease_year: number; monthly_amount: number }[]).map(
            (s) => ({ fromLeaseYear: Number(s.from_lease_year), monthlyAmount: Number(s.monthly_amount) }),
          ),
        )
      : null;

  const loanRows = loans ?? [];
  const programmeDrawdowns = new Map<string, number>();
  for (const l of loanRows) {
    for (const d of l.loan_drawdowns ?? []) {
      const month = `${String(d.scheduled_month).slice(0, 7)}-01`;
      programmeDrawdowns.set(month, (programmeDrawdowns.get(month) ?? 0) + Number(d.amount));
    }
  }
  const drawdownMonths = [...programmeDrawdowns.keys()].sort();
  const loanSchedule =
    loanRows.length > 0 && drawdownMonths.length > 0
      ? computeLoanSchedule(
          loanRows.map((l) => ({ id: l.id, label: l.label, principal: Number(l.principal), interestRate: Number(l.interest_rate) })),
          drawdownMonths.map((month) => ({ month, amount: programmeDrawdowns.get(month)! })),
          {
            firstMonth: drawdownMonths[0],
            termYears: Number(loanRows[0].term_years),
            graceYears: Number(loanRows[0].grace_years),
            openingMonth: project.opening_date ? `${String(project.opening_date).slice(0, 7)}-01` : undefined,
          },
        )
      : null;

  const ctx = {
    leaseSchedule,
    leaseStartMonth: lease?.lease_start_month ?? null,
    leaseTermYears: lease?.term_years ?? null,
    loanSchedule,
    openingDate: project.opening_date ?? null,
  };

  const results = await Promise.all(
    (scenarios ?? []).map(async (scenario) => ({
      scenario,
      result: await computeScenarioResult(supabase, scenario, ctx),
    })),
  );

  const rows: { label: string; render: (r: (typeof results)[number]["result"]) => React.ReactNode }[] = [
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
