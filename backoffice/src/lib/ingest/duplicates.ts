import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/types";
import type { TxDirection } from "@/lib/domain/enums";
import { el } from "@/lib/i18n/el";

// The «Πιθανό διπλότυπο» guard shared by every path that writes one
// transaction directly (manual form, draft approval). The rule lives in SQL
// (find_possible_duplicates, 0050) so it can later run inside
// commit_ingest_batch too; this is only the typed call and the result shape
// the client renders.

export interface DuplicateCandidate {
  id: string;
  tx_date: string;
  gross_amount: number;
  status: string;
  counterparty_name: string | null;
  contact_name: string | null;
  invoice_number: string | null;
  description: string | null;
  reason: "invoice_number" | "amount_date";
}

// What a write action returns instead of throwing: thrown Server Action
// errors lose their message in production builds, so anything the user
// must read comes back as data.
export type WriteResult = { ok: true } | { error: string } | { duplicates: DuplicateCandidate[] };

export async function findPossibleDuplicates(
  supabase: SupabaseClient<Database>,
  input: {
    orgId: string;
    direction: TxDirection;
    gross: number;
    txDate: string;
    contactId?: string | null;
    counterpartyAfm?: string | null;
    invoiceNumber?: string | null;
    excludeId?: string | null;
  },
): Promise<DuplicateCandidate[]> {
  const { data, error } = await supabase.rpc("find_possible_duplicates", {
    p_org: input.orgId,
    p_direction: input.direction,
    p_gross: input.gross,
    p_tx_date: input.txDate,
    p_contact: input.contactId ?? undefined,
    p_counterparty_afm: input.counterpartyAfm ?? undefined,
    p_invoice_number: input.invoiceNumber ?? undefined,
    p_exclude: input.excludeId ?? undefined,
  });
  // The guard is advisory: if it cannot run, let the write proceed rather
  // than block data entry on a warning.
  if (error || !data) return [];
  return data as DuplicateCandidate[];
}

// Postgres errors from a transactions insert/update, in words a user can
// act on. Unique-index names are from 0004.
export function transactionWriteError(error: { code?: string; message: string }): string {
  if (error.code === "23505" && error.message.includes("tx_mark_uq")) return el.ingest.markExists;
  if (error.code === "23505" && error.message.includes("tx_fingerprint_uq")) return el.ingest.aadeFingerprintExists;
  if (error.message.includes("tx_paid_needs_date")) return el.ingest.paidOnRequired;
  return error.message;
}
