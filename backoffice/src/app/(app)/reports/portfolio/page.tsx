import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAccessContext } from "@/lib/supabase/access";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { formatMoney, formatMultiple, formatPercent, moneyOrDash } from "@/lib/format";
import { addMonths, currentMonthKey, firstOfMonth, lastOfMonth, monthKeyOf, monthLabel, todayAthens } from "@/lib/dates";
import { change, contributors, latestUpTo, sumParts, topMovements, vsTarget, whyText, type Part } from "@/lib/finance/insights";
import { ChangePanel, KpiLink, TargetPanel, TopMovements } from "../Insights";

import { el } from "@/lib/i18n/el";
import { portfolioNarrative } from "@/lib/finance/narratives";
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
  ReportDetail,
  ReportFooter,
  ReportHeadline,
  ReportMethod,
  ReportSection,
  SUB_CLASS,
  SpecTable,
  Td,
  Th,
  Tr,
} from "@/components/ui";
import { BarChart } from "@/components/ui/BarChart";

// «Πώς πάνε οι επενδύσεις;» -- every project from v_project_rollup (budget,
// spent, remaining, result), plus what the project page shows as «IRR έργου»
// and the lowest DSCR of the base scenario. Those two need each project's
// flows / scenario, so on the Workers free plan (≈10 ms CPU, 50
// subrequests) they are computed only for the largest projects (IRR_MAX) and
// the projects with loans (DSCR_MAX); the rest show «—».
const IRR_MAX = 12;
const round2 = (n: number) => Math.round(n * 100) / 100;
const DSCR_MAX = 3;

const TITLE = "Χαρτοφυλάκιο έργων";

