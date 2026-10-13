import { describe, expect, it } from "vitest";
import { projectBlocks, splitNotes, type ProjectPageFacts } from "./projectPage";

// A project with nothing on it yet; each case adds what it needs.
const empty: ProjectPageFacts = {
  businessModel: null,
  hasBudget: false,
  hasSpend: false,
  developmentFlows: false,
  contractValue: null,
  revenueToDate: 0,
  irr: null,
  loans: 0,
  hasScenario: false,
  revenuePlans: 0,
  hasCashflow: false,
  utilities: 0,
  occupancyPerMonth: 0,
  costMonths: 0,
  openNotes: 0,
};
const facts = (extra: Partial<ProjectPageFacts>): ProjectPageFacts => ({ ...empty, ...extra });

describe("projectBlocks: the «Προσθήκη» line", () => {
  it("a new project shows no blocks and offers everything, in order", () => {
    const b = projectBlocks(empty);
    expect(b.additions).toEqual(["loan", "contract", "utility", "scenario", "note"]);
    expect([b.budget, b.development, b.revenue, b.loan, b.operation, b.cashflow, b.property, b.status]).toEqual([
      false, false, false, false, false, false, false, false,
    ]);
  });

  it("offers only what is missing: a block on the page carries its own button", () => {
    const b = projectBlocks(facts({ businessModel: "client_project", loans: 2, utilities: 1, openNotes: 3 }));
    expect(b.additions).toEqual(["contract", "scenario"]);
    expect([b.loan, b.property, b.status]).toEqual([true, true, true]);
  });

  it("a fully set-up hotel lease offers nothing (no client contract for a lease)", () => {
    const b = projectBlocks(
      facts({ businessModel: "hotel_lease", loans: 1, hasScenario: true, utilities: 2, occupancyPerMonth: 1, openNotes: 1 }),
    );
    expect(b.additions).toEqual([]);
  });

  it("a client contract is not offered once it is set, nor for a development for sale", () => {
    expect(projectBlocks(facts({ businessModel: "client_project", contractValue: 1 })).additions).not.toContain("contract");
    expect(projectBlocks(facts({ businessModel: "own_development" })).additions).not.toContain("contract");
    expect(projectBlocks(facts({ businessModel: "general" })).additions).toContain("contract");
  });

  it("ΑΚΙΝΗΤΟ is on the page with rent or property costs alone, so «+ Παροχή» is not offered", () => {
    expect(projectBlocks(facts({ occupancyPerMonth: 1 })).additions).not.toContain("utility");
    expect(projectBlocks(facts({ costMonths: 3 })).additions).not.toContain("utility");
  });

  it("revenue plans without a scenario still show ΛΕΙΤΟΥΡΓΙΑ, which offers the scenario itself", () => {
    const b = projectBlocks(facts({ revenuePlans: 2 }));
    expect(b.operation).toBe(true);
    expect(b.additions).not.toContain("scenario");
  });
});

describe("projectBlocks: which blocks", () => {
  it("ΠΡΟΫΠΟΛΟΓΙΣΜΟΣ with a budget or with spending on the project", () => {
    expect(projectBlocks(facts({ hasBudget: true })).budget).toBe(true);
    expect(projectBlocks(facts({ hasSpend: true })).budget).toBe(true);
  });

  it("the IRR once: in ΑΝΑΠΤΥΞΗ for a development with flows, otherwise in ΕΣΟΔΑ", () => {
    const dev = projectBlocks(facts({ businessModel: "own_development", developmentFlows: true, irr: 0.12 }));
    expect([dev.development, dev.revenueIrr, dev.revenue]).toEqual([true, false, false]);
    const lease = projectBlocks(facts({ businessModel: "hotel_lease", irr: 0.12 }));
    expect([lease.development, lease.revenueIrr, lease.revenue]).toEqual([false, true, true]);
  });

  it("ΑΝΑΠΤΥΞΗ only for own_development, and only with flows", () => {
    expect(projectBlocks(facts({ businessModel: "own_development" })).development).toBe(false);
    expect(projectBlocks(facts({ businessModel: "hotel_lease", developmentFlows: true })).development).toBe(false);
  });

  it("ΕΣΟΔΑ with a contract or income, without an IRR", () => {
    expect(projectBlocks(facts({ contractValue: 0 })).revenue).toBe(true);
    expect(projectBlocks(facts({ revenueToDate: 10 })).revenue).toBe(true);
    expect(projectBlocks(facts({ irr: Number.NaN })).revenue).toBe(false);
  });
});

describe("splitNotes", () => {
  it("urgent first, then watch, in their order; information behind ▸", () => {
    const notes = [
      { id: "a", severity: "watch" },
      { id: "b", severity: "info" },
      { id: "c", severity: "urgent" },
      { id: "d", severity: "watch" },
    ];
    const { pressing, rest } = splitNotes(notes);
    expect(pressing.map((n) => n.id)).toEqual(["c", "a", "d"]);
    expect(rest.map((n) => n.id)).toEqual(["b"]);
  });
});
