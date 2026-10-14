import { describe, expect, it } from "vitest";
import { cashRunsOut, hasCash } from "./cashSplit";

describe("cashRunsOut", () => {
  it("finds the first month cash closes below zero", () => {
    const rows = [
      { month: "2026-10-01", cash_closing: "66475" },
      { month: "2027-03-01", cash_closing: "-29275.5" },
      { month: "2027-04-01", cash_closing: -30125 },
    ];
    expect(cashRunsOut(rows)).toEqual({ month: "2027-03", closing: -29275.5 });
  });
  it("is null when cash never runs out", () => {
    expect(cashRunsOut([{ month: "2026-10-01", cash_closing: 0 }])).toBeNull();
  });
});

describe("hasCash", () => {
  it("is false with no cash at all", () => {
    expect(hasCash([{ month: "2026-10-01", cash_closing: 0 }])).toBe(false);
    expect(hasCash([{ month: "2026-10-01", cash_closing: 5 }])).toBe(true);
  });
});
