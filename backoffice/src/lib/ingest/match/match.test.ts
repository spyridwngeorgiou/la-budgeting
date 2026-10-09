import { describe, it, expect } from "vitest";
import { extractRefs } from "../text";
import { assignMatches, subsetsSummingTo } from "./assign";
import { confidenceOf, rankCandidates, scoreCandidate, type MatchCandidate, type MatchMovement } from "./score";

function candidate(over: Partial<MatchCandidate> & { id: string }): MatchCandidate {
  return {
    direction: "expense",
    status: "pending",
    grossAmount: 100,
    txDate: "2026-03-01",
    dueDate: null,
    paidOn: null,
    accountId: null,
    invoiceNumber: null,
    mydataMark: null,
    bankReference: null,
    counterpartyAfm: null,
    counterpartyName: null,
    contactName: null,
    contactAfm: null,
    contactIban: null,
    planId: null,
    description: null,
    ingestRowId: null,
    ...over,
  };
}

function movement(over: Partial<MatchMovement> = {}): MatchMovement {
  const m: MatchMovement = {
    direction: "expense",
    amount: 100,
    txDate: "2026-03-02",
    description: null,
    counterpartyName: null,
    counterpartyIban: null,
    reference: null,
    extracted: { afms: [], ibans: [], rfs: [], marks: [] },
    ...over,
  };
  if (!over.extracted) m.extracted = extractRefs(m.description, m.reference, m.counterpartyName, m.counterpartyIban);
  return m;
}

const codes = (s: { reasons: { code: string }[] } | null) => s?.reasons.map((r) => r.code);

describe("scoreCandidate: points table", () => {
  it.each([
    ["exact amount only, date far", movement({ txDate: "2026-06-01" }), candidate({ id: "a" }), 40, ["amount_exact"]],
    ["exact amount + date ≤3d", movement(), candidate({ id: "a" }), 50, ["amount_exact", "date"]],
    [
      "invoice number in the description",
      movement({ description: "ΕΜΒΑΣΜΑ ΤΔΑ 129" }),
      candidate({ id: "a", invoiceNumber: "ΤΔΑ/129" }),
      80,
      ["amount_exact", "reference", "date"],
    ],
    [
      "IBAN of the contact",
      movement({ counterpartyIban: "GR8601720000000000098765432" }),
      candidate({ id: "a", contactIban: "GR86 0172 0000 0000 0009 8765 432" }),
      75,
      ["amount_exact", "iban", "date"],
    ],
    [
      "ΑΦΜ in the text",
      movement({ description: "ΚΑΤΑΘΕΣΗ ΑΦΜ 800123456" }),
      candidate({ id: "a", counterpartyAfm: "800123456" }),
      70,
      ["amount_exact", "afm", "date"],
    ],
    [
      "full name, truncated by the bank",
      movement({ description: "ΕΜΒΑΣΜΑ ΠΡΟΣ ΤΕΧΝΙΚΗ ΚΑΤΑΣΚΕΥΑΣΤ" }),
      candidate({ id: "a", contactName: "Τεχνική Κατασκευαστική ΑΕ" }),
      65,
      ["amount_exact", "name", "date"],
    ],
    [
      "installment due the same week",
      movement(),
      candidate({ id: "a", planId: "plan-1", dueDate: "2026-03-01" }),
      55,
      ["amount_exact", "date", "plan"],
    ],
    [
      "partial payment of a larger open amount",
      movement({ amount: 40, description: "ΕΝΑΝΤΙ ΤΔΑ/129" }),
      candidate({ id: "a", invoiceNumber: "ΤΔΑ/129" }),
      50,
      ["amount_partial", "reference", "date"],
    ],
  ])("%s", (_label, m, c, score, reasonCodes) => {
    const s = scoreCandidate(m, c);
    expect(s?.score).toBe(score);
    expect(codes(s)).toEqual(reasonCodes);
  });

  it("an invoice number does not match inside an amount or a longer number", () => {
    const c = candidate({ id: "a", invoiceNumber: "129" });
    expect(codes(scoreCandidate(movement({ description: "ΠΛΗΡΩΜΗ 1.290,00" }), c))).not.toContain("reference");
    expect(codes(scoreCandidate(movement({ description: "ΠΛΗΡΩΜΗ 51290" }), c))).not.toContain("reference");
    expect(codes(scoreCandidate(movement({ description: "ΤΙΜ 0129" }), c))).toContain("reference");
  });

  it("matches ΜΑΡΚ and an RF bank reference", () => {
    const mark = scoreCandidate(movement({ description: "ΠΛΗΡΩΜΗ 400008883252876" }), candidate({ id: "a", mydataMark: "400008883252876" }));
    expect(codes(mark)).toContain("reference");
    const rf = scoreCandidate(movement({ description: "ΔΕΗ RF18539007547034" }), candidate({ id: "a", bankReference: "RF18 5390 0754 7034" }));
    expect(codes(rf)).toContain("reference");
  });

  it("rules out impossible candidates", () => {
    expect(scoreCandidate(movement(), candidate({ id: "a", direction: "income" }))).toBeNull();
    expect(scoreCandidate(movement(), candidate({ id: "a", status: "cancelled" }))).toBeNull();
    expect(scoreCandidate(movement({ amount: 150 }), candidate({ id: "a" }))).toBeNull(); // overpays one row
    expect(scoreCandidate(movement({ txDate: null }), candidate({ id: "a" }))).toBeNull();
  });

  it("detects an already-recorded payment, but only exact, near, and unclaimed", () => {
    const paid = candidate({ id: "p", status: "paid", paidOn: "2026-03-03" });
    expect(scoreCandidate(movement(), paid)?.kind).toBe("already_recorded");
    expect(scoreCandidate(movement({ amount: 99 }), paid)).toBeNull();
    expect(scoreCandidate(movement({ txDate: "2026-04-01" }), paid)).toBeNull();
    expect(scoreCandidate(movement(), { ...paid, ingestRowId: "row-x" })).toBeNull();
  });
});

