import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/format";
import {
  dashboardPortfolio,
  figureLength,
  overviewGlance,
  pnlResult,
  upcomingObligations,
  vatNext,
  vatPosition,
  type DashboardRollupRow,
  type OpenTxRow,
  type OverviewInputs,
} from "./overview";

const base: OverviewInputs = {
  accounts: [
    { account_id: "a1", name: "Eurobank", current_balance: "1000" },
    { account_id: "a2", name: "Ταμείο", current_balance: 250 },
  ],
  lowest: { month: "2027-03-01", closing_balance: "400.5", below_buffer: false },
  year: 2026,
  pnlRows: [
    { line: "revenue", amount: "1000" },
    { line: "opex", amount: -300 },
    { line: "tax", amount: "-50.25" },
  ],
};

const tx = (id: string, due_date: string | null, extra: Partial<OpenTxRow> = {}): OpenTxRow => ({
  id,
  due_date,
  status: "scheduled",
  direction: "expense",
  gross_amount: 100,
  description: `Δόση ${id}`,
  counterparty_name: null,
  ...extra,
});

describe("upcomingObligations", () => {
  const today = "2026-10-13";
  it("keeps today through day 30, soonest first, signed", () => {
    const r = upcomingObligations(
      [
        tx("late", "2026-10-12"),
        tx("b", "2026-10-20"),
        tx("a", "2026-10-13", { direction: "income", gross_amount: "50" }),
        tx("edge", "2026-11-11"),
        tx("out", "2026-11-12"),
        tx("none", null),
      ],
      today,
    );
    expect(r.shown.map((x) => x.id)).toEqual(["a", "b", "edge"]);
    expect(r.shown[0].amount).toBe(50);
    expect(r.shown[1].amount).toBe(-100);
    expect([r.income, r.outflow, r.more]).toEqual([50, -200, 0]);
  });

  it("caps the list and counts the rest; falls back to the counterparty", () => {
    const rows = Array.from({ length: 10 }, (_, i) => tx(String(i), "2026-10-14", { description: i === 0 ? " " : `Δ${i}`, counterparty_name: "Αντισυμβαλλόμενος" }));
    const r = upcomingObligations(rows, today, 8);
    expect(r.shown).toHaveLength(8);
    expect(r.more).toBe(2);
    expect(r.shown[0].label).toBe("Αντισυμβαλλόμενος");
  });
});

describe("dashboardPortfolio", () => {
  const row = (id: string, extra: Partial<DashboardRollupRow>): DashboardRollupRow => ({
    project_id: id,
    display_name: `Έργο ${id}`,
    code: id,
    business_line: null,
    status: "active",
    total_budget: 0,
    spent: 0,
    remaining_budget: 0,
    net_result: 0,
    capex_paid: 0,
    capex_committed: 0,
    vat_on_expenses: 0,
    ...extra,
  });
  it("orders by budget, joins capex paid / committed and VAT, hides empty and cancelled projects", () => {
    const r = dashboardPortfolio([
      row("A", { total_budget: 100, spent: 40, capex_paid: 35, capex_committed: "5", remaining_budget: 60, vat_on_expenses: 9.6 }),
      row("B", { total_budget: 500, spent: 600, capex_paid: 600, remaining_budget: -100 }),
      row("C", {}),
      row("D", { capex_committed: 10 }),
      row("E", { total_budget: 900, status: "cancelled" }),
    ]);
    expect(r.shown.map((p) => p.id)).toEqual(["B", "A", "D"]);
    expect(r.shown[0].overBudget).toBe(true);
    expect([r.shown[1].paid, r.shown[1].committed, r.shown[1].vat]).toEqual([35, 5, 9.6]);
    expect(r.shown[2].budget).toBeNull();
    expect([r.shown[0].remaining, r.shown[2].remaining]).toEqual([-100, null]);
  });

  it("the figures are the budget's: budget − paid − committed = remaining; non-capex spend alone is not listed", () => {
    const r = dashboardPortfolio([
      row("A", { total_budget: 100, spent: 70, capex_paid: 30, capex_committed: 20, remaining_budget: 50 }),
      // Rent only (paid, not capex): nothing against a budget.
      row("R", { spent: 25 }),
    ]);
    const [a] = r.shown;
    expect(r.shown.map((p) => p.id)).toEqual(["A"]);
    expect((a.budget ?? 0) - a.paid - a.committed).toBe(a.remaining);
  });

  it("caps and counts the rest", () => {
    const rows = Array.from({ length: 11 }, (_, i) => row(`P${i}`, { total_budget: i + 1 }));
    const r = dashboardPortfolio(rows, 8);
    expect([r.shown.length, r.more]).toEqual([8, 3]);
  });
});

