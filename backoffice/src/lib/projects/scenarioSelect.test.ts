import { describe, expect, it } from "vitest";
import { newScenarioName, opexLinesCopy, scenarioCopy, selectScenario } from "./scenarioCode";

const base = { id: "a", is_base: true, name: "Βασικό" };
const alt = { id: "b", is_base: false, name: "Απαισιόδοξο" };

// The project page shows ?s= or the base -- no longer scenarios[0].
describe("selectScenario", () => {
  it("takes the requested scenario of the project", () => {
    expect(selectScenario([base, alt], "b")).toBe(alt);
  });

  it("falls back to the base, not the first row", () => {
    expect(selectScenario([alt, base], undefined)).toBe(base);
    expect(selectScenario([alt, base], "")).toBe(base);
  });

  it("ignores an id of another project (or a deleted scenario)", () => {
    expect(selectScenario([alt, base], "zzz")).toBe(base);
  });

  it("reads the first value of a repeated ?s=", () => {
    expect(selectScenario([base, alt], ["b", "a"])).toBe(alt);
  });

  it("without a base it shows the first; without scenarios nothing", () => {
    expect(selectScenario([alt], null)).toBe(alt);
    expect(selectScenario([], "a")).toBeNull();
  });
});

describe("scenarioCopy", () => {
  it("copies the assumptions and nothing of the source's identity", () => {
    const source = {
      id: "a",
      code: "base",
      is_base: true,
      sort_order: 0,
      org_id: "o",
      project_id: "p",
      created_at: "x",
      updated_at: "y",
      name: "Βασικό",
      flat_annual_revenue: null,
      revenue_plan_id: "plan",
      adr_multiplier: 1.1,
      revenue_growth_pct: 0.02,
      opex_growth_pct: 0.03,
      growth_starts_after_operating_year: 3,
      discount_rate_pct: 0.09,
      dscr_covenant_min: 1.25,
      notes: "σημ.",
    };
    expect(scenarioCopy(source)).toEqual({
      flat_annual_revenue: null,
      revenue_plan_id: "plan",
      adr_multiplier: 1.1,
      revenue_growth_pct: 0.02,
      opex_growth_pct: 0.03,
      growth_starts_after_operating_year: 3,
      discount_rate_pct: 0.09,
      dscr_covenant_min: 1.25,
      notes: "σημ.",
    });
  });
});

describe("opexLinesCopy", () => {
  it("gives every line to the new scenario, without the old ids", () => {
    const line = {
      id: "l1",
      scenario_id: "a",
      org_id: "o",
      kind: "payroll" as const,
      label: "Προσωπικό",
      sort_order: 2,
      category_id: null,
      annual_amount: null,
      from_operating_year: 1,
      to_operating_year: null,
      grows_with_opex_growth: true,
      note: null,
      headcount: 4,
      monthly_wage: 1200,
      salaries_per_year: 14,
      employer_contribution_pct: 0.2179,
      premium_pct: 0,
      months_active: 12,
      pct_of_revenue: null,
    };
    const [copy] = opexLinesCopy([line], { scenarioId: "b", orgId: "o" });
    expect(copy).not.toHaveProperty("id");
    expect(copy).toMatchObject({ scenario_id: "b", org_id: "o", kind: "payroll", headcount: 4, sort_order: 2 });
    expect(opexLinesCopy([], { scenarioId: "b", orgId: "o" })).toEqual([]);
  });
});

describe("newScenarioName", () => {
  it("uses the typed name, trimmed", () => {
    expect(newScenarioName("  Αισιόδοξο ", "Βασικό", "(αντίγραφο)")).toBe("Αισιόδοξο");
  });
  it("names an unnamed copy after its source", () => {
    expect(newScenarioName("", "Βασικό", "(αντίγραφο)")).toBe("Βασικό (αντίγραφο)");
  });
  it("an unnamed blank scenario has no name", () => {
    expect(newScenarioName(" ", null, "(αντίγραφο)")).toBeNull();
  });
});
