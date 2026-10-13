import { describe, expect, it } from "vitest";
import { activeFilterCount, hasAnyFilter, txFilterHref } from "./filterHref";

describe("txFilterHref", () => {
  it("keeps the search (?q=) when a filter changes", () => {
    expect(txFilterHref({ q: "δεη", status: "paid" }, { project_id: "p1" })).toBe(
      "/transactions?q=%CE%B4%CE%B5%CE%B7&status=paid&project_id=p1",
    );
    expect(txFilterHref({ q: "δεη", project_id: "p1" }, { project_id: "p2" })).toBe("/transactions?q=%CE%B4%CE%B5%CE%B7&project_id=p2");
  });

  it("removes only the filter set to empty, keeping q and an ids drill-down", () => {
    expect(txFilterHref({ q: "x", ids: "a,b", account_id: "acc" }, { account_id: "" })).toBe("/transactions?q=x&ids=a%2Cb");
    expect(txFilterHref({ q: "x", from: "2026-01-01" }, { from: null })).toBe("/transactions?q=x");
  });

  it("goes back to page 1 and never reopens the new-movement form", () => {
    expect(txFilterHref({ q: "x", page: "4", new: "1" }, { status: "pending" })).toBe("/transactions?q=x&status=pending");
  });
});

describe("activeFilterCount / hasAnyFilter", () => {
  it("counts the filters, the period once, and not the search", () => {
    expect(activeFilterCount({})).toBe(0);
    expect(activeFilterCount({ q: "x", status: "paid", from: "2026-01-01", to: "2026-01-31" })).toBe(2);
    expect(activeFilterCount({ direction: "income", project_id: "p", category_id: "c", account_id: "a", contact_id: "k", scope: "business" })).toBe(6);
  });

  it("has something to clear when only the search or an ids list is set", () => {
    expect(hasAnyFilter({})).toBe(false);
    expect(hasAnyFilter({ q: "x" })).toBe(true);
    expect(hasAnyFilter({ ids: "a" })).toBe(true);
    expect(hasAnyFilter({ page: "2" })).toBe(false);
  });
});
