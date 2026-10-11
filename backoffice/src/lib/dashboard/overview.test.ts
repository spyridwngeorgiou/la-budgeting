import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/format";
import { figureLength, overviewCards, overviewGlance, pnlResult, type OverviewInputs } from "./overview";

const base: OverviewInputs = {
  cashCorporate: 1000,
  cashPersonal: 250,
  lowest: { month: "2027-03-01", closing_balance: "400.5", below_buffer: false },
  year: 2026,
  pnlRows: [
    { line: "revenue", amount: "1000" },
    { line: "opex", amount: -300 },
    { line: "tax", amount: "-50.25" },
  ],
  vatPayable: 120,
  canReview: true,
  inboxPending: 0,
  overdue: 0,
  pending: 3,
  accounts: 6,
  accountDrift: 0,
  activeProjects: 8,
  overBudgetProjects: 0,
  openTasks: 12,
  calendarNext7: 5,
  contacts: 37,
};

const glance = (i: OverviewInputs) => Object.fromEntries(overviewGlance(i).map((f) => [f.key, f]));
const cards = (i: OverviewInputs) => Object.fromEntries(overviewCards(i).map((c) => [c.key, c]));

describe("overviewGlance", () => {
  it("returns the four figures with their links", () => {
    expect(overviewGlance(base).map((f) => [f.key, f.href])).toEqual([
      ["cash", "/accounts"],
      ["lowest", "/reports/cash?month=2027-03"],
      ["pnl", "/reports/pnl"],
      ["vat", "/reports/vat"],
    ]);
  });

  it("formats each figure", () => {
    const g = glance(base);
    expect(g.cash.value).toBe(formatMoney(1250));
    expect(g.cash.sub).toBe(`Εταιρικό ${formatMoney(1000)} · Προσωπικό ${formatMoney(250)}`);
    expect(g.lowest.value).toBe(formatMoney(400.5));
    expect(g.lowest.sub).toContain("2027");
    expect(g.pnl.value).toBe(formatMoney(649.75));
    expect(g.vat.value).toBe(formatMoney(120));
    expect(Object.values(g).some((f) => f.negative)).toBe(false);
  });

  it("names the low point's driver", () => {
    const g = glance({ ...base, lowestDriver: { label: "Κατασκευή — φάση Α", amount: "690558" } });
    expect(g.lowest.sub).toContain(`κυρίως: Κατασκευή — φάση Α −${formatMoney(690558)}`);
    expect(glance({ ...base, lowestDriver: null }).lowest.sub).not.toContain("κυρίως");
  });

  it("flags a forecast below the buffer and a negative result; handles no forecast", () => {
    const g = glance({ ...base, lowest: { month: "2026-12-01", closing_balance: 50, below_buffer: true }, pnlRows: [{ line: "opex", amount: -10 }] });
    expect(g.lowest.negative).toBe(true);
    expect(g.pnl.negative).toBe(true);
    const none = glance({ ...base, lowest: null });
    expect(none.lowest.value).toBe("—");
    expect(none.lowest.sub).toBe("Χωρίς πρόβλεψη");
    expect(none.lowest.href).toBe("/reports/cash");
  });

  it("steps long figures down", () => {
    expect(figureLength(formatMoney(1250))).toBe(1);
    expect(figureLength(formatMoney(123456.78))).toBe(2);
    expect(figureLength(formatMoney(-1234567.89))).toBe(3);
    expect(glance({ ...base, cashCorporate: 2_500_000 }).cash.length).toBe(3);
  });
});

describe("overviewCards", () => {
  it("follows the menu order and links each section", () => {
    expect(overviewCards(base).map((c) => c.href)).toEqual([
      "/inbox",
      "/assistant",
      "/transactions",
      "/accounts",
      "/reports",
      "/projects",
      "/planner",
      "/calendar",
      "/contacts",
    ]);
    for (const c of overviewCards(base)) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.description.length).toBeGreaterThan(0);
      expect(c.metric.length).toBeGreaterThan(0);
    }
  });

  it("hides Εισερχόμενα from viewers", () => {
    expect(overviewCards({ ...base, canReview: false }).map((c) => c.key)).not.toContain("inbox");
  });

  it("writes the quiet metrics", () => {
    const c = cards(base);
    expect(c.inbox.metric).toBe("Τίποτα προς έλεγχο");
    expect(c.transactions.metric).toBe("3 εκκρεμείς");
    expect(c.accounts.metric).toBe("6 λογαριασμοί");
    expect(c.reports.metric).toBe(`Αποτέλεσμα +${formatMoney(649.75)}`);
    expect(c.projects.metric).toBe("8 ενεργά");
    expect(c.planner.metric).toBe("12 ανοιχτές εργασίες");
    expect(c.calendar.metric).toBe("5 τις επόμενες 7 ημέρες");
    expect(c.contacts.metric).toBe("37 επαφές");
    expect(c.assistant.metric).toBe("Ρωτήστε οτιδήποτε");
    expect(Object.values(c).every((x) => x.severity === null)).toBe(true);
  });

  it("flags exceptions with a severity", () => {
    const c = cards({ ...base, inboxPending: 4, overdue: 11, accountDrift: 1, overBudgetProjects: 1, openTasks: 1, contacts: 1, accounts: 1 });
    expect([c.inbox.metric, c.inbox.severity]).toEqual(["4 προς έλεγχο", "attention"]);
    expect([c.transactions.metric, c.transactions.severity]).toEqual(["11 ληξιπρόθεσμες", "urgent"]);
    expect([c.accounts.metric, c.accounts.severity]).toEqual(["1 λογαριασμός · 1 απόκλιση", "urgent"]);
    expect([c.projects.metric, c.projects.severity]).toEqual(["8 ενεργά · 1 εκτός προϋπολογισμού", "urgent"]);
    expect(c.planner.metric).toBe("1 ανοιχτή εργασία");
    expect(c.contacts.metric).toBe("1 επαφή");
  });

  it("survives empty data", () => {
    const c = cards({ ...base, pending: 0, openTasks: Number.NaN, calendarNext7: 0, pnlRows: [], contacts: 0 });
    expect(c.transactions.metric).toBe("Καμία εκκρεμότητα");
    expect(c.planner.metric).toBe("Καμία ανοιχτή εργασία");
    expect(c.calendar.metric).toBe("Τίποτα τις επόμενες 7 ημέρες");
    expect(c.reports.metric).toBe(`Αποτέλεσμα ${formatMoney(0)}`);
    expect(c.contacts.metric).toBe("0 επαφές");
  });
});

describe("pnlResult", () => {
  it("sums the P&L lines like the report's result row, ignoring unknown lines", () => {
    expect(pnlResult([{ line: "revenue", amount: "10.10" }, { line: "rent", amount: "-0.05" }, { line: "bogus", amount: 999 }])).toBe(10.05);
    expect(pnlResult([{ line: "revenue", amount: null }])).toBe(0);
  });
});
