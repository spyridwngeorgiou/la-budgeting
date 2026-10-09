import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@/lib/db/types";
import type { TxScope, TxStatus } from "@/lib/domain/enums";
import type { CanonicalRow, IngestDecision, IngestDedupStatus, IngestSource } from "./types";

// The one way a parsed source becomes a staged batch: an ingest_batches row
// plus its ingest_rows, nothing in `transactions` (commit_ingest_batch is
// the only writer there). Used by the UI actions (RLS client) and by the
// email webhook (service-role client, no session) -- which is why org_id is
// always explicit and never inferred from the caller.
//
// Bank statements still stage through inbox/stage.ts stageMovements, which
// adds the matcher; everything document-shaped (AADE, AI capture) comes here.

type Client = SupabaseClient<Database>;
export type IngestRowInsert = Database["public"]["Tables"]["ingest_rows"]["Insert"];

// What a source may decide beyond the canonical fields.
export interface StageRowExtras {
  documentId?: string | null;
  dueDate?: string | null;
  otherTaxes?: number | null;
  documentType?: string | null;
  aadeDiscrepancy?: string | null;
  hasInvoice?: boolean | null;
  status?: TxStatus | null;
  paidOn?: string | null;
  scope?: TxScope;
  accountId?: string | null;
  projectId?: string | null;
  categoryId?: string | null;
  contactId?: string | null;
  decision: IngestDecision;
  decisionTargets?: string[];
  dedupStatus?: IngestDedupStatus;
  meta?: Record<string, unknown>;
}
export type StageRow = CanonicalRow & StageRowExtras;

// JSON-safe copy (Dates from ExcelJS, undefined) for a jsonb column.
function json(value: unknown): Json {
  return JSON.parse(JSON.stringify(value ?? {})) as Json;
}

// Pure: one StageRow -> its ingest_rows insert (without org/batch, added by
// the caller). The AADE parity test compares exactly this output.
export function toIngestRowFields(row: StageRow): Omit<IngestRowInsert, "org_id" | "batch_id"> {
  return {
    row_no: row.rowNo,
    row_kind: row.kind,
    raw: json(row.raw),
    extracted: json(row.extracted),
    meta: json(row.meta ?? {}),
    external_key: row.externalKey,
    tx_date: row.txDate,
    value_date: row.valueDate,
    due_date: row.dueDate ?? null,
    direction: row.direction,
    amount: row.amount,
    net_amount: row.netAmount ?? null,
    vat_amount: row.vatAmount ?? null,
    vat_rate: row.vatRate ?? null,
    withholding_amount: row.withholdingAmount ?? null,
    other_taxes: row.otherTaxes ?? null,
    has_invoice: row.hasInvoice ?? null,
    description: row.description,
    counterparty_name: row.counterpartyName,
    counterparty_afm: row.counterpartyAfm,
    counterparty_iban: row.counterpartyIban,
    reference: row.reference,
    invoice_number: row.invoiceNumber ?? null,
    mydata_mark: row.mydataMark ?? null,
    document_type: row.documentType ?? null,
    aade_discrepancy: row.aadeDiscrepancy ?? null,
    balance_after: row.balanceAfter,
    status: row.status ?? null,
    paid_on: row.paidOn ?? null,
    account_id: row.accountId ?? null,
    project_id: row.projectId ?? null,
    category_id: row.categoryId ?? null,
    contact_id: row.contactId ?? null,
    document_id: row.documentId ?? null,
    scope: row.scope ?? "business",
    dedup_status: row.dedupStatus ?? "new",
    decision: row.decision,
    decision_targets: row.decisionTargets ?? [],
    parse_errors: row.parseErrors,
  };
}

export interface StageBatchInput {
  orgId: string;
  source: IngestSource;
  rows: StageRow[];
  filename?: string | null;
  fileSha256?: string | null;
  storagePath?: string | null;
  mimeType?: string | null;
  accountId?: string | null;
  createdBy?: string | null;
  meta?: Record<string, unknown>;
}

export async function stageBatch(supabase: Client, input: StageBatchInput): Promise<{ batchId: string }> {
  const { data: batch, error: batchError } = await supabase
    .from("ingest_batches")
    .insert({
      org_id: input.orgId,
      source: input.source,
      account_id: input.accountId ?? null,
      filename: input.filename ?? null,
      file_sha256: input.fileSha256 ?? null,
      storage_path: input.storagePath ?? null,
      mime_type: input.mimeType ?? null,
      row_count: input.rows.length,
      meta: json(input.meta ?? {}),
      created_by: input.createdBy ?? null,
    })
    .select("id")
    .single();
  if (batchError) throw batchError;

  if (input.rows.length > 0) {
    const { error: rowsError } = await supabase
      .from("ingest_rows")
      .insert(input.rows.map((row) => ({ org_id: input.orgId, batch_id: batch.id, ...toIngestRowFields(row) })));
    if (rowsError) {
      // No half-staged batch left behind for the reviewer to puzzle over.
      await supabase.from("ingest_batches").delete().eq("id", batch.id);
      throw rowsError;
    }
  }
  return { batchId: batch.id };
}
