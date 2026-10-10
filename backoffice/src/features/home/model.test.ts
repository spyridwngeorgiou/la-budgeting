import { describe, expect, it } from "vitest";
import { buildAgenda, dueWindow, longDateLabel, monthByLine, projectHealth, signed, type AgendaItem } from "./model";

const item = (key: string, dueDate: string, amount = -100): AgendaItem => ({
  key,
  label: key,
  meta: null,
  dueDate,
  amount,
  probability: 1,
  href: `/transactions?ids=${key}`,
});

describe("dueWindow", () => {
  it("ends 14 days after today and has no lower bound", () => {
    const w = dueWindow("2026-10-10");
    expect(w).toEqual({ until: "2026-10-24" });
    expect(Object.keys(w)).not.toContain("from");
  });

  it("crosses month and year ends", () => {
    expect(dueWindow("2026-12-25").until).toBe("2027-01-08");
  });
});

describe("buildAgenda", () => {
  const today = "2026-10-10";
  const { until } = dueWindow(today);

  it("keeps overdue rows from previous months, pinned on top as ΕΠΕΙΓΟΝ", () => {
    const rows = buildAgenda(
      [item("next-week", "2026-10-17"), item("august", "2026-08-03"), item("tomorrow", "2026-10-11"), item("september", "2026-09-30")],
      today,
      until,
    );
    expect(rows.map((r) => r.key)).toEqual(["august", "september", "tomorrow", "next-week"]);
    expect(rows.slice(0, 2).every((r) => r.overdue && r.severity === "urgent")).toBe(true);
    expect(rows[2].severity).toBe("attention");
    expect(rows[3].severity).toBe("info");
  });

  it("today is due, not overdue; past the window is left out", () => {
    const rows = buildAgenda([item("today", today), item("late", "2026-10-25")], today, until);
    expect(rows.map((r) => [r.key, r.overdue])).toEqual([["today", false]]);
  });
});

describe("signed", () => {
  it("income +, expense −", () => {
    expect(signed("income", 10)).toBe(10);
    expect(signed("expense", 10)).toBe(-10);
    expect(signed("expense", null)).toBe(-0);
  });
});

describe("monthByLine", () => {
  it("revenue, cost and result per business line, with the change on last month", () => {
    const rows = monthByLine(
      [
        { bucket: "construction", line: "revenue", amount: "1000" },
        { bucket: "construction", line: "cost_of_sales", amount: "-400" },
        { bucket: "construction", line: "opex", amount: -100.1 },
        { bucket: "hospitality", line: "revenue", amount: 50 },
      ],
      [
        { bucket: "construction", line: "revenue", amount: 300 },
        { bucket: "general", line: "opex", amount: -20 },
      ],
      ["hospitality", "construction", "brokerage", "investments", "general"],
    );
    expect(rows).toEqual([
      { line: "hospitality", revenue: 50, cost: 0, result: 50, previous: 0, delta: 50 },
      { line: "construction", revenue: 1000, cost: -500.1, result: 499.9, previous: 300, delta: 199.9 },
      { line: "general", revenue: 0, cost: 0, result: 0, previous: -20, delta: 20 },
    ]);
  });
});

describe("projectHealth", () => {
  const base = { totalBudget: 100, remaining: 10, lineOverrun: false, overdueMilestone: false };
  it("worst signal wins", () => {
    expect(projectHealth(base)).toBe("ok");
    expect(projectHealth({ ...base, overdueMilestone: true })).toBe("overdue");
    expect(projectHealth({ ...base, overdueMilestone: true, lineOverrun: true })).toBe("lineOverrun");
    expect(projectHealth({ ...base, remaining: -1, lineOverrun: true })).toBe("overrun");
  });
  it("no budget is not an overrun", () => {
    expect(projectHealth({ ...base, totalBudget: 0, remaining: -50 })).toBe("ok");
  });
});

describe("longDateLabel", () => {
  it("Greek long date with the weekday", () => {
    expect(longDateLabel("2026-10-10")).toMatch(/Σάββατο.*10.*Οκτωβρίου.*2026/);
  });
});
