import type { TxDirection } from "@/lib/domain/enums";
import type { ExtractedRefs } from "./text";

// Shared shapes for unified ingestion: every source -- bank file, AADE
// export, AI-read document, email, free text, manual cash, and later a PSD2
// bank feed -- is turned by an adapter into the same CanonicalRow list, which
// is staged as ingest_rows (0054), matched (./match), reviewed and committed
// by commit_ingest_batch (0055). Adding a source means adding an adapter,
// never another staging table or commit path.

// Mirrors the ingest_source enum (0051); each label is also a tx_origin.
export const INGEST_SOURCE = [
  "bank_file",
  "bank_pdf",
  "aade",
  "ai_document",
  "ai_nl",
  "ai_email",
  "manual",
  "manual_cash",
  "psd2",
] as const;
export type IngestSource = (typeof INGEST_SOURCE)[number];

export type IngestRowKind = "document" | "movement";

export const INGEST_DECISION = [
  "pending",
  "create",
  "settle",
  "settle_partial",
  "settle_many",
  "link_existing",
  "skip",
] as const;
export type IngestDecision = (typeof INGEST_DECISION)[number];

export type IngestDedupStatus = "new" | "dup_external_key" | "dup_in_file" | "already_recorded";

// One staged line, whatever it came from. Amounts are positive; direction
// carries the sign (the 0004 ledger rule).
export interface CanonicalRow {
  rowNo: number; // line/row number in the source, 1-based, for error messages
  kind: IngestRowKind;
  raw: Record<string, unknown>; // source cells verbatim (-> ingest_rows.raw)
  extracted: ExtractedRefs; // ΑΦΜ / IBAN / RF / ΜΑΡΚ found in the text
  externalKey: string | null;
  txDate: string | null;
  valueDate: string | null;
  direction: TxDirection | null;
  amount: number | null;
  netAmount?: number | null;
  vatAmount?: number | null;
  vatRate?: number | null;
  withholdingAmount?: number | null;
  description: string | null;
  counterpartyName: string | null;
  counterpartyAfm: string | null;
  counterpartyIban: string | null;
  reference: string | null;
  invoiceNumber?: string | null;
  mydataMark?: string | null;
  balanceAfter: number | null;
  parseErrors: string[];
}

// What a statement says about itself, for the «υπόλοιπο έναρξης + Σ
// κινήσεων = υπόλοιπο λήξης» check on the review screen.
export interface StatementSummary {
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  // Running-balance column consistent with the amounts? null = no balance column.
  balanceConsistent: boolean | null;
  // Lines whose running balance disagrees with the previous line + amount.
  balanceMismatchRows: number[];
  // Bank exports list newest-first about as often as oldest-first.
  order: "asc" | "desc" | null;
}

export interface ParsedBatch {
  source: IngestSource;
  rows: CanonicalRow[];
  statement: StatementSummary | null;
  profileId: string | null;
  warnings: string[];
}

export interface AdapterContext {
  orgId: string;
  accountId: string | null; // the account a statement belongs to
  ownAfm?: string | null; // decides direction for AADE rows
}

export interface UploadedFile {
  name: string;
  mimeType: string;
  bytes: Uint8Array;
}

// A file-shaped source (bank CSV/XLSX, AADE export, PDF statement). The
// /inbox drop zone asks each adapter in turn whether it recognises the file.
export interface IngestAdapter {
  source: IngestSource;
  canHandle(file: UploadedFile): boolean | Promise<boolean>;
  parse(file: UploadedFile, ctx: AdapterContext): Promise<ParsedBatch>;
}

// The PSD2 seam: a bank-API feed yields the same canonical movements as a
// statement file, so it plugs into staging/matching/commit unchanged. Only
// the interface exists today; no provider is wired up.
export interface BankFeed {
  source: "psd2";
  // Movements booked in [from, to] on the bank account behind accountRef.
  // externalKey must be the provider's stable transaction id, so a re-poll
  // of an overlapping window is caught by the same committed-key index.
  fetchMovements(accountRef: string, from: string, to: string): Promise<CanonicalRow[]>;
  fetchBalance?(accountRef: string, asOf: string): Promise<number | null>;
}
