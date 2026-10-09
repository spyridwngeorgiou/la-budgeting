import { describe, it, expect } from "vitest";
import {
  normalizeGreek,
  nameTokens,
  parseGreekNumber,
  parseDate,
  extractAfm,
  extractAfms,
  extractIban,
  isValidIban,
  extractRf,
  isValidRf,
  extractMarks,
} from "./text";

// Synthetic identifiers only: AFMs/IBANs/RFs below were generated to pass
// their checksums and belong to nobody.

describe("normalizeGreek", () => {
  it("uppercases, strips accents/diaeresis, folds final sigma, collapses spaces", () => {
    expect(normalizeGreek("  Ημ/νία   Αξίας ")).toBe("ΗΜ/ΝΙΑ ΑΞΙΑΣ");
    expect(normalizeGreek("Παπαδόπουλος")).toBe("ΠΑΠΑΔΟΠΟΥΛΟΣ");
    expect(normalizeGreek("Ϊάσων προϋπολογισμός")).toBe("ΙΑΣΩΝ ΠΡΟΥΠΟΛΟΓΙΣΜΟΣ");
    expect(normalizeGreek(null)).toBe("");
  });

  it("drops company-form noise from name tokens", () => {
    expect(nameTokens("ΔΕΗ Α.Ε.")).toEqual(["ΔΕΗ"]);
    expect(nameTokens("Τεχνική Κατασκευαστική ΙΚΕ")).toEqual(["ΤΕΧΝΙΚΗ", "ΚΑΤΑΣΚΕΥΑΣΤΙΚΗ"]);
  });
});

describe("parseGreekNumber", () => {
  it.each([
    ["1.234,56", 1234.56],
    ["-1.234,56", -1234.56],
    ["1.234,56-", -1234.56],
    ["(1.234,56)", -1234.56],
    ["+12,00", 12],
    ["€ 1.234,56", 1234.56],
    ["1 234,56", 1234.56],
    ["1 234,56", 1234.56],
    ["0,35", 0.35],
    ["2,00-", -2],
    ["12.345.678", 12345678],
  ])("reads %s with a decimal comma", (input, expected) => {
    expect(parseGreekNumber(input, { decimal: "," })).toBe(expected);
  });

  it("auto-detects the decimal mark when the profile does not say", () => {
    expect(parseGreekNumber("1.234,56")).toBe(1234.56);
    expect(parseGreekNumber("1,234.56")).toBe(1234.56);
    expect(parseGreekNumber("12,5")).toBe(12.5);
    expect(parseGreekNumber("12.5")).toBe(12.5);
    expect(parseGreekNumber("1.234")).toBe(1234); // Greek thousands, not 1.234
  });

  it("honours an explicit decimal point", () => {
    expect(parseGreekNumber("1,987.50", { decimal: "." })).toBe(1987.5);
  });

  it("passes numbers through and refuses garbage instead of returning 0", () => {
    expect(parseGreekNumber(-60)).toBe(-60);
    expect(parseGreekNumber("")).toBeNull();
    expect(parseGreekNumber(null)).toBeNull();
    expect(parseGreekNumber("abc")).toBeNull();
    expect(parseGreekNumber("1,2,3", { decimal: "," })).toBeNull();
    expect(parseGreekNumber("-")).toBeNull();
  });
});

describe("parseDate", () => {
  it("reads Greek day-first dates, never month-first", () => {
    expect(parseDate("05/03/2026")).toBe("2026-03-05");
    expect(parseDate("5-3-2026")).toBe("2026-03-05");
    expect(parseDate("05.03.2026 14:22")).toBe("2026-03-05");
    expect(parseDate("05/03/26")).toBe("2026-03-05");
  });

  it("supports the other profile formats", () => {
    expect(parseDate("2026-03-05", "yyyy-MM-dd")).toBe("2026-03-05");
    expect(parseDate("03/05/2026", "MM/dd/yyyy")).toBe("2026-03-05");
    expect(parseDate("05/03/26", "dd/MM/yy")).toBe("2026-03-05");
  });

  it("rejects impossible dates", () => {
    expect(parseDate("31/02/2026")).toBeNull();
    expect(parseDate("13/13/2026")).toBeNull();
    expect(parseDate("ΣΥΝΟΛΑ")).toBeNull();
    expect(parseDate("")).toBeNull();
  });

  it("takes Date cells at their UTC day and numbers as Excel serials", () => {
    expect(parseDate(new Date("2026-03-05T00:00:00Z"))).toBe("2026-03-05");
    expect(parseDate(46086)).toBe("2026-03-05");
  });
});

describe("extractAfm", () => {
  it("finds a checksum-valid ΑΦΜ, labelled ones first", () => {
    expect(extractAfm("ΚΑΤΑΘΕΣΗ ΑΦΜ: 800123456")).toBe("800123456");
    expect(extractAfm("ΤΙΜ 123456783 ΑΦΜ 800123456")).toBe("800123456");
    expect(extractAfms("123456783 και 998877666")).toEqual(["123456783", "998877666"]);
  });

  it("ignores invalid checksums and digits inside longer numbers", () => {
    expect(extractAfm("ΑΦΜ 123456789")).toBeNull();
    expect(extractAfm("ΜΑΡΚ 400008883252876")).toBeNull();
    expect(extractAfm("GR1201101250000000012345678")).toBeNull();
  });
});

describe("IBAN / RF / ΜΑΡΚ", () => {
  it("validates IBAN checksums and the Greek length", () => {
    expect(isValidIban("GR12 0110 1250 0000 0001 2345 678")).toBe(true);
    expect(isValidIban("GR13 0110 1250 0000 0000 1234 5678")).toBe(false);
    expect(isValidIban("GR120110125000000001234567")).toBe(false);
  });

  it("extracts a spaced IBAN out of a description, compacted", () => {
    expect(extractIban("ΑΠΟ: ΞΕΝΟΔΟΧΕΙΑΚΗ ΙΚΕ; IBAN GR51 0260 0000 0000 0012 3456 789 ΕΜΒΑΣΜΑ")).toBe(
      "GR5102600000000000123456789",
    );
  });

  it("extracts an RF creditor reference", () => {
    expect(isValidRf("RF18 5390 0754 7034")).toBe(true);
    expect(isValidRf("RF19539007547034")).toBe(false);
    expect(extractRf("ΠΛΗΡΩΜΗ ΔΕΗ RF18539007547034")).toBe("RF18539007547034");
    expect(extractRf("ΠΛΗΡΩΜΗ RF49 2024 0001 23 ΕΦΚΑ")).toBe("RF492024000123");
  });

  it("finds 15-digit marks only as whole numbers", () => {
    expect(extractMarks("ΜΑΡΚ 400008883252876")).toEqual(["400008883252876"]);
    expect(extractMarks("4000088832528761")).toEqual([]);
  });
});
