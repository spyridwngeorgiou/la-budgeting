import { describe, expect, it } from "vitest";
import { rankAttention, type AttentionItem, type AttentionKind } from "./attention";

const item = (kind: AttentionKind, label: string = kind): AttentionItem => ({ kind, label, href: "/x" });

describe("rankAttention", () => {
  it("orders by severity: cash → overdue → inbox → VAT → drift → budget → uninvoiced", () => {
    const { shown, more } = rankAttention(
      [
        item("uninvoiced"),
        item("overBudget"),
        item("accountDrift"),
        item("vatUnfiled"),
        item("inbox"),
        item("overdue"),
        item("cashBelowBuffer"),
      ],
      10,
    );
    expect(shown.map((x) => x.kind)).toEqual([
      "cashBelowBuffer",
      "overdue",
      "inbox",
      "vatUnfiled",
      "accountDrift",
      "overBudget",
      "uninvoiced",
    ]);
    expect(more).toBe(0);
  });

  it("caps at 5 and counts the rest", () => {
    const { shown, more } = rankAttention([
      item("contactless"),
      item("uninvoiced"),
      item("vatUnfiled"),
      item("overdue"),
      item("accountDrift"),
      item("missingProjectOrAccount"),
      item("inbox"),
    ]);
    expect(shown.map((x) => x.kind)).toEqual(["overdue", "inbox", "vatUnfiled", "accountDrift", "uninvoiced"]);
    expect(more).toBe(2);
  });

  it("drops empty checks and keeps input order on ties", () => {
    const { shown, more } = rankAttention([
      false,
      item("accountDrift", "A"),
      null,
      item("accountDrift", "B"),
      undefined,
    ]);
    expect(shown.map((x) => x.label)).toEqual(["A", "B"]);
    expect(more).toBe(0);
  });

  it("nothing pending → nothing shown", () => {
    expect(rankAttention([false, false])).toEqual({ shown: [], more: 0 });
  });
});
