import type { Json } from "@/lib/db/types";
import type { StagedRow } from "./dedup";

// ---------------------------------------------------------------------------
// Every rule the old AADE importer (src/app/(app)/aade/actions.ts:
// uploadAadeFile + commitBatch, tables aade_import_batches/aade_staging_rows)
// applies, written down before that path is retired (plan Φάση 7). Each
// line says where the unified path (aadeFile adapter -> ingest_rows ->
// commit_ingest_batch, migration 0071) reproduces it. The side-by-side
// test (supabase/tests/0071_aade_commit_parity.test.sql, fed by
// src/lib/ingest/adapters/aadeFile.test.ts) commits one fixture both ways
// and diffs the resulting transactions.
//
// Upload / staging
//  R1  Own ΑΦΜ required: upload refused while orgs.own_afm is missing or
//      000000000. -> same check in the unified upload action.
//  R2  Direction is derived, never read from the file name/sheet: issuer ==
//      own ΑΦΜ -> income (counterparty = receiver), else expense
//      (counterparty = issuer). -> classifyAadeRows (dedup.ts), shared.
//  R3  ID cleaning: ΜΑΡΚ/ΑΦΜ/ΚΑΔ digits only, ΑΦΜ padded to 9, "…​.0"
//      Excel artefact stripped; DD/MM/YYYY dates. -> parse.ts, shared.
//  R4  Dedup passes: dup_mark (ΜΑΡΚ already on a transaction),
//      dup_fingerprint (same date/ΑΦΜ/gross/ΜΑΡΚ fingerprint already on a
//      transaction), dup_self_classification (myDATA blank-ΑΦΜ stand-in
//      next to the real row), dup_in_batch (ΜΑΡΚ twice in the file).
//      -> classifyAadeRows, shared; the original status is kept in
//      ingest_rows.meta.aade_dedup_status, mapped onto ingest_dedup_status
//      by AADE_DEDUP_TO_INGEST below.
//  R5  Only `new` rows are imported; every duplicate is skipped.
//      -> decision 'create' for new, 'skip' otherwise.
//  R6  The same file twice is refused (sha256). -> ingest_batches_file_uq
//      plus a pre-check against both ingest_batches and aade_import_batches.
//  R7  Period/kind parsed from «YYYY-MM_(expenses|income).xlsx», display
//      only. -> ingest_batches.meta.period / meta.kind.
//
// Commit
//  R8  The whole commit is refused while any importable row lacks a project
//      or an account. -> commit_ingest_batch, source 'aade' (hint
//      missing_assignment), same message.
//  R9  A row without issue date or direction is never written.
//      -> commit_ingest_batch «λείπει ημερομηνία, κατεύθυνση ή ποσό».
//  R10 Contact: found by (org, counterparty ΑΦΜ), else created with the
//      counterparty name (or the ΑΦΜ); none without an ΑΦΜ.
//      -> commit_ingest_batch, source 'aade', when contact_id is empty.
//  R11 Money: net = net ?? 0, vat = vat ?? 0, withholding = wh ?? 0,
//      gross = gross ?? net + vat − wh. The identity net + vat − wh = gross
//      is NOT enforced: a myDATA total also carries fees, other taxes and
//      the digital fee. -> adapter fills the four amounts; commit skips the
//      identity check for source 'aade'. Zero amounts (VAT-only or
//      zero-value documents) are imported as-is -> commit allows amount 0
//      for 'aade' only.
//  R12 other_taxes = ΑΛΛΟΙ ΦΟΡΟΙ ?? 0 (fees, digital fee and deductions are
//      not carried). -> ingest_rows.other_taxes.
//  R13 has_invoice = vat > 0 || withholding > 0 -- NOT "it is a document".
//      -> ingest_rows.has_invoice set explicitly by the adapter.
//  R14 status = 'paid' (staging default) with paid_on left NULL, which
//      tx_paid_needs_date allows for origin 'aade' only.
//      -> adapter status 'paid'; commit keeps paid_on = row.paid_on for 'aade'.
//  R15 Copied as-is: tx_date = issue date, counterparty ΑΦΜ/name,
//      invoice_number, mydata_mark, document_type, aade_discrepancy,
//      scope (default business), origin 'aade'. Not set: description,
//      vat_rate, due_date, bank_reference. -> adapter + new ingest_rows
//      columns document_type / aade_discrepancy.
//  R16 ΜΑΡΚ or fingerprint collision (tx_mark_uq / tx_fingerprint_uq) is
//      reported in words (el.ingest.markExists / aadeFingerprintExists).
//      -> commit_ingest_batch pre-checks both with the same messages.
//  R17 commit_error (0050): a failing row is recorded on the row, the others
//      still commit, the batch stays a draft and a retry only re-tries the
//      rows not yet in. CHANGED ON PURPOSE: commit_ingest_batch is
//      all-or-nothing and returns the failing row number + reason, so
//      nothing can be silently missing (the reason commit_error existed).
//      Retry-only-the-rest survives for half-committed legacy batches: the
//      commit loop only takes rows with committed_at null (0073 backfill).
//  R18 The batch is «Ολοκληρώθηκε» only with every row in. -> atomic commit.
//  R19 Link back: transactions.aade_staging_row_id. -> transactions.ingest_row_id
//      (0073 links the legacy rows too).
//  R20 created_by stays NULL. CHANGED ON PURPOSE: commit_ingest_batch records
//      auth.uid(), like every other ingest source. Excluded from the parity diff.
//  R21 Negative amounts (credit notes) were staged but always failed the
//      transactions check at commit, leaving the batch a draft forever.
//      ingest_rows rejects negatives, so the adapter stages them with no
//      amount, a parse error and decision 'skip' -- same ledger outcome
//      (not imported), and the rest of the file can be committed.
// ---------------------------------------------------------------------------

