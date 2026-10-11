import { describe, expect, it } from "vitest";
import { formatMoney } from "@/lib/format";
import { dashboardTiles, pnlResult, type TileInputs } from "./tiles";

const base: TileInputs = {
  cashCorporate: 1000,
  cashPersonal: 250,
  lowest: { month: "2027-03-01", closing_balance: "400.5", below_buffer: false },
  inboxPending: 3,
  calendarNext7: 5,
  year: 2026,
  pnlRows: [
    { line: "revenue", amount: "1000" },
    { line: "opex", amount: -300 },
    { line: "tax", amount: "-50.25" },
  ],
  vatPayable: 120,
  receivables: 800,
  payables: 450,
  activeProjects: 4,
  overBudgetProjects: 1,
};

const byKey = (inputs: TileInputs) => Object.fromEntries(dashboardTiles(inputs).map((t) => [t.key, t]));

describe("dashboardTiles", () => {
  it("returns the 8 tiles in plan order with their links", () => {
    const tiles = dashboardTiles(base);
    expect(tiles.map((t) => [t.key, t.href])).toEqual([
      ["cash", "/accounts"],
      ["forecast", "/reports/cash?month=2027-03"],
      ["inbox", "/inbox"],
      ["calendar", "/calendar"],
      ["pnl", "/reports/pnl"],
      ["vat", "/reports/vat"],
      ["openItems", "/transactions?status=pending"],
      ["projects", "/projects"],
    ]);
    for (const t of tiles) {
      expect(t.eyebrow.length).toBeGreaterThan(0);
      expect(t.value.length).toBeGreaterThan(0);
    }
  });

  it("formats each number", () => {
    const t = byKey(base);
    expect(t.cash.value).toBe(formatMoney(1250));
    expect(t.cash.sub).toBe(`Εταιρικό ${formatMoney(1000)} · Προσωπικό ${formatMoney(250)}`);
    expect(t.forecast.value).toBe(formatMoney(400.5));
    expect(t.forecast.sub).toContain("2027");
    expect(t.inbox.value).toBe("3");
    expect(t.calendar.value).toBe("5");
    expect(t.calendar.sub).toBe("εγγραφές τις επόμενες 7 ημέρες");
    expect(t.pnl.value).toBe(formatMoney(649.75));
    expect(t.pnl.sub).toBe("2026 ως σήμερα");
    expect(t.vat.value).toBe(formatMoney(120));
    expect(t.openItems.value).toBe(`+${formatMoney(800)}`);
    expect(t.openItems.sub).toBe(`−${formatMoney(450)} υποχρεώσεις`);
    expect(t.projects.value).toBe("4");
    expect(t.projects.sub).toBe("ενεργά · 1 εκτός προϋπολογισμού");
    expect(Object.values(t).some((x) => x.negative)).toBe(false);
  });

  it("flags a forecast below the buffer and a negative result", () => {
    const t = byKey({
      ...base,
      lowest: { month: "2026-12-01", closing_balance: 50, below_buffer: true },
      pnlRows: [{ line: "opex", amount: -10 }],
    });
    expect(t.forecast.negative).toBe(true);
    expect(t.pnl.negative).toBe(true);
  });

  it("handles empty data", () => {
    const t = byKey({
      ...base,
      cashCorporate: 0,
      cashPersonal: 0,
      lowest: null,
      inboxPending: Number.NaN,
      calendarNext7: 1,
      pnlRows: [],
      activeProjects: 1,
      overBudgetProjects: 0,
    });
    expect(t.forecast.value).toBe("—");
    expect(t.forecast.sub).toBe("Χωρίς πρόβλεψη");
    expect(t.inbox.value).toBe("0");
    expect(t.inbox.sub).toBe("Τίποτα προς έλεγχο");
    expect(t.calendar.sub).toBe("εγγραφή τις επόμενες 7 ημέρες");
    expect(t.pnl.value).toBe(formatMoney(0));
    expect(t.projects.sub).toBe("ενεργό · 0 εκτός προϋπολογισμού");
  });
});

describe("forecast tile driver", () => {
  it("names the low month's largest outflow and links to that month", () => {
    const t = byKey({ ...base, lowestDriver: { label: "Κατασκευή — φάση Α", amount: "690558" } });
    expect(t.forecast.sub).toContain(`κυρίως: Κατασκευή — φάση Α −${formatMoney(690558)}`);
    expect(t.forecast.href).toBe("/reports/cash?month=2027-03");
  });
  it("leaves the driver out when there is none", () => {
    expect(byKey({ ...base, lowestDriver: null }).forecast.sub).not.toContain("κυρίως");
  });
});

describe("pnlResult", () => {
  it("sums the P&L lines like the report's result row, ignoring unknown lines", () => {
    expect(pnlResult([{ line: "revenue", amount: "10.10" }, { line: "rent", amount: "-0.05" }, { line: "bogus", amount: 999 }])).toBe(10.05);
    expect(pnlResult([{ line: "revenue", amount: null }])).toBe(0);
  });
});
