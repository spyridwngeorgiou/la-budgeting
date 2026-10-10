import { parseAadeWorkbook } from "@/lib/aade/parse";
import { classifyAadeRows, type AadeLedgerMatches, type StagedRow } from "@/lib/aade/dedup";
import { AADE_DEDUP_TO_INGEST } from "@/lib/aade/commitRules";
import type { StageRow } from "../stage";
import type { IngestAdapter, ParsedBatch, UploadedFile } from "../types";
import { sniffFileKind } from "../xlsx";

// myDATA / AADE export (.xlsx) -> canonical document rows. Parsing and
// dedup are the old importer's own code (lib/aade/parse.ts, dedup.ts), so
// the two paths cannot drift; this file only maps the result onto
// ingest_rows following the rules written down in lib/aade/commitRules.ts
// (R-numbers below). external_key = ΜΑΡΚ, so the committed-key index (0054)
// also refuses the same invoice from a later export.

export const NEGATIVE_AMOUNT_ERROR = "Αρνητικό ποσό (πιστωτικό στοιχείο) — δεν εισάγεται αυτόματα.";

// «2024-03_expenses.xlsx» -> period / kind, display only (R7).
export function aadeFileMeta(filename: string): { period: string | null; kind: "income" | "expenses" | null } {
  const m = filename.match(/^(\d{4})-(\d{2})_(expenses|income)\.xlsx$/i);
  if (!m) return { period: null, kind: null };
  return { period: `${m[1]}-${m[2]}`, kind: m[3].toLowerCase() === "income" ? "income" : "expenses" };
}

export function aadeStagedToStageRows(staged: StagedRow[]): StageRow[] {
  return staged.map((row) => {
    const parseErrors = [...row.parseErrors];
    // R11: amounts as the old commit computed them.
    const net = row.netAmount ?? 0;
    const vat = row.vatAmount ?? 0;
    const wh = row.withholdingAmount ?? 0;
    const gross = row.grossAmount ?? net + vat - wh;
    // R21: ingest_rows only holds positive amounts.
    const negative = [net, vat, wh, gross].some((v) => v < 0);
    if (negative) parseErrors.push(NEGATIVE_AMOUNT_ERROR);
    // R5 + R9: only new, dated rows go in; the rest stay visible, skipped.
    const importable = row.dedupStatus === "new" && !negative && !!row.issueDate;
    return {
      rowNo: row.rowNo,
      kind: "document",
      raw: row.raw,
      extracted: {
        afms: [row.issuerAfm, row.receiverAfm].filter((a): a is string => !!a),
        ibans: [],
        rfs: [],
        marks: row.mydataMark ? [row.mydataMark] : [],
      },
      externalKey: row.mydataMark,
      txDate: row.issueDate,
      valueDate: null,
      direction: row.direction, // R2
      amount: negative ? null : gross,
      netAmount: negative ? null : net,
      vatAmount: negative ? null : vat,
      vatRate: null, // R15
      withholdingAmount: negative ? null : wh,
      otherTaxes: row.otherTaxes ?? 0, // R12
      hasInvoice: vat > 0 || wh > 0, // R13
      status: "paid", // R14 (paid_on stays null)
      scope: "business",
      description: null, // R15
      counterpartyName: row.counterpartyName,
      counterpartyAfm: row.counterpartyAfm,
      counterpartyIban: null,
      reference: null,
      invoiceNumber: row.invoiceNumber,
      mydataMark: row.mydataMark,
      documentType: row.documentType,
      aadeDiscrepancy: row.discrepancy,
      balanceAfter: null,
      parseErrors,
      decision: importable ? "create" : "skip",
      dedupStatus: AADE_DEDUP_TO_INGEST[row.dedupStatus], // R4
      meta: {
        aade_dedup_status: row.dedupStatus,
        matched_transaction_id: row.matchedTransactionId,
        issuer_afm: row.issuerAfm,
        receiver_afm: row.receiverAfm,
        kad_code: row.kadCode,
        kad_description: row.kadDescription,
        digital_fee: row.digitalFee,
        fees: row.fees,
        deductions: row.deductions,
        fingerprint: row.fingerprint,
      },
    };
  });
}

// Parse + classify. `ledger` comes from loadAadeLedgerMatches (DB); without
// it only the in-file passes (self-classification, ΜΑΡΚ twice) run.
export async function parseAadeFile(
  file: UploadedFile,
  ownAfm: string,
  ledger?: AadeLedgerMatches,
): Promise<{ batch: ParsedBatch; rows: StageRow[]; staged: StagedRow[] }> {
  const parsed = await parseAadeWorkbook(file.bytes.slice().buffer as ArrayBuffer);
  const staged = classifyAadeRows(parsed, ownAfm, ledger);
  const rows = aadeStagedToStageRows(staged);
  return { batch: { source: "aade", rows, statement: null, profileId: null, warnings: [] }, rows, staged };
}

export const aadeFileAdapter: IngestAdapter = {
  source: "aade",
  canHandle: (file) => sniffFileKind(file.bytes, file.name) === "xlsx",
  parse: async (file, ctx) => {
    if (!ctx.ownAfm) throw new Error("Ορίστε πρώτα το πραγματικό ΑΦΜ της επιχείρησης στις Ρυθμίσεις.");
    return (await parseAadeFile(file, ctx.ownAfm)).batch;
  },
};
