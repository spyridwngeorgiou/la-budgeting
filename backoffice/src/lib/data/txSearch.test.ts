import { describe, expect, it } from "vitest";
import { cleanSearch } from "./txSearch";

describe("cleanSearch", () => {
  it("keeps normal Greek text, trims and collapses spaces", () => {
    expect(cleanSearch("  ΔΕΗ   Γλυφάδα ")).toBe("ΔΕΗ Γλυφάδα");
  });
  it("drops characters that could change the PostgREST filter", () => {
    expect(cleanSearch('a,b) or(id.eq.1)*"%')).toBe("a b or id.eq.1");
  });
  it("ignores empty and one-letter searches", () => {
    expect(cleanSearch("")).toBeNull();
    expect(cleanSearch(null)).toBeNull();
    expect(cleanSearch(" x ")).toBeNull();
  });
  it("caps the length", () => {
    expect(cleanSearch("α".repeat(200))?.length).toBe(80);
  });
});
