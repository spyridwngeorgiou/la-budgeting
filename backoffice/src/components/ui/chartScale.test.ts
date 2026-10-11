import { describe, expect, it } from "vitest";
import { alignedDomains, axisExtent, minPoint, paddedDomain } from "./chartScale";

describe("chart scale", () => {
  const data = [
    { m: "Ιαν", a: 100, b: 50, c: -30, cum: 120 },
    { m: "Φεβ", a: -40, b: 20, c: -10, cum: 90 },
  ];

  it("stacked bars sum per sign; lone series as they are", () => {
    const s = [{ key: "a" }, { key: "b" }, { key: "c" }];
    expect(axisExtent(data, s, "stack")).toEqual([-50, 150]);
    expect(axisExtent(data, s)).toEqual([-40, 100]);
    expect(axisExtent(data, [{ key: "cum", kind: "line" }], "stack")).toEqual([0, 120]);
  });

  it("aligned domains put both zeros at the same height", () => {
    const [l, r] = alignedDomains([-50, 150], [0, 1_000_000]);
    const zero = ([lo, hi]: [number, number]) => -lo / (hi - lo);
    expect(zero(l)).toBeCloseTo(zero(r));
    expect(l[0]).toBeLessThanOrEqual(-50);
    expect(r[1]).toBeGreaterThanOrEqual(1_000_000);
  });

  it("min point and padded domain", () => {
    expect(minPoint(data, "a", "m")).toEqual({ index: 1, x: "Φεβ", value: -40 });
    expect(minPoint([{ m: "x", a: null }], "a", "m")).toBeNull();
    const [lo, hi] = paddedDomain(data, ["a"], [200], 0.1, 0);
    expect(lo).toBeCloseTo(-40 - 24);
    expect(hi).toBe(200);
  });
});
