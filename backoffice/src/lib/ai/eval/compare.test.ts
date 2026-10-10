import { describe, expect, it } from "vitest";
import type { Extraction } from "@/lib/ai/schemas";
import { compareExtractions, costUsd, median, normalise, normDate } from "./compare";

const m = (value: number | null) => ({ value, evidence: null });

const base: Extraction = {
  doc_type: "invoice",
  issuer_name: "ΑΛΦΑ ΑΕ",
  issuer_afm: "094019245",
  invoice_number: "A-12",
  mydata_mark: "400001234567890",
  issue_date: "2026-09-03",
  net: m(100),
  vat: m(24),
  gross: m(124),
  vat_rate: 0.24,
  withholding: m(null),
  payment_hint: "card",
  project_mention: null,
  supply_number: null,
  suggested_category: null,
  notes_for_human: null,
};

describe("normalise", () => {
  it("strips AFM/MARK formatting and rounds money to cents", () => {
    const n = normalise({ ...base, issuer_afm: "EL 094 019 245", mydata_mark: " 4000-0123-4567890 ", gross: m(124.004) });
    expect(n.issuer_afm).toBe("094019245");
    expect(n.mydata_mark).toBe("400001234567890");
    expect(n.gross).toBe("124.00");
  });

  it("normalises dates to ISO, including Greek DD/MM/YYYY", () => {
    expect(normDate("2026-9-3")).toBe("2026-09-03");
    expect(normDate("03/09/2026")).toBe("2026-09-03");
    expect(normDate("3.9.26")).toBe("2026-09-03");
    expect(normDate("")).toBeNull();
  });
});

describe("compareExtractions", () => {
  it("agrees on equivalent readings and on fields both left null", () => {
    const b = { ...base, issuer_afm: "094 019 245", issue_date: "03/09/2026", net: m(100.0), mydata_mark: null };
    const a = { ...base, mydata_mark: null };
    expect(Object.values(compareExtractions(a, b)).every(Boolean)).toBe(true);
  });

  it("flags a different amount, AFM or doc type", () => {
    const r = compareExtractions(base, { ...base, gross: m(124.5), issuer_afm: "094019246", doc_type: "receipt" });
    expect(r.gross).toBe(false);
    expect(r.issuer_afm).toBe(false);
    expect(r.doc_type).toBe(false);
    expect(r.net).toBe(true);
  });
});

describe("costUsd", () => {
  it("prices Sonnet 5.5 and Opus 5 at list price", () => {
    expect(costUsd("claude-sonnet-5-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(12);
    expect(costUsd("claude-opus-5", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(30);
  });
});

describe("median", () => {
  it("handles odd, even and empty", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBe(0);
  });
});
