import { describe, it, expect } from "vitest";
import { xirr } from "./xirr";

describe("xirr", () => {
  it("computes 0% for a single round-trip with no gain", () => {
    const rate = xirr([
      { date: "2024-01-01", amount: -1000 },
      { date: "2025-01-01", amount: 1000 },
    ]);
    expect(rate).not.toBeNull();
    expect(rate!).toBeCloseTo(0, 3);
  });

  it("computes ~10% for a classic one-year 10% return", () => {
    const rate = xirr([
      { date: "2024-01-01", amount: -1000 },
      { date: "2025-01-01", amount: 1100 },
    ]);
    expect(rate!).toBeCloseTo(0.1, 2);
  });

  it("handles multiple contributions and one exit", () => {
    const rate = xirr([
      { date: "2022-01-01", amount: -50000 },
      { date: "2023-01-01", amount: -50000 },
      { date: "2025-01-01", amount: 130000 },
    ]);
    expect(rate).not.toBeNull();
    // 130k back on ~100k staggered in over 3 years is a solidly positive return
    expect(rate!).toBeGreaterThan(0.05);
    expect(rate!).toBeLessThan(0.3);
  });

  it("returns null without both a contribution and a return", () => {
    expect(xirr([{ date: "2024-01-01", amount: -1000 }])).toBeNull();
    expect(xirr([{ date: "2024-01-01", amount: -1000 }, { date: "2024-06-01", amount: -500 }])).toBeNull();
  });

  it("returns null for fewer than two flows", () => {
    expect(xirr([])).toBeNull();
    expect(xirr([{ date: "2024-01-01", amount: -1000 }])).toBeNull();
  });
});
