import { describe, expect, it } from "vitest";
import { categoryForHint, compactKey, hintForRow, matchUtility, type CategoryRef, type UtilityRef } from "./hints";

// Invented supply numbers and categories.
const utilities: UtilityRef[] = [
  { projectId: "p-1", projectLabel: "Ακίνητο Α", kind: "electricity", matchKeys: [compactKey("1 11122233-01 4")] },
  { projectId: "p-2", projectLabel: "Ακίνητο Β", kind: "water", matchKeys: [compactKey("W-99887766")] },
  { projectId: "p-3", projectLabel: "Ακίνητο Γ", kind: "other", matchKeys: ["1234"] }, // too short, ignored
];
const categories: CategoryRef[] = [
  { id: "c-income", name: "Ενοίκια", kind: "income" },
  { id: "c-power", name: "Ρεύμα", kind: "expense" },
  { id: "c-bank", name: "Τραπεζικά έξοδα", kind: "expense" },
  { id: "c-water", name: "Ύδρευση", kind: "expense" },
];
const row = (description: string, extra: Partial<Parameters<typeof hintForRow>[0]> = {}) => ({
  description,
  reference: null,
  counterpartyName: null,
  direction: "expense" as const,
  ...extra,
});

describe("utility-number hints", () => {
  it("finds a supply number however the bank spaces it", () => {
    expect(matchUtility(["ΠΛΗΡΩΜΗ ΛΟΓΑΡΙΑΣΜΟΥ ΑΡ. ΠΑΡΟΧΗΣ 111122233014"], utilities)?.projectId).toBe("p-1");
    expect(matchUtility(["ΠΛΗΡΩΜΗ 1 11122233-01 4 ΡΕΥΜΑ"], utilities)?.projectId).toBe("p-1");
    expect(matchUtility(["ΑΓΟΡΑ 1234 ΠΡΑΤΗΡΙΟ"], utilities)).toBeNull();
  });

  it("does not guess when two properties are quoted", () => {
    expect(matchUtility(["111122233014 και W99887766"], utilities)).toBeNull();
  });

  it("suggests the property and the category of its utility kind", () => {
    expect(hintForRow(row("ΠΛΗΡΩΜΗ ΠΑΡΟΧΗΣ 111122233014"), utilities, categories)).toMatchObject({
      projectId: "p-1",
      categoryId: "c-power",
      reason: "utility",
      projectLabel: "Ακίνητο Α",
    });
    expect(hintForRow(row("ΠΑΓΙΑ ΕΝΤΟΛΗ W 99887766"), utilities, categories)).toMatchObject({ projectId: "p-2", categoryId: "c-water" });
  });

  it("gives incoming money no hint", () => {
    expect(hintForRow(row("111122233014", { direction: "income" }), utilities, categories).reason).toBeNull();
  });

  it("puts a bank fee line in «Τραπεζικά»", () => {
    expect(hintForRow(row("ΕΞΟΔΑ ΜΕΤΑΦΟΡΑΣ", { categoryHint: "Τραπεζικά" }), utilities, categories)).toMatchObject({
      reason: "fee",
      categoryId: "c-bank",
      projectId: null,
    });
    expect(categoryForHint({ name: "Τραπεζικά" }, [{ id: "x", name: "Ενοίκια", kind: "income" }])).toBeNull();
  });
});