describe("rankCandidates / confidence", () => {
  it("penalises ambiguity when several rows match on amount alone", () => {
    const ranked = rankCandidates(movement(), [candidate({ id: "a" }), candidate({ id: "b", txDate: "2026-02-28" })]);
    expect(ranked.map((r) => r.score)).toEqual([35, 35]);
    expect(ranked.every((r) => codes(r)?.includes("ambiguous"))).toBe(true);
  });

  it("does not penalise the candidate with hard evidence", () => {
    const ranked = rankCandidates(movement({ description: "ΤΔΑ/129" }), [
      candidate({ id: "a" }),
      candidate({ id: "b", invoiceNumber: "ΤΔΑ/129" }),
    ]);
    expect(ranked[0].candidate.id).toBe("b");
    expect(ranked[0].score).toBe(80);
    expect(ranked[1].score).toBe(35);
  });

  it("applies the 75 / 15-gap / 45 thresholds", () => {
    expect(confidenceOf(80, null)).toBe("auto");
    expect(confidenceOf(80, 65)).toBe("auto");
    expect(confidenceOf(80, 66)).toBe("suggest");
    expect(confidenceOf(74, null)).toBe("suggest");
    expect(confidenceOf(45, null)).toBe("suggest");
    expect(confidenceOf(44, null)).toBe("none");
  });
});

