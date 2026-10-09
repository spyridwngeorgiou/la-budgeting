import { describe, expect, it } from "vitest";
import { buildSources, hrefFor, isSafeSourceHref, MAX_PINNED_IDS, MAX_SOURCES, transactionsHref, type SourceRef } from "./links";

const P = "11111111-1111-4111-8111-111111111111";
const C = "22222222-2222-4222-8222-222222222222";
const id = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;

describe("transactionsHref", () => {
  it("pins a short id list", () => {
    expect(transactionsHref({}, [id(1), id(2)])).toBe(`/transactions?ids=${id(1)},${id(2)}`);
  });

  it("turns a long id list into the filter that produced it", () => {
    const ids = Array.from({ length: MAX_PINNED_IDS + 1 }, (_, i) => id(i));
    const href = transactionsHref({ project_id: P, direction: "expense", from: "2026-01-01" }, ids);
    expect(href).toBe(`/transactions?from=2026-01-01&direction=expense&project_id=${P}`);
    expect(href).not.toContain("ids=");
  });

  it("drops values the transactions page would not understand", () => {
    expect(
      transactionsHref({
        project_id: "1 or 1=1",
        from: "yesterday",
        direction: "sideways" as never,
        contact_id: C,
      }),
    ).toBe(`/transactions?contact_id=${C}`);
  });

  it("falls back to the plain list when nothing is filterable", () => {
    expect(transactionsHref({}, ["not-a-uuid"])).toBe("/transactions");
  });
});

describe("hrefFor", () => {
  it("links reports at their /reports/* home and entities by id", () => {
    expect(hrefFor({ kind: "report", report: "vat", label: "ΦΠΑ" })).toBe("/reports/vat");
    expect(hrefFor({ kind: "report", report: "cash", label: "Ταμείο" })).toBe("/reports/cash");
    expect(hrefFor({ kind: "project", id: P, label: "Έργο" })).toBe(`/projects/${P}`);
    expect(hrefFor({ kind: "contact", id: C, label: "Επαφή" })).toBe(`/contacts/${C}`);
    expect(hrefFor({ kind: "revenue_plan", id: P, label: "Εκτίμηση" })).toBe(`/projects/revenue-plans/${P}`);
    expect(hrefFor({ kind: "changes", label: "Εκκρεμότητες" })).toBe("/assistant?panel=changes");
  });

  it("refuses an entity link without a real id", () => {
    expect(hrefFor({ kind: "project", id: "../settings", label: "x" })).toBeNull();
  });
});

describe("buildSources", () => {
  it("dedupes by link, keeps order and caps the list", () => {
    const refs: SourceRef[] = [
      { kind: "report", report: "vat", label: "Θέση ΦΠΑ" },
      { kind: "report", report: "vat", label: "ξανά" },
      ...Array.from({ length: 20 }, (_, i): SourceRef => ({ kind: "project", id: id(i), label: `Έργο ${i}` })),
    ];
    const out = buildSources(refs);
    expect(out[0]).toEqual({ label: "Θέση ΦΠΑ", href: "/reports/vat" });
    expect(out).toHaveLength(MAX_SOURCES);
    expect(new Set(out.map((s) => s.href)).size).toBe(out.length);
  });
});

describe("isSafeSourceHref", () => {
  it("accepts only same-app relative links", () => {
    expect(isSafeSourceHref(`/transactions?ids=${id(1)},${id(2)}`)).toBe(true);
    expect(isSafeSourceHref("/reports/vat")).toBe(true);
    expect(isSafeSourceHref("https://evil.example")).toBe(false);
    expect(isSafeSourceHref("//evil.example")).toBe(false);
    expect(isSafeSourceHref("javascript:alert(1)")).toBe(false);
    expect(isSafeSourceHref(42)).toBe(false);
  });
});
