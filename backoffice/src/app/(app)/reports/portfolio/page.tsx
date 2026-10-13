import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/supabase/access";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney, formatMultiple, formatPercent, moneyOrDash } from "@/lib/format";
import { addMonths, currentMonthKey, firstOfMonth, lastOfMonth, monthKeyOf, monthLabel, todayAthens } from "@/lib/dates";
import { change, latestUpTo, vsPrevText } from "@/lib/finance/insights";
import { KpiLink, reportIssues } from "../Insights";

import { el } from "@/lib/i18n/el";
import { computeDevelopmentResult } from "@/lib/finance/development";
import { computeScenarioFromInputs, loadProjectFlows, loadScenarioInputs } from "@/lib/finance/projectModel";
import { portfolioChartRows, portfolioRows, portfolioTotals } from "@/lib/finance/portfolio";
import type { ProjectStatus } from "@/lib/domain/enums";
import {
  Badge,
  KpiBand,
  LINK_CLASS,
  PageHeader,
  ReportChart,
  ReportFooter,
  ReportHistory,
  ReportSection,
  SpecTable,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { BarChart } from "@/components/ui/BarChart";

// «Πώς πάνε οι επενδύσεις;» -- every project from v_project_rollup (budget,
// spent, pending, VAT, remaining, result), plus what the project page shows
// as «IRR έργου» and the lowest DSCR of the base scenario. Those two need
// each project's flows / scenario, so on the Workers free plan (≈10 ms CPU,
// 50 subrequests) they are computed only for the largest projects (IRR_MAX)
// and the projects with loans (DSCR_MAX); the rest show «—». The project
// spending of the last two complete months is the one extra query (the
// «± έναντι προηγ. μήνα» under «Δαπανήθηκε»).
const IRR_MAX = 12;
const round2 = (n: number) => Math.round(n * 100) / 100;
const DSCR_MAX = 3;

const TITLE = "Χαρτοφυλάκιο έργων";
const META = `Πώς πάνε οι επενδύσεις; Προϋπολογισμός, πληρωμένες δαπάνες και αποτέλεσμα κάθε έργου εκτός των ακυρωμένων· IRR όπως στη σελίδα του έργου, για τα ${IRR_MAX} μεγαλύτερα.`;

export default async function PortfolioPage() {
  const supabase = await createClient();
  const access = await getAccessContext();
  const orgId = access.kind === "internal" ? access.membership.orgId : await getCurrentOrgId(supabase);
  const today = todayAthens();

  const focusMonth = addMonths(currentMonthKey(), -1);
  const prevMonth = addMonths(focusMonth, -1);
  const [{ data: rollup, error }, { data: loans }, { data: spendRows }, issues] = await Promise.all([
    supabase
      .from("v_project_rollup")
      .select("project_id, display_name, code, business_line, status, total_budget, spent, remaining_budget, net_result, pending, vat_on_expenses")
      .eq("org_id", orgId),
    supabase.from("loans").select("project_id").eq("org_id", orgId).not("project_id", "is", null),
    supabase
      .from("transactions")
      .select("paid_on, gross_amount")
      .eq("org_id", orgId)
      .eq("direction", "expense")
      .eq("status", "paid")
      .not("project_id", "is", null)
      .gte("paid_on", firstOfMonth(prevMonth))
      .lte("paid_on", lastOfMonth(focusMonth)),
    reportIssues(supabase, orgId, "portfolio"),
  ]);
  if (error) throw error;

  const base = portfolioRows(rollup ?? []);
  const irrIds = base.filter((r) => r.budget > 0 || r.spent > 0).slice(0, IRR_MAX);
  const loanIds = [...new Set((loans ?? []).map((l) => l.project_id).filter((x): x is string => !!x))]
    .filter((id) => base.some((r) => r.id === id))
    .slice(0, DSCR_MAX);

  const [irrPairs, dscrPairs] = await Promise.all([
    Promise.all(
      irrIds.map(async (r): Promise<[string, number | null]> => {
        try {
          const { flows } = await loadProjectFlows(supabase, r.id, today);
          const result = computeDevelopmentResult(flows, { today, remainingBudget: r.budget > 0 ? Math.max(0, r.remaining) : 0 });
          return [r.id, result.irr];
        } catch {
          return [r.id, null];
        }
      }),
    ),
    Promise.all(
      loanIds.map(async (id): Promise<[string, number | null]> => {
        try {
          const inputs = await loadScenarioInputs(supabase, id, { baseOnly: true });
          const scenario = inputs?.scenarios[0];
          if (!inputs || !scenario) return [id, null];
          return [id, computeScenarioFromInputs(inputs, scenario).cashflow?.kpis.minDscr?.value ?? null];
        } catch {
          return [id, null];
        }
      }),
    ),
  ]);

  const rows = portfolioRows(rollup ?? [], new Map(irrPairs), new Map(dscrPairs));
  const totals = portfolioTotals(rows);
  const chart = portfolioChartRows(rows);
  const lines = el.reports.businessLines as Record<string, string>;
  const counted = new Set(rows.map((r) => r.id));
  const live = (rollup ?? []).filter((r) => r.project_id && counted.has(r.project_id));
  const pending = round2(live.reduce((s, r) => s + Number(r.pending ?? 0), 0));
  const vat = round2(live.reduce((s, r) => s + Number(r.vat_on_expenses ?? 0), 0));

  // The project spending of the last complete month against the one before.
  const spendIn = (m: string) =>
    (spendRows ?? []).filter((r) => r.paid_on && monthKeyOf(r.paid_on) === m).reduce((s, r) => s + Number(r.gross_amount ?? 0), 0);
  const spentVsPrev = vsPrevText(change(spendIn(focusMonth), spendIn(prevMonth)));
  const coverage = latestUpTo((spendRows ?? []).map((r) => r.paid_on), today);
  const budgeted = rows.filter((r) => r.budget > 0);
  const remainingLeft = round2(budgeted.reduce((s, r) => s + Math.max(0, r.remaining), 0));
  const overrun = round2(budgeted.reduce((s, r) => s + Math.max(0, -r.remaining), 0));

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <PageHeader title={TITLE} meta={META} />

      {rows.length === 0 ? (
        <p className="border-y border-hairline py-6 text-body text-muted">Δεν υπάρχουν ακόμα έργα.</p>
      ) : (
        <ReportSection label={TITLE}>
          <KpiBand
            items={[
              {
                label: "Προϋπολογισμός",
                value: <KpiLink href="/projects">{formatMoney(totals.budget)}</KpiLink>,
                sub: (
                  <>
                    {`${budgeted.length} έργα · υπόλοιπο ${formatMoney(remainingLeft)}`}
                    {totals.overBudget > 0 && (
                      <span className="block text-negative">
                        {`${totals.overBudget} ${totals.overBudget === 1 ? "έργο" : "έργα"} εκτός · υπέρβαση ${formatMoney(overrun)}`}
                      </span>
                    )}
                  </>
                ),
              },
              {
                label: "Δαπανήθηκε",
                value: formatMoney(totals.spentBudgeted),
                sub: (
                  <>
                    {totals.spentShare == null ? "χωρίς προϋπολογισμό" : `${formatPercent(totals.spentShare, { digits: 0 })} του προϋπολογισμού`}
                    {totals.weightedIrr != null && ` · μέσο IRR ${formatPercent(totals.weightedIrr)}`}
                    {spentVsPrev && <span className="block">{`${monthLabel(focusMonth)}: ${spentVsPrev}`}</span>}
                  </>
                ),
              },
              {
                label: "Εκκρεμή",
                value: <KpiLink href="/transactions?status=pending&direction=expense">{formatMoney(pending)}</KpiLink>,
                sub: "απλήρωτες δαπάνες έργων",
              },
              { label: "ΦΠΑ", value: formatMoney(vat), sub: "ΦΠΑ στις δαπάνες των έργων" },
            ]}
          />
          {chart.length > 0 && (
            <ReportChart title="Προϋπολογισμός έναντι δαπανηθέντων" caption="Ανά έργο · σημειωμένα όσα είναι εκτός προϋπολογισμού">
              <BarChart
                data={chart}
                xKey="label"
                layout="rows"
                label="Προϋπολογισμός έναντι δαπανηθέντων ανά έργο"
                series={[
                  { key: "budget", name: "Προϋπολογισμός", tone: "navy" },
                  { key: "spent", name: "Δαπανήθηκε", tone: "accent", stack: "spent" },
                  { key: "spentOver", name: "Δαπανήθηκε · εκτός προϋπολογισμού", tone: "negative", stack: "spent" },
                ]}
              />
            </ReportChart>
          )}
          <ReportHistory title="Ανά έργο" count={rows.length}>
            <SpecTable label={TITLE} stickyFirst>
              <thead>
                <tr>
                  <Th>Έργο</Th>
                  <Th>Κλάδος</Th>
                  <Th>Κατάσταση</Th>
                  <Th numeric>Επένδυση</Th>
                  <Th numeric>Δαπανήθηκε</Th>
                  <Th numeric>Υπόλοιπο</Th>
                  <Th numeric>Αποτέλεσμα</Th>
                  <Th numeric>IRR</Th>
                  <Th numeric>DSCR ελάχ.</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.id}>
                    <Td strong className="min-w-40">
                      <Link href={`/projects/${r.id}`} className={LINK_CLASS}>
                        {r.name}
                      </Link>
                      {r.overBudget && (
                        <span className="ml-1.5">
                          <Badge tone="negative">εκτός</Badge>
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap">{r.businessLine ? (lines[r.businessLine] ?? r.businessLine) : "—"}</Td>
                    <Td className="whitespace-nowrap">{r.status ? el.project.statusValues[r.status as ProjectStatus] : "—"}</Td>
                    <Td numeric>{r.budget > 0 ? formatMoney(r.budget) : "—"}</Td>
                    <Td numeric>{moneyOrDash(r.spent)}</Td>
                    <Td numeric className={r.remaining < 0 ? "text-negative" : undefined}>
                      {r.budget > 0 ? formatMoney(r.remaining) : "—"}
                    </Td>
                    <Td numeric className={r.result < 0 ? "text-negative" : undefined}>
                      {moneyOrDash(r.result)}
                    </Td>
                    <Td numeric>{r.irr == null ? "—" : formatPercent(r.irr)}</Td>
                    <Td numeric>{formatMultiple(r.minDscr)}</Td>
                  </Tr>
                ))}
              </tbody>
              <tfoot>
                <Tr total>
                  <Td strong>Σύνολο</Td>
                  <Td />
                  <Td />
                  <Td numeric strong>
                    {formatMoney(totals.budget)}
                  </Td>
                  <Td numeric strong>
                    {formatMoney(totals.spent)}
                  </Td>
                  <Td numeric strong>
                    {formatMoney(rows.reduce((s, r) => s + (r.budget > 0 ? r.remaining : 0), 0))}
                  </Td>
                  <Td numeric strong>
                    {formatMoney(rows.reduce((s, r) => s + r.result, 0))}
                  </Td>
                  <Td numeric strong>
                    {totals.weightedIrr == null ? "—" : formatPercent(totals.weightedIrr)}
                  </Td>
                  <Td />
                </Tr>
              </tfoot>
            </SpecTable>
            <p className="max-w-3xl text-small text-muted">
              Υπόλοιπο: ο προϋπολογισμός μείον τις κεφαλαιουχικές δαπάνες, πληρωμένες και δεσμευμένες· αρνητικό = εκτός
              προϋπολογισμού. Αποτέλεσμα: πληρωμένες και εκκρεμείς κινήσεις, χωρίς ΦΠΑ. DSCR ελάχ.: ο χαμηλότερος ετήσιος δείκτης
              κάλυψης χρέους του βασικού σεναρίου, για έργα με δάνειο.
            </p>
          </ReportHistory>
          <ReportFooter dataUntil={coverage ?? today} issues={issues} />
        </ReportSection>
      )}
    </div>
  );
}