describe("assignMatches", () => {
  it("claims each transaction once, best score first, so a weaker line cannot steal it", () => {
    // Both lines could be the payment of "inv"; the second one quotes the
    // invoice number, the first only the name. Another row "other" matches
    // the amount only.
    const inv = candidate({ id: "inv", invoiceNumber: "ΤΔΑ/500", contactName: "ΑΛΦΑ ΤΕΧΝΙΚΗ" });
    const other = candidate({ id: "other", txDate: "2026-02-20" });
    const result = assignMatches(
      [movement({ description: "ΠΛΗΡΩΜΗ ΑΛΦΑ ΤΕΧΝΙΚΗ" }), movement({ description: "ΤΔΑ/500" })],
      [inv, other],
    );
    expect(result[1]).toMatchObject({ decision: "settle", targets: ["inv"], confidence: "auto", score: 80 });
    expect(result[0]).toMatchObject({ decision: "create", targets: [] });
    expect(result[0].matches[0].transactionIds).toEqual(["inv"]);
  });

  it("maps match kinds onto decisions", () => {
    const result = assignMatches(
      [
        movement({ amount: 40, description: "ΕΝΑΝΤΙ ΤΔΑ/129" }),
        movement({ direction: "income", amount: 300, description: "ΚΑΤΑΘΕΣΗ ΠΕΛΑΤΗΣ ΓΑΜΜΑ" }),
        movement({ amount: 7.5, description: "ΠΡΟΜΗΘΕΙΑ" }),
      ],
      [
        candidate({ id: "big", invoiceNumber: "ΤΔΑ/129" }),
        candidate({ id: "rec", direction: "income", status: "paid", grossAmount: 300, paidOn: "2026-03-02", contactName: "ΓΑΜΜΑ" }),
      ],
    );
    expect(result.map((r) => r.decision)).toEqual(["settle_partial", "link_existing", "create"]);
    expect(result[2]).toMatchObject({ confidence: "none", targets: [] });
  });

  it("finds one payment covering several invoices of the same counterparty", () => {
    const result = assignMatches(
      [movement({ amount: 1860, txDate: "2026-03-20", description: "ΠΛΗΡΩΜΗ ΠΡΟΣ ΓΕΩΤΕΧΝΙΚΗ ΕΠΕ ΤΙΜ 1001 ΤΙΜ 1002" })],
      [
        candidate({ id: "t1", grossAmount: 1240, invoiceNumber: "1001", contactName: "ΓΕΩΤΕΧΝΙΚΗ ΕΠΕ", txDate: "2026-03-01" }),
        candidate({ id: "t2", grossAmount: 620, invoiceNumber: "1002", contactName: "ΓΕΩΤΕΧΝΙΚΗ ΕΠΕ", txDate: "2026-03-05" }),
        candidate({ id: "t3", grossAmount: 620, contactName: "ΑΛΛΟΣ ΠΡΟΜΗΘΕΥΤΗΣ", txDate: "2026-03-05" }),
        candidate({ id: "t4", grossAmount: 1860, direction: "income" }),
      ],
    );
    expect(result[0].decision).toBe("settle_many");
    expect([...result[0].targets].sort()).toEqual(["t1", "t2"]);
    expect(result[0].confidence).toBe("suggest");
    expect(result[0].reasons[0]).toMatchObject({ code: "amount_sum", points: 40 });
  });

  it("does not sum strangers' invoices into a match", () => {
    const result = assignMatches(
      [movement({ amount: 300, description: "ΕΜΒΑΣΜΑ" })],
      [candidate({ id: "x", grossAmount: 100 }), candidate({ id: "y", grossAmount: 200 })],
    );
    expect(result[0].decision).toBe("create");
  });
});

describe("subsetsSummingTo", () => {
  it("finds exact-cent subsets of 2..5 items", () => {
    expect(subsetsSummingTo([0.1, 0.2, 0.3], 0.3)).toEqual([[1, 0]]);
    expect(subsetsSummingTo([5, 5, 5, 5, 5, 5], 30)).toEqual([]); // needs 6 > MAX_SUBSET
    expect(subsetsSummingTo([10, 20, 30, 40], 100)).toEqual([[3, 2, 1, 0]]);
    expect(subsetsSummingTo([100], 100)).toEqual([]); // a single item is a 1:1 match, not "many"
  });
});
