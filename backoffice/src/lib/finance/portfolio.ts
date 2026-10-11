// Χαρτοφυλάκιο έργων (/reports/portfolio): the per-project rows and the
// portfolio totals, from v_project_rollup rows the page already read plus
// the IRR / lowest DSCR it could afford to compute. Pure, so tested
// (portfolio.test.ts).

import { formatMoney, formatPercent } from "@/lib/format";

const round2 = (n: number) => Math.round(n * 100) / 100;

export interface PortfolioRollupRow {
  project_id: string | null;
  display_name: string | null;
  code: string | null;
  business_line: string | null;
  status: string | null;
  total_budget: number | string | null;
  spent: number | string | null;
  remaining_budget: number | string | null;
  net_result: number | string | null;
}

export interface PortfolioRow {
  id: string;
  name: string;
  businessLine: string | null;
  status: string | null;
  budget: number;
  spent: number;
  remaining: number;
  result: number;
  // Capex paid + committed above the budget (remaining_budget < 0).
  overBudget: boolean;
  irr: number | null;
  minDscr: number | null;
}

export interface PortfolioTotals {
  budget: number;
  spent: number;
  // Spent on the projects that have a budget, for «Δαπανήθηκε %».
  spentBudgeted: number;
  spentShare: number | null;
  projects: number;
  overBudget: number;
  // IRR weighted by what was spent, over the projects that have one.
  weightedIrr: number | null;
}

// Every project except the cancelled ones, largest budget first.
export function portfolioRows(
  rollup: PortfolioRollupRow[],
  irr: Map<string, number | null> = new Map(),
  minDscr: Map<string, number | null> = new Map(),
): PortfolioRow[] {
  return rollup
    .filter((r): r is PortfolioRollupRow & { project_id: string } => !!r.project_id && r.status !== "cancelled")
    .map((r) => {
      const budget = round2(Number(r.total_budget ?? 0));
      const remaining = round2(Number(r.remaining_budget ?? 0));
      return {
        id: r.project_id,
        name: r.display_name?.trim() || r.code || "—",
        businessLine: r.business_line,
        status: r.status,
        budget,
        spent: round2(Number(r.spent ?? 0)),
        remaining,
        result: round2(Number(r.net_result ?? 0)),
        overBudget: budget > 0 && remaining < 0,
        irr: irr.get(r.project_id) ?? null,
        minDscr: minDscr.get(r.project_id) ?? null,
      };
    })
    .sort((a, b) => b.budget - a.budget || b.spent - a.spent || a.name.localeCompare(b.name, "el"));
}

export function portfolioTotals(rows: PortfolioRow[]): PortfolioTotals {
  let budget = 0;
  let spent = 0;
  let spentBudgeted = 0;
  let overBudget = 0;
  let irrWeight = 0;
  let irrSum = 0;
  for (const r of rows) {
    budget += r.budget;
    spent += r.spent;
    if (r.budget > 0) spentBudgeted += r.spent;
    if (r.overBudget) overBudget += 1;
    if (r.irr != null && Number.isFinite(r.irr) && r.spent > 0) {
      irrWeight += r.spent;
      irrSum += r.irr * r.spent;
    }
  }
  return {
    budget: round2(budget),
    spent: round2(spent),
    spentBudgeted: round2(spentBudgeted),
    spentShare: budget > 0 ? spentBudgeted / budget : null,
    projects: rows.length,
    overBudget,
    weightedIrr: irrWeight > 0 ? irrSum / irrWeight : null,
  };
}

// The chart: budget next to spent, one row per project with a budget or a
// spend. Spent sits in one of two stacked keys so an over-budget project's
// bar takes the negative tone while the others keep the accent.
export function portfolioChartRows(rows: PortfolioRow[]) {
  return rows
    .filter((r) => r.budget > 0 || r.spent > 0)
    .map((r) => ({
      label: r.name,
      budget: r.budget,
      spent: r.overBudget ? null : r.spent,
      spentOver: r.overBudget ? r.spent : null,
    }));
}

// The one sentence over the project page's «Με μια ματιά» figures.
export function projectHeadline({
  budget,
  spent,
  remaining,
  irr,
}: {
  budget: number | null; // null: no budget on file
  spent: number;
  remaining: number;
  irr: number | null;
}): string {
  const irrPart = irr != null && Number.isFinite(irr) ? ` · IRR ${formatPercent(irr)}` : "";
  if (budget == null || budget <= 0) return `Δαπανήθηκαν ${formatMoney(spent)} · χωρίς προϋπολογισμό${irrPart}.`;
  const share = formatPercent(spent / budget, { digits: 0 });
  const rest =
    remaining < 0
      ? `εκτός προϋπολογισμού κατά ${formatMoney(-remaining)}`
      : `απομένουν ${formatMoney(remaining)} από τον προϋπολογισμό`;
  return `Δαπανήθηκαν ${formatMoney(spent)} από ${formatMoney(budget)} (${share}) · ${rest}${irrPart}.`;
}
