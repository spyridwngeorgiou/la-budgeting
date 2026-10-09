import { describe, expect, it } from "vitest";
import type { Extraction, NlEntry } from "@/lib/ai/schemas";
import { toIngestRowFields } from "../stage";
import {
  aiCorrections,
  aiExtractionToStageRow,
  cleanMark,
  needsReviewReasons,
  nlEntryToExtraction,
  NO_CONTACT_REASON,
  NO_PROJECT_REASON,
} from "./aiShared";

const money = (value: number | null, evidence: string | null = null) => ({ value, evidence });

const invoice: Extraction = {
  doc_type: "invoice",
  issuer_name: "ΥΔΡΑΥΛΙΚΟΣ Α.Ε.",
  issuer_afm: "094 014 201",
  invoice_number: "ΤΠΥ 55",
  mydata_mark: "4000 0000 0000 123",
  issue_date: "2026-09-30",
  net: money(100, "ΚΑΘΑΡΗ 100,00"),
  vat: money(24, "ΦΠΑ 24,00"),
  gross: money(124, "ΣΥΝΟΛΟ 124,00"),
  vat_rate: 0.24,
  withholding: money(0),
  payment_hint: "bank_transfer",
  project_mention: null,
  supply_number: null,
  suggested_category: null,
  notes_for_human: null,
};

const proposal = { contactId: "c1", projectId: null, categoryId: "k1", contactMatchStrength: "afm" as const };

describe("AI capture -> staged row", () => {
  it("opens with the old review form's defaults and needs a human decision", () => {
    const row = aiExtractionToStageRow({
      rowNo: 1, extraction: invoice, proposal, needsReview: [], model: "m", documentId: "d1", today: "2026-10-09",
    });
    expect(row).toMatchObject({
      kind: "document",
      decision: "pending",
      direction: "expense",
      txDate: "2026-09-30",
      amount: 124,
      netAmount: 100,
      vatAmount: 24,
      vatRate: 0.24,
      hasInvoice: true,
      counterpartyAfm: "094014201",
      mydataMark: "400000000000123",
      documentId: "d1",
      contactId: "c1",
      categoryId: "k1",
      externalKey: null,
    });
    // what the model read is kept verbatim, evidence included
    expect(toIngestRowFields(row).raw).toMatchObject({ gross: { value: 124, evidence: "ΣΥΝΟΛΟ 124,00" } });
  });

  it("derives a consistent total and flags an unreadable amount", () => {
    const cash = aiExtractionToStageRow({
      rowNo: 1,
      extraction: { ...invoice, vat: money(null), net: money(null), gross: money(50), vat_rate: null, issue_date: "30/09" },
      proposal, needsReview: [], model: "m", documentId: null, today: "2026-10-09",
    });
    expect(cash).toMatchObject({ amount: 50, netAmount: 50, vatAmount: 0, hasInvoice: false, vatRate: null, txDate: "2026-10-09" });
    const empty = aiExtractionToStageRow({
      rowNo: 1, extraction: { ...invoice, net: money(null), gross: money(null), vat: money(null) },
      proposal, needsReview: [], model: "m", documentId: null, today: "2026-10-09",
    });
    expect(empty.amount).toBeNull();
    expect(empty.parseErrors).toHaveLength(1);
  });

  it("turns a text entry into an extraction backed out from the gross", () => {
    const entry: NlEntry = {
      direction: "expense",
      counterparty_name: "υδραυλικός",
      amount: { value: 124, evidence: "124 ευρώ" },
      has_invoice: true,
      vat_rate: 0.24,
      issue_date: null,
      project_mention: "Q003",
      suggested_category: null,
      notes_for_human: null,
    };
    const e = nlEntryToExtraction(entry, "124 ευρώ στον υδραυλικό", "Περιγραφή", "2026-10-09");
    expect(e).toMatchObject({ issue_date: "2026-10-09", net: { value: 100 }, vat: { value: 24 }, gross: { value: 124 } });
    expect(e.notes_for_human).toBe("Περιγραφή: «124 ευρώ στον υδραυλικό»");
  });

  it("adds the missing-contact/project reasons", () => {
    expect(needsReviewReasons(["x"], { ...proposal, contactId: null })).toEqual(["x", NO_CONTACT_REASON, NO_PROJECT_REASON]);
  });

  it("diffs AI-read values against the committed row like approveDraft did", () => {
    expect(
      aiCorrections({
        raw: invoice,
        net_amount: 100,
        vat_amount: 23,
        tx_date: "2026-09-29",
        mydata_mark: cleanMark(invoice.mydata_mark),
        counterparty_afm: "094014201",
      }),
    ).toEqual([
      { field: "vat_amount", ai_value: 24, human_value: 23 },
      { field: "issue_date", ai_value: "2026-09-30", human_value: "2026-09-29" },
      { field: "issuer_afm", ai_value: "094 014 201", human_value: "094014201" },
    ]);
  });
});
