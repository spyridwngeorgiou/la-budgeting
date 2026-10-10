import { describe, expect, it } from "vitest";
import { chipHref, filterParams, hasFilters, isViewActive, parseTxFilters, searchTerm, viewHref } from "./filters";

const P = "11111111-2222-3333-4444-555555555555";

describe("parseTxFilters", () => {
  it("keeps valid values and drops the rest", () => {
    const f = parseTxFilters({ status: "pending", direction: "sideways", project_id: P, account_id: "x';--", from: "2026-01-01", to: "nope" });
    expect(f.status).toBe("pending");
    expect(f.direction).toBeNull();
    expect(f.project_id).toBe(P);
    expect(f.account_id).toBeNull();
    expect(f.from).toBe("2026-01-01");
    expect(f.to).toBeNull();
  });

  it("reads the instalment and overdue filters and the id list", () => {
    expect(parseTxFilters({ plan: "any" }).plan).toBe("any");
    expect(parseTxFilters({ plan: P }).plan).toBe(P);
    expect(parseTxFilters({ plan: "all" }).plan).toBeNull();
    expect(parseTxFilters({ overdue: "1" }).overdue).toBe(true);
    expect(parseTxFilters({ ids: `${P},bad` }).ids).toEqual([P]);
    expect(parseTxFilters({}).ids).toBeNull();
  });
});

describe("searchTerm", () => {
  it("drops the characters that structure a PostgREST filter", () => {
    expect(searchTerm("ΔΕΗ, (ρεύμα).*")).toBe("ΔΕΗ ρεύμα");
    expect(searchTerm("   ")).toBeNull();
    expect(searchTerm(null)).toBeNull();
  });
});

describe("filter links never reset each other", () => {
  const sp = { project_id: P, from: "2026-01-01", status: "paid", edit: "abc" };

  it("a status chip keeps the project and date filters, and drops UI state", () => {
    expect(chipHref("/money", sp, "status", "pending")).toBe(`/money?status=pending&project_id=${P}&from=2026-01-01`);
    expect(chipHref("/money", sp, "status", null)).toBe(`/money?project_id=${P}&from=2026-01-01`);
  });

  it("a saved view adds its own parameters and removes only those", () => {
    const on = viewHref("/money", { project_id: P }, "receivables");
    expect(on).toBe(`/money?status=pending&direction=income&project_id=${P}`);
    const sp2 = { project_id: P, direction: "income", status: "pending" };
    expect(isViewActive(sp2, "receivables")).toBe(true);
    expect(isViewActive(sp2, "payables")).toBe(false);
    expect(viewHref("/money", sp2, "receivables")).toBe(`/money?project_id=${P}`);
    expect(viewHref("/money", { overdue: "1", q: "ΔΕΗ" }, "instalments")).toBe("/money?q=%CE%94%CE%95%CE%97&overdue=1&plan=any");
  });

  it("knows when any filter is set", () => {
    expect(hasFilters({ edit: "1" })).toBe(false);
    expect(hasFilters({ plan: "any" })).toBe(true);
    expect(Object.keys(filterParams({ new: "1", status: "paid" })).includes("new")).toBe(false);
  });
});