describe("vatNext", () => {
  const today = "2026-10-13";
  const rows = [
    { period_start: "2026-08-01", payable_after_credit: 10, credit_balance: 0, filing_deadline: "2026-09-30" },
    { period_start: "2026-09-01", payable_after_credit: "240", credit_balance: 0, filing_deadline: "2026-10-31" },
    { period_start: "2026-10-01", payable_after_credit: 0, credit_balance: -40, filing_deadline: "2026-11-30" },
  ];
  it("the next unfiled deadline and its payable", () => {
    const v = vatNext(rows, new Set(), today);
    expect(v.payable).toBe(240);
    expect(v.sub).toContain("31/10/2026");
  });
  it("skips filed periods; a period with nothing to pay still has a deadline", () => {
    const v = vatNext(rows, new Set(["2026-09-01"]), today);
    expect(v.payable).toBe(0);
    expect(v.sub).toMatch(/χωρίς πληρωμή$/);
  });
  it("without a deadline ahead, the credit", () => {
    expect(vatNext(rows, new Set(["2026-09-01", "2026-10-01"]), today)).toEqual({ payable: 0, sub: `Καμία προθεσμία · πιστωτικό ${formatMoney(40)}` });
    expect(vatNext([], new Set(), today).sub).toBe("Καμία προθεσμία σε εκκρεμότητα");
  });
});

describe("overviewGlance", () => {
  it("one figure per account, each to its transactions, then the total", () => {
    expect(overviewGlance(base).figures.map((f) => [f.label, f.value, f.href, f.total])).toEqual([
      ["Eurobank", formatMoney(1000), "/transactions?account_id=a1", false],
      ["Ταμείο", formatMoney(250), "/transactions?account_id=a2", false],
      ["Σύνολο ρευστών", formatMoney(1250), "/accounts", true],
    ]);
  });

  it("hides a closed account only while it is empty; the total still counts it", () => {
    const g = overviewGlance({
      ...base,
      accounts: [...base.accounts, { account_id: "a3", name: "Κλειστός", current_balance: 0, active: false }, { account_id: "a4", name: "Παλιός", current_balance: -5, active: false }],
    });
    expect(g.figures.map((f) => f.label)).toEqual(["Eurobank", "Ταμείο", "Παλιός", "Σύνολο ρευστών"]);
    expect(g.figures.at(-1)!.value).toBe(formatMoney(1245));
    expect(g.figures.find((f) => f.label === "Παλιός")!.negative).toBe(true);
  });

  it("the small line: the 12-month low and the year's result", () => {
    const g = overviewGlance(base);
    expect(g.lowest.value).toBe(formatMoney(400.5));
    expect(g.lowest.sub).toContain("2027");
    expect(g.lowest.href).toBe("/reports/cash?month=2027-03");
    expect(g.pnl.value).toBe(formatMoney(649.75));
    expect(g.pnl.label).toBe("Αποτέλεσμα 2026 ως σήμερα");
    expect(g.lowest.negative || g.pnl.negative).toBe(false);
  });

  it("names the low point's driver", () => {
    const g = overviewGlance({ ...base, lowestDriver: { label: "Κατασκευή — φάση Α", amount: "690558" } });
    expect(g.lowest.sub).toContain(`κυρίως: Κατασκευή — φάση Α −${formatMoney(690558)}`);
    expect(overviewGlance({ ...base, lowestDriver: null }).lowest.sub).not.toContain("κυρίως");
  });

  it("flags a forecast below the buffer and a negative result; handles no forecast", () => {
    const g = overviewGlance({ ...base, lowest: { month: "2026-12-01", closing_balance: 50, below_buffer: true }, pnlRows: [{ line: "opex", amount: -10 }] });
    expect(g.lowest.negative).toBe(true);
    expect(g.pnl.negative).toBe(true);
    const none = overviewGlance({ ...base, lowest: null }).lowest;
    expect(none.value).toBe("—");
    expect(none.href).toBe("/reports/cash");
  });

  it("steps long figures down", () => {
    expect(figureLength(formatMoney(1250))).toBe(1);
    expect(figureLength(formatMoney(123456.78))).toBe(2);
    expect(figureLength(formatMoney(-1234567.89))).toBe(3);
    const big = overviewGlance({ ...base, accounts: [{ account_id: "a1", name: "Eurobank", current_balance: 2_500_000 }] });
    expect(big.figures.map((f) => f.length)).toEqual([3, 3]);
  });
});

describe("vatPosition", () => {
  it("sums output/input over every period; credit and owed from the latest", () => {
    expect(
      vatPosition([
        { period_start: "2026-09-01", vat_income: "100", vat_expense: 40, credit_balance: "-25.5", payable_after_credit: 0 },
        { period_start: "2026-08-01", vat_income: 50, vat_expense: "200", credit_balance: -90, payable_after_credit: 0 },
      ]),
    ).toEqual({ output: 150, input: 240, credit: 25.5, owed: 0, from: "2026-08-01" });
    expect(vatPosition([])).toBeNull();
  });
});

describe("pnlResult", () => {
  it("sums the P&L lines like the report's result row, ignoring unknown lines", () => {
    expect(pnlResult([{ line: "revenue", amount: "10.10" }, { line: "rent", amount: "-0.05" }, { line: "bogus", amount: 999 }])).toBe(10.05);
    expect(pnlResult([{ line: "revenue", amount: null }])).toBe(0);
  });
});