export default async function PortfolioPage() {
  const supabase = await createClient();
  const access = await getAccessContext();
  const orgId = access.kind === "internal" ? access.membership.orgId : await getCurrentOrgId(supabase);
  const today = todayAthens();

  // «Τι άλλαξε»: the project spending of the last complete month against
  // the month before and the same month last year -- the one extra query.
  const focusMonth = addMonths(currentMonthKey(), -1);
  const compareMonths = [focusMonth, addMonths(focusMonth, -1), addMonths(focusMonth, -12)];
  const [{ data: rollup, error }, { data: loans }, { data: spendRows }] = await Promise.all([
    supabase
      .from("v_project_rollup")
      .select("project_id, display_name, code, business_line, status, total_budget, spent, remaining_budget, net_result")
      .eq("org_id", orgId),
    supabase.from("loans").select("project_id").eq("org_id", orgId).not("project_id", "is", null),
    supabase
      .from("transactions")
      .select("id, paid_on, project_id, gross_amount, description, counterparty_name")
      .eq("org_id", orgId)
      .eq("direction", "expense")
      .eq("status", "paid")
      .not("project_id", "is", null)
      .or(compareMonths.map((m) => `and(paid_on.gte.${firstOfMonth(m)},paid_on.lte.${lastOfMonth(m)})`).join(",")),
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

  // Insights from the month rows: per project, per month.
  const nameOf = new Map(rows.map((r) => [r.id, r.name]));
  const spendIn = (m: string): Part[] =>
    (spendRows ?? [])
      .filter((r) => r.paid_on && monthKeyOf(r.paid_on) === m)
      .map((r) => ({ key: r.project_id ?? "", label: nameOf.get(r.project_id ?? "") ?? "—", amount: Number(r.gross_amount ?? 0) }));
  const focusParts = spendIn(focusMonth);
  const changes = compareMonths.slice(1).map((m) => {
    const other = spendIn(m);
    return {
      label: `Δαπάνες έργων ${monthLabel(focusMonth)} έναντι ${monthLabel(m)}`,
      change: change(sumParts(focusParts), sumParts(other)),
      why: whyText(contributors(focusParts, other)),
      href: `/transactions?direction=expense&status=paid&from=${firstOfMonth(focusMonth)}&to=${lastOfMonth(focusMonth)}`,
    };
  });
  const topMoves = topMovements(
    (spendRows ?? [])
      .filter((r) => r.paid_on && monthKeyOf(r.paid_on) === focusMonth)
      .map((r) => ({
        id: r.id,
        date: r.paid_on,
        label: `${r.counterparty_name?.trim() || r.description?.trim() || "—"} · ${nameOf.get(r.project_id ?? "") ?? "—"}`,
        amount: Number(r.gross_amount ?? 0),
      })),
  );
  const coverage = latestUpTo((spendRows ?? []).map((r) => r.paid_on), today);
  // Σε σχέση με τον στόχο: the budget left and the overrun.
  const budgeted = rows.filter((r) => r.budget > 0);
  const remainingLeft = round2(budgeted.reduce((s, r) => s + Math.max(0, r.remaining), 0));
  const overrun = round2(budgeted.reduce((s, r) => s + Math.max(0, -r.remaining), 0));
  const worst = budgeted.filter((r) => r.remaining < 0).sort((a, b) => a.remaining - b.remaining)[0] ?? null;
  const spentVsBudget = vsTarget(totals.spentBudgeted, totals.budget);

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <PageHeader title={TITLE} />

      {rows.length === 0 ? (
        <p className="border-y border-hairline py-6 text-body text-muted">Δεν υπάρχουν ακόμα έργα.</p>
      ) : (
        <ReportSection label={TITLE}>
          <ReportHeadline>
            {portfolioNarrative({
              budget: totals.budget,
              spent: totals.spentBudgeted,
              projects: rows.filter((r) => r.budget > 0).length,
              overBudget: totals.overBudget,
            })}
          </ReportHeadline>
          <KpiBand
            items={[
              {
                label: "Συνολική επένδυση",
                value: <KpiLink href="/projects">{formatMoney(totals.budget)}</KpiLink>,
                sub: `${rows.filter((r) => r.budget > 0).length} έργα με προϋπολογισμό`,
              },
              {
                label: "Δαπανήθηκε",
                value: totals.spentShare == null ? "—" : formatPercent(totals.spentShare, { digits: 0 }),
                sub: formatMoney(totals.spentBudgeted),
              },
              {
                label: "Εκτός προϋπολογισμού",
                value: <span className={totals.overBudget > 0 ? "text-negative" : undefined}>{totals.overBudget}</span>,
                sub: totals.overBudget === 1 ? "έργο" : "έργα",
              },
              ...(totals.weightedIrr != null
                ? [{ label: "Μέσο IRR", value: formatPercent(totals.weightedIrr), sub: "σταθμισμένο με τα δαπανηθέντα" }]
                : []),
            ]}
          />
          <ChangePanel items={changes} coverage={coverage} />
          {budgeted.length > 0 && (
            <TargetPanel
              caption="Τα έργα με προϋπολογισμό"
              items={[
                {
                  label: "Δαπανήθηκε έναντι προϋπολογισμού",
                  value: spentVsBudget.share == null ? "—" : formatPercent(spentVsBudget.share, { digits: 0 }),
                  sub: `${formatMoney(totals.spentBudgeted)} από ${formatMoney(totals.budget)}`,
                },
                { label: "Υπόλοιπο προϋπολογισμού", value: formatMoney(remainingLeft), sub: "δεν έχει δαπανηθεί ή δεσμευτεί" },
                {
                  label: "Υπέρβαση",
                  value: <span className={overrun > 0 ? "text-negative" : undefined}>{formatMoney(overrun)}</span>,
                  sub: worst ? (
                    <Link href={`/projects/${worst.id}`} className={LINK_CLASS}>
                      μεγαλύτερη: {worst.name}
                    </Link>
                  ) : (
                    "κανένα έργο εκτός"
                  ),
                },
              ]}
            />
          )}
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
          <TopMovements rows={topMoves} caption={`πληρωμένες δαπάνες έργων, ${monthLabel(focusMonth)}`} />
          <ReportDetail title="Ανά έργο" meta={`${rows.length} έργα`}>
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
          </ReportDetail>
          <ReportMethod>
            <p>
              Όλα τα έργα εκτός των ακυρωμένων. Επένδυση: ο τρέχων προϋπολογισμός του έργου. Δαπανήθηκε: οι πληρωμένες δαπάνες
              του έργου. Υπόλοιπο: ο προϋπολογισμός μείον τις κεφαλαιουχικές δαπάνες, πληρωμένες και δεσμευμένες· όταν είναι
              αρνητικό, το έργο είναι εκτός προϋπολογισμού. Αποτέλεσμα: το αποτέλεσμα του έργου μέχρι σήμερα (πληρωμένες και
              εκκρεμείς κινήσεις, χωρίς ΦΠΑ).
            </p>
            <p>
              IRR: όπως στη σελίδα του έργου — όλες οι ροές του χωρίς ΦΠΑ και πριν τη χρηματοδότηση, μαζί με τον προϋπολογισμό
              που δεν έχει δεσμευτεί ακόμα· υπολογίζεται για τα {IRR_MAX} μεγαλύτερα έργα. Το μέσο IRR σταθμίζεται με τα
              δαπανηθέντα. DSCR ελάχ.: ο χαμηλότερος ετήσιος δείκτης κάλυψης χρέους του βασικού σεναρίου, για έργα με δάνειο.
              Όπου δεν υπάρχει αρκετή πληροφορία εμφανίζεται «—».
            </p>
            <p className={SUB_CLASS}>Αναλυτικά για κάθε έργο: η σελίδα του έργου.</p>
          </ReportMethod>
          <ReportFooter dataUntil={coverage ?? today} />
        </ReportSection>
      )}
    </div>
  );
}
