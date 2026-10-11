import { describe, expect, it } from "vitest";
import { portfolioChartRows, portfolioRows, portfolioTotals, projectHeadline, type PortfolioRollupRow } from "./portfolio";

const row = (p: Partial<PortfolioRollupRow> & { project_id: string }): PortfolioRollupRow => ({
  display_name: p.project_id,
  code: null,
  business_line: "hospitality",
  status: "active",
  total_budget: 0,
  spent: 0,
  remaining_budget: 0,
  net_result: 0,
  ...p,
});

const rollup = [
  row({ project_id: "a", total_budget: 1000, spent: "400", remaining_budget: 600, net_result: -400 }),
  row({ project_id: "b", total_budget: "2000", spent: 2500, remaining_budget: -500 }),
  row({ project_id: "c", spent: 100 }),
  row({ project_id: "x", status: "cancelled", total_budget: 9999 }),
];

describe("portfolioRows", () => {
  it("drops cancelled projects, sorts by budget, flags over budget", () => {
    const rows = portfolioRows(rollup, new Map([["a", 0.12]]), new Map([["b", 1.4]]));
    expect(rows.map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(rows[0]).toMatchObject({ overBudget: true, minDscr: 1.4, irr: null });
    expect(rows[1]).toMatchObject({ overBudget: false, irr: 0.12, result: -400, spent: 400 });
  });
});

describe("portfolioTotals", () => {
  it("sums, counts over-budget projects and weights IRR by spend", () => {
    const rows = portfolioRows(rollup, new Map([["a", 0.1], ["b", 0.2]]));
    const t = portfolioTotals(rows);
    expect(t).toMatchObject({ budget: 3000, spent: 3000, spentBudgeted: 2900, projects: 3, overBudget: 1 });
    expect(t.spentShare).toBeCloseTo(2900 / 3000);
    expect(t.weightedIrr).toBeCloseTo((0.1 * 400 + 0.2 * 2500) / 2900);
  });

  it("no budget and no IRR give nulls", () => {
    const t = portfolioTotals(portfolioRows([row({ project_id: "c", spent: 10 })]));
    expect(t.spentShare).toBeNull();
    expect(t.weightedIrr).toBeNull();
  });
});

describe("projectHeadline", () => {
  it("spent of budget, what is left, the IRR", () => {
    const s = projectHeadline({ budget: 1000, spent: 400, remaining: 600, irr: 0.12 });
    expect(s).toContain("Δαπανήθηκαν");
    expect(s).toContain("(40%)");
    expect(s).toContain("απομένουν");
    expect(s).toContain("IRR 12%");
  });

  it("over budget, and no budget", () => {
    expect(projectHeadline({ budget: 1000, spent: 900, remaining: -200, irr: null })).toContain("εκτός προϋπολογισμού κατά");
    expect(projectHeadline({ budget: null, spent: 50, remaining: 0, irr: null })).toContain("χωρίς προϋπολογισμό");
  });
});

describe("portfolioChartRows", () => {
  it("puts an over-budget spend in its own key", () => {
    expect(portfolioChartRows(portfolioRows(rollup))).toEqual([
      { label: "b", budget: 2000, spent: null, spentOver: 2500 },
      { label: "a", budget: 1000, spent: 400, spentOver: null },
      { label: "c", budget: 0, spent: 100, spentOver: null },
    ]);
  });
});
