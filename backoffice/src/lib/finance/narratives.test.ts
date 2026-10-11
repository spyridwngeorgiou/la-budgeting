import { describe, expect, it } from "vitest";
import {
  cashNarrative,
  inMonth,
  netWorthNarrative,
  pnlNarrative,
  portfolioNarrative,
  qualityNarrative,
  trustIndex,
  vatNarrative,
  withholdingNarrative,
} from "./narratives";

describe("narratives", () => {
  it("months in the accusative", () => {
    expect(inMonth("2027-09")).toBe("τον Σεπτέμβριο 2027");
    expect(inMonth("2026-05-31")).toBe("τον Μάιο 2026");
  });

  it("cash: lowest point, driver, first month below the buffer", () => {
    expect(cashNarrative({ lowest: { amount: -1_200_000, month: "2027-09" }, driver: "την κατασκευή του Q003" })).toBe(
      "Το ταμείο πέφτει στο χαμηλότερο −1,2 εκ. € τον Σεπτέμβριο 2027, κυρίως από την κατασκευή του Q003.",
    );
    expect(cashNarrative({ lowest: { amount: 40_000, month: "2027-03" }, firstBelowBuffer: "2027-01", buffer: 100_000 })).toBe(
      "Το ταμείο πέφτει κάτω από το απόθεμα ασφαλείας τον Ιανουάριο 2027 και στο χαμηλότερο 40 κ. € τον Μάρτιο 2027.",
    );
    expect(cashNarrative({ lowest: { amount: 340_000, month: "2027-03" }, buffer: 100_000, horizonMonths: 24 })).toBe(
      "Το ταμείο μένει πάνω από το απόθεμα ασφαλείας τους επόμενους 24 μήνες· χαμηλότερο 340 κ. € τον Μάρτιο 2027.",
    );
  });

  it("P&L: result vs last year and margin", () => {
    expect(pnlNarrative({ year: 2026, revenueYtd: 2_000_000, resultYtd: 360_000, resultLastYearYtd: 300_000 })).toBe(
      "Κέρδος 360 κ. € το 2026 έως τώρα (περιθώριο 18%), 20% καλύτερα από πέρσι.",
    );
    expect(pnlNarrative({ year: 2026, revenueYtd: 0, resultYtd: -50_000, resultLastYearYtd: null })).toBe(
      "Ζημία 50 κ. € το 2026 έως τώρα.",
    );
    // From a loss last year: no percentage on a negative base.
    expect(pnlNarrative({ year: 2026, revenueYtd: 264_870, resultYtd: 71_205, resultLastYearYtd: -65_701 })).toBe(
      "Κέρδος 71 κ. € το 2026 έως τώρα (περιθώριο 26,9%), από ζημία 66 κ. € πέρσι.",
    );
    expect(pnlNarrative({ year: 2026, revenueYtd: 100_000, resultYtd: 10_000, resultLastYearYtd: 20_000 })).toContain(
      "50% χειρότερα από πέρσι",
    );
  });

  it("net worth: net and leverage", () => {
    expect(netWorthNarrative({ assets: 5_000_000, liabilities: 1_900_000 })).toBe(
      "Καθαρή θέση 3,1 εκ. €, από 5 εκ. € περιουσία και 1,9 εκ. € υποχρεώσεις· οι υποχρεώσεις είναι το 38% της περιουσίας.",
    );
  });

  it("VAT: payable with deadline, or credit", () => {
    expect(vatNarrative({ payable: 24_300, deadline: "2026-10-31" })).toBe(
      "Πληρωτέος ΦΠΑ 24 κ. € έως 31/10/2026 για την τρέχουσα περίοδο.",
    );
    expect(vatNarrative({ payable: -5_000 })).toBe("Δεν υπάρχει ΦΠΑ για πληρωμή· πιστωτικό υπόλοιπο 5 κ. € μεταφέρεται.");
    expect(vatNarrative({ payable: 0 })).toBe("Δεν υπάρχει ΦΠΑ για πληρωμή την τρέχουσα περίοδο.");
  });

  it("withholding", () => {
    expect(withholdingNarrative({ month: "2026-10", current: 3_200, last12: 38_000 })).toBe(
      "Τον Οκτώβριο 2026 παρακρατήθηκαν 3 κ. €· 38 κ. € στους τελευταίους 12 μήνες.",
    );
    expect(withholdingNarrative({ month: null, current: 0, last12: 0 })).toBe("Δεν υπάρχουν ακόμα κινήσεις με παρακράτηση.");
  });

  it("quality: trust index", () => {
    expect(trustIndex(18, 20)).toBe(0.9);
    expect(trustIndex(0, 0)).toBe(1);
    expect(qualityNarrative({ passing: 18, total: 20, urgent: 2 })).toBe(
      "Περνούν 18 από 20 ελέγχους (δείκτης εμπιστοσύνης 90%)· 2 θέματα θέλουν άμεση προσοχή.",
    );
    expect(qualityNarrative({ passing: 20, total: 20 })).toBe(
      "Περνούν όλοι οι 20 έλεγχοι (δείκτης εμπιστοσύνης 100%)· κανένα επείγον θέμα.",
    );
  });

  it("portfolio: spend vs budget, over-budget count", () => {
    expect(portfolioNarrative({ budget: 3_500_000, spent: 2_100_000, projects: 7, overBudget: 2 })).toBe(
      "Δαπανήθηκαν 2,1 εκ. € από 3,5 εκ. € (60%) σε 7 έργα· 2 εκτός προϋπολογισμού.",
    );
    expect(portfolioNarrative({ budget: 1_000_000, spent: 400_000, projects: 3, overBudget: 0 })).toBe(
      "Δαπανήθηκαν 400 κ. € από 1 εκ. € (40%) σε 3 έργα· όλα εντός προϋπολογισμού.",
    );
  });
});
