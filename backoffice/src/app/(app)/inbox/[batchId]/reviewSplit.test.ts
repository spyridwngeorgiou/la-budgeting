import { describe, expect, it } from "vitest";
import { needsDecision, splitForReview, type ReviewRowFacts } from "./reviewSplit";

const bank = (over: Partial<ReviewRowFacts> = {}): ReviewRowFacts => ({
  decision: "create",
  confidence: "none",
  document: false,
  dedupStatus: "new",
  parseErrors: 0,
  reviewReasons: 0,
  ...over,
});
const doc = (over: Partial<ReviewRowFacts> = {}): ReviewRowFacts => bank({ document: true, confidence: null, ...over });

describe("needsDecision", () => {
  it("keeps every undecided row on top", () => {
    expect(needsDecision(bank({ decision: "pending" }), true)).toBe(true);
    expect(needsDecision(doc({ decision: "pending", dedupStatus: "dup_external_key" }), true)).toBe(true);
  });

  it("folds what the matcher decided by itself on a trusted statement", () => {
    expect(needsDecision(bank({ decision: "settle", confidence: "auto" }), true)).toBe(false);
    expect(needsDecision(bank({ decision: "link_existing", confidence: "auto", dedupStatus: "already_recorded" }), true)).toBe(false);
    // No candidate: a new movement by default.
    expect(needsDecision(bank({ decision: "create", confidence: "none" }), true)).toBe(false);
    // Already imported from an earlier file.
    expect(needsDecision(bank({ decision: "skip", confidence: null, dedupStatus: "dup_external_key" }), true)).toBe(false);
  });

  it("keeps a reviewed row where it was: suggestions and untrusted matches stay on top once decided", () => {
    expect(needsDecision(bank({ decision: "settle", confidence: "suggest" }), true)).toBe(true);
    expect(needsDecision(bank({ decision: "skip", confidence: "suggest" }), true)).toBe(true);
    expect(needsDecision(bank({ decision: "settle", confidence: "auto" }), false)).toBe(true);
    // An unmatched line needs no decision even on an untrusted statement.
    expect(needsDecision(bank({ decision: "create", confidence: "none" }), false)).toBe(false);
  });

  it("keeps lines read with errors or flagged by the AI on top", () => {
    expect(needsDecision(bank({ decision: "skip", parseErrors: 1 }), true)).toBe(true);
    expect(needsDecision(doc({ decision: "create", reviewReasons: 2 }), true)).toBe(true);
  });

  it("shows every new document, and folds the known duplicates", () => {
    expect(needsDecision(doc({ decision: "create" }), true)).toBe(true);
    expect(needsDecision(doc({ decision: "skip" }), true)).toBe(true);
    expect(needsDecision(doc({ decision: "skip", dedupStatus: "dup_external_key" }), true)).toBe(false);
    expect(needsDecision(doc({ decision: "skip", dedupStatus: "already_recorded" }), true)).toBe(false);
  });
});

describe("splitForReview", () => {
  it("splits in order and loses no row", () => {
    const rows = [
      { no: 1, f: bank({ decision: "settle", confidence: "auto" }) },
      { no: 2, f: bank({ decision: "pending", confidence: "suggest" }) },
      { no: 3, f: bank() },
      { no: 4, f: bank({ decision: "skip", parseErrors: 1 }) },
    ];
    const { decide, certain } = splitForReview(rows, (r) => r.f, true);
    expect(decide.map((r) => r.no)).toEqual([2, 4]);
    expect(certain.map((r) => r.no)).toEqual([1, 3]);
  });

  it("puts every matched row on top when the statement is not trusted", () => {
    const rows = [bank({ decision: "settle", confidence: "auto" }), bank()];
    expect(splitForReview(rows, (r) => r, false)).toEqual({ decide: [rows[0]], certain: [rows[1]] });
  });
});
