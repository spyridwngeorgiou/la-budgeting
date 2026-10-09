import type { AadeParsedRow } from "../parse";

// One AADE export, as parse.ts returns it, covering every commit rule in
// commitRules.ts: VAT, income by own ΑΦΜ, withholding, other taxes/fees with
// a total that is not net + VAT − wh, ΜΑΡΚ twice, the myDATA blank-ΑΦΜ
// stand-in, a VAT-only row, a zero row, a row without counterparty ΑΦΜ and a
// row with no total. Both commit paths are fed from this (see
// src/lib/ingest/adapters/aadeFile.test.ts and
// supabase/tests/0071_aade_commit_parity.test.sql).

export const PARITY_OWN_AFM = "999999999";
// The assignment a reviewer makes before committing (fixed ids that the
// pgTAP test creates).
export const PARITY_ASSIGNMENT = {
  projectId: "71000000-0000-0000-0000-000000000001",
  categoryId: "71000000-0000-0000-0000-000000000002",
  accountId: "71000000-0000-0000-0000-000000000003",
};

function row(rowNo: number, fields: Partial<AadeParsedRow>): AadeParsedRow {
  return {
    rowNo,
    raw: { row: rowNo },
    issueDate: null,
    mydataMark: null,
    invoiceNumber: null,
    documentType: "Τιμολόγιο Πώλησης",
    issuerAfm: null,
    receiverAfm: null,
    counterpartyName: null,
    kadCode: null,
    kadDescription: null,
    netAmount: null,
    grossAmount: null,
    vatAmount: null,
    withholdingAmount: null,
    digitalFee: null,
    fees: null,
    otherTaxes: null,
    deductions: null,
    discrepancy: null,
    parseErrors: [],
    ...fields,
  };
}

const OWN = PARITY_OWN_AFM;

export const PARITY_ROWS: AadeParsedRow[] = [
  row(2, { issueDate: "2026-03-02", mydataMark: "400000000000001", invoiceNumber: "ΤΔΑ/1", documentType: "Τιμολόγιο Παροχής Υπηρεσιών",
    issuerAfm: "111111111", receiverAfm: OWN, counterpartyName: "ΠΡΟΜΗΘΕΥΤΗΣ ΑΛΦΑ", netAmount: 100, vatAmount: 24, grossAmount: 124, withholdingAmount: 0 }),
  row(3, { issueDate: "2026-03-03", mydataMark: "400000000000002", invoiceNumber: "Α/7",
    issuerAfm: OWN, receiverAfm: "222222222", counterpartyName: "ΠΕΛΑΤΗΣ ΒΗΤΑ", netAmount: 1000, vatAmount: 0, grossAmount: 1000 }),
  row(4, { issueDate: "2026-03-04", mydataMark: "400000000000003", invoiceNumber: "Α/8", discrepancy: "Απόκλιση",
    issuerAfm: OWN, receiverAfm: "333333333", counterpartyName: "ΠΕΛΑΤΗΣ ΓΑΜΜΑ", netAmount: 1000, vatAmount: 240, withholdingAmount: 200, grossAmount: 1040 }),
  row(5, { issueDate: "2026-03-05", mydataMark: "400000000000004", invoiceNumber: "ΤΔΑ/2",
    issuerAfm: "111111111", receiverAfm: OWN, counterpartyName: "ΠΡΟΜΗΘΕΥΤΗΣ ΑΛΦΑ", netAmount: 50, vatAmount: 12, otherTaxes: 3, fees: 1, grossAmount: 66 }),
  // ΜΑΡΚ of row 2 again (overlapping exports) -> dup_in_batch
  row(6, { issueDate: "2026-03-06", mydataMark: "400000000000001", invoiceNumber: "Χ/1",
    issuerAfm: "444444444", receiverAfm: OWN, counterpartyName: "ΑΛΛΟΣ", netAmount: 10, vatAmount: 2.4, grossAmount: 12.4 }),
  // myDATA stand-in for row 2: blank issuer ΑΦΜ -> dup_self_classification
  row(7, { issueDate: "2026-03-02", mydataMark: "400000000000005", receiverAfm: OWN, netAmount: 100, vatAmount: 24, grossAmount: 124, withholdingAmount: 0 }),
  // VAT-only document
  row(8, { issueDate: "2026-03-08", mydataMark: "400000000000007", invoiceNumber: "ΠΦ/1",
    issuerAfm: "555555555", receiverAfm: OWN, counterpartyName: "ΕΦΟΡΙΑ ΔΙΑΦΟΡΑ", netAmount: 0, vatAmount: 24, grossAmount: 24 }),
  // zero-value document
  row(9, { issueDate: "2026-03-09", mydataMark: "400000000000008", invoiceNumber: "Δ/1",
    issuerAfm: "666666666", receiverAfm: OWN, counterpartyName: "ΔΩΡΕΑΝ", netAmount: 0, vatAmount: 0, grossAmount: 0 }),
  // no counterparty ΑΦΜ and no sibling -> imported, no contact
  row(10, { issueDate: "2026-03-10", mydataMark: "400000000000009", invoiceNumber: "ΑΛΠ/9",
    receiverAfm: OWN, counterpartyName: "ΛΙΑΝΙΚΗ ΠΩΛΗΣΗ", netAmount: 20, vatAmount: 4.8, grossAmount: 24.8 }),
  // no total in the file -> net + VAT − wh
  row(11, { issueDate: "2026-03-11", mydataMark: "400000000000010", invoiceNumber: "ΤΔΑ/3",
    issuerAfm: "777777777", receiverAfm: OWN, counterpartyName: "ΠΡΟΜΗΘΕΥΤΗΣ ΔΕΛΤΑ", netAmount: 80, vatAmount: 19.2, withholdingAmount: 0 }),
];
