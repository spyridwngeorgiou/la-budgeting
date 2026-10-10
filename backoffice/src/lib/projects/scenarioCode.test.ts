import { describe, expect, it } from "vitest";
import { planNewScenario } from "./scenarioCode";

// The «only a base scenario can be created» bug: every insert used code
// 'base' and is_base true, so the second one always failed.
describe("planNewScenario", () => {
  it("the first scenario of a project is the base", () => {
    expect(planNewScenario([])).toEqual({ code: "base", is_base: true, sort_order: 0 });
  });

  it("a second scenario gets a new code and is not the base", () => {
    const next = planNewScenario([{ code: "base", is_base: true, sort_order: 0 }]);
    expect(next).toEqual({ code: "s2", is_base: false, sort_order: 1 });
  });

  it("any number of scenarios get distinct codes", () => {
    const existing: { code: string; is_base: boolean; sort_order: number }[] = [];
    for (let i = 0; i < 6; i++) existing.push({ ...planNewScenario(existing) });
    expect(new Set(existing.map((s) => s.code)).size).toBe(6);
    expect(existing.filter((s) => s.is_base)).toHaveLength(1);
    expect(existing.map((s) => s.sort_order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("skips codes already taken (seeded or after a delete)", () => {
    const next = planNewScenario([
      { code: "base", is_base: true },
      { code: "s3", is_base: false },
    ]);
    expect(next.code).toBe("s4");
  });

  it("keeps seeded codes such as 4star_full and still avoids clashes", () => {
    const next = planNewScenario([
      { code: "4star_full", is_base: true, sort_order: 1 },
      { code: "4star_lean", is_base: false, sort_order: 2 },
    ]);
    expect(next).toEqual({ code: "s3", is_base: false, sort_order: 3 });
  });

  it("becomes the base when the project has none", () => {
    expect(planNewScenario([{ code: "s2", is_base: false }]).is_base).toBe(true);
    expect(planNewScenario([{ code: "base", is_base: false }])).toMatchObject({ code: "s2", is_base: true });
  });
});