// R4: how each AADE dedup status lands on the shared ingest_dedup_status.
export const AADE_DEDUP_TO_INGEST = {
  new: "new",
  dup_mark: "already_recorded",
  dup_fingerprint: "already_recorded",
  dup_self_classification: "dup_in_file",
  dup_in_batch: "dup_in_file",
} as const;

// What uploadAadeFile writes to aade_staging_rows for one staged row
// (org_id/batch_id added by the caller). Kept here so the parity test feeds
// the old path exactly what production does.
export function toAadeStagingRow(row: StagedRow) {
  return {
    row_no: row.rowNo,
    // Round-trip through JSON so Date/etc. values from ExcelJS become
    // plain JSON-safe data before going into a jsonb column.
    raw: JSON.parse(JSON.stringify(row.raw)) as Json,
    issue_date: row.issueDate,
    mydata_mark: row.mydataMark,
    invoice_number: row.invoiceNumber,
    document_type: row.documentType,
    issuer_afm: row.issuerAfm,
    receiver_afm: row.receiverAfm,
    counterparty_afm: row.counterpartyAfm,
    counterparty_name: row.counterpartyName,
    kad_code: row.kadCode,
    kad_description: row.kadDescription,
    net_amount: row.netAmount,
    gross_amount: row.grossAmount,
    vat_amount: row.vatAmount,
    withholding_amount: row.withholdingAmount,
    digital_fee: row.digitalFee,
    fees: row.fees,
    other_taxes: row.otherTaxes,
    deductions: row.deductions,
    discrepancy: row.discrepancy,
    direction: row.direction,
    fingerprint: row.fingerprint,
    dedup_status: row.dedupStatus,
    matched_transaction_id: row.matchedTransactionId,
    decision: (row.dedupStatus === "new" ? "import" : "skip") as "import" | "skip",
    parse_errors: row.parseErrors,
  };
}

// The aade_staging_rows columns commitBatch reads.
export interface LegacyStagingRow {
  id: string;
  issue_date: string | null;
  direction: "income" | "expense" | null;
  counterparty_afm: string | null;
  counterparty_name: string | null;
  project_id: string | null;
  category_id: string | null;
  account_id: string | null;
  scope: "business" | "personal" | null;
  status: "paid" | "pending" | "scheduled" | "cancelled" | null;
  net_amount: number | null;
  gross_amount: number | null;
  vat_amount: number | null;
  withholding_amount: number | null;
  other_taxes: number | null;
  invoice_number: string | null;
  mydata_mark: string | null;
  document_type: string | null;
  discrepancy: string | null;
}

// R8
export function aadeRowsMissingAssignment(rows: Pick<LegacyStagingRow, "project_id" | "account_id">[]): number {
  return rows.filter((r) => !r.project_id || !r.account_id).length;
}

export const aadeMissingAssignmentMessage = (n: number) =>
  `${n} γραμμή/ες δεν έχουν έργο ή λογαριασμό. Συμπληρώστε πριν την οριστικοποίηση.`;

// R9-R15, R19, R20: the transactions row commitBatch inserts for one
// staging row (the caller has checked issue_date/direction and resolved the
// contact, R10).
export function legacyAadeTransaction(
  orgId: string,
  row: LegacyStagingRow & { issue_date: string; direction: "income" | "expense" },
  contactId: string | null,
) {
  const netAmount = row.net_amount ?? 0;
  const vatAmount = row.vat_amount ?? 0;
  const withholdingAmount = row.withholding_amount ?? 0;
  const grossAmount = row.gross_amount ?? netAmount + vatAmount - withholdingAmount;
  return {
    org_id: orgId,
    tx_date: row.issue_date,
    contact_id: contactId,
    counterparty_afm: row.counterparty_afm,
    counterparty_name: row.counterparty_name,
    project_id: row.project_id,
    category_id: row.category_id,
    account_id: row.account_id,
    direction: row.direction,
    scope: row.scope ?? "business",
    status: row.status ?? "paid",
    origin: "aade" as const,
    gross_amount: grossAmount,
    net_amount: netAmount,
    vat_amount: vatAmount,
    withholding_amount: withholdingAmount,
    other_taxes: row.other_taxes ?? 0,
    has_invoice: vatAmount > 0 || withholdingAmount > 0,
    invoice_number: row.invoice_number,
    mydata_mark: row.mydata_mark,
    document_type: row.document_type,
    aade_discrepancy: row.discrepancy,
    aade_staging_row_id: row.id,
  };
}
