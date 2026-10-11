import { describe, expect, it } from "vitest";
import { carriesPresent, isPresenting, presentNeighbours, withPresent, withoutPresent } from "./present";

describe("presentation mode", () => {
  it("reads the flag", () => {
    expect(isPresenting(new URLSearchParams("present=1"))).toBe(true);
    expect(isPresenting(new URLSearchParams("present=0"))).toBe(false);
    expect(isPresenting(null)).toBe(false);
  });

  it("walks the report tabs and wraps to the overview", () => {
    expect(presentNeighbours("/dashboard")).toEqual({ index: 0, prev: "/reports/portfolio", next: "/reports/cash" });
    expect(presentNeighbours("/reports/cash")?.prev).toBe("/dashboard");
    expect(presentNeighbours("/reports/pnl/")?.next).toBe("/reports/net-worth");
    expect(presentNeighbours("/reports/portfolio")?.next).toBe("/dashboard");
    expect(presentNeighbours("/projects/123")).toBeNull();
  });

  it("adds and removes the flag, keeping other params", () => {
    expect(withPresent("/reports/cash")).toBe("/reports/cash?present=1");
    expect(withPresent("/reports/cash?horizon=24#top")).toBe("/reports/cash?horizon=24&present=1#top");
    expect(withoutPresent("/reports/cash", "?horizon=24&present=1")).toBe("/reports/cash?horizon=24");
    expect(withoutPresent("/dashboard", "?present=1")).toBe("/dashboard");
  });

  it("only app pages carry it", () => {
    expect(carriesPresent("/reports/vat")).toBe(true);
    expect(carriesPresent("/api/vat/export")).toBe(false);
    expect(carriesPresent("/brand/logo-mark.png")).toBe(false);
  });
});
