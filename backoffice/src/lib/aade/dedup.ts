import type { SupabaseClient } from "@supabase/supabase-js";
import type { AadeParsedRow } from "./parse";

// Excel/Postgres date-serial epoch (1899-12-30), matching the DB's
// generated `fingerprint` column exactly so staged rows and already-
// committed rows can be compared on equal terms.
const EPOCH = Date.UTC(1899, 11, 30);

function excelEpochDays(isoDate: string): number {
  return Math.round((Date.UTC(...(isoDate.split("-").map(Number) as [number, number, number])) - EPOCH) / 86_400_000);
}

function computeFingerprint(issueDate: string, afm: string | null, gross: number, mark: string | null): string {
  return `${excelEpochDays(issueDate)}-${afm ?? ""}-${gross.toFixed(2)}-${mark ?? ""}`;
}

export type AadeDedupStatus = "new" | "dup_mark" | "dup_fingerprint" | "dup_self_classification" | "dup_in_batch";

export interface StagedRow extends AadeParsedRow {
  direction: "income" | "expense";
  counterpartyAfm: string | null;
  fingerprint: string;
  dedupStatus: AadeDedupStatus;
  matchedTransactionId: string | null;
}

export interface AadeLedgerMatches {
  markToTxId: Map<string, string>; // ΜΑΡΚ -> transaction already carrying it
  fpToTxId: Map<string, string>; // transactions.fingerprint -> id
}

// Direction and counterparty are DERIVED, never trusted from the sheet
// name/kind: issuer == us -> income, otherwise expense. Robust to a
// mis-named upload, unlike trusting the filename or "expenses"/"income"
// sheet label.
function deriveAadeRows(parsedRows: AadeParsedRow[], ownAfm: string) {
  return parsedRows.map((row) => {
    const direction: "income" | "expense" = row.issuerAfm === ownAfm ? "income" : "expense";
    const counterpartyAfm = row.issuerAfm === ownAfm ? row.receiverAfm : row.issuerAfm;
    const gross = row.grossAmount ?? 0;
    const fingerprint = row.issueDate
      ? computeFingerprint(row.issueDate, counterpartyAfm, gross, row.mydataMark)
      : `unparsed-row-${row.rowNo}`;
    return { ...row, direction, counterpartyAfm, fingerprint };
  });
}

// The pure half of staging: direction, counterparty, fingerprint and the
// four dedup passes, given what the ledger already holds. Shared by the old
// /aade importer (stageBatch below) and the unified ingest adapter
// (src/lib/ingest/adapters/aadeFile.ts), so both classify identically.
export function classifyAadeRows(
  parsedRows: AadeParsedRow[],
  ownAfm: string,
  ledger: AadeLedgerMatches = { markToTxId: new Map(), fpToTxId: new Map() },
): StagedRow[] {
  const withDerived = deriveAadeRows(parsedRows, ownAfm);
  const { markToTxId, fpToTxId } = ledger;

  const staged: StagedRow[] = [];
  const seenMarksInBatch = new Set<string>();

  // Pass 3 groundwork: group by (direction, date, net, withholding) so pass
  // 3 can find the myDATA self-classification quirk within each group.
  const groupKey = (row: (typeof withDerived)[number]) =>
    `${row.direction}|${row.issueDate}|${(row.netAmount ?? 0).toFixed(2)}|${(row.withholdingAmount ?? 0).toFixed(2)}`;
  const groups = new Map<string, typeof withDerived>();
  for (const row of withDerived) {
    const list = groups.get(groupKey(row)) ?? [];
    list.push(row);
    groups.set(groupKey(row), list);
  }

  for (const row of withDerived) {
    let dedupStatus: AadeDedupStatus = "new";
    let matchedTransactionId: string | null = null;

    if (row.mydataMark && markToTxId.has(row.mydataMark)) {
      // Pass 1: dup_mark -- the primary guard. ΜΑΡΚ is issued by myDATA and
      // is globally unique; if it's already on a committed transaction, this
      // row is a re-import of the same invoice, full stop.
      dedupStatus = "dup_mark";
      matchedTransactionId = markToTxId.get(row.mydataMark) ?? null;
    } else if (fpToTxId.has(row.fingerprint)) {
      // Pass 2: dup_fingerprint -- catches invoices already entered by hand
      // before this export arrived (no ΜΑΡΚ to match on, but everything else
      // about the invoice is identical).
      dedupStatus = "dup_fingerprint";
      matchedTransactionId = fpToTxId.get(row.fingerprint) ?? null;
    } else {
      // Pass 3: myDATA self-classification quirk -- when the issuer's
      // transmission is missing or mismatched, myDATA emits a stand-in row
      // with a BLANK counterparty AFM for the same invoice alongside the
      // real, correctly-attributed row. Keep the real one, skip the blank.
      const group = groups.get(groupKey(row)) ?? [];
      const hasRealAfmSibling = group.some((r) => r !== row && r.counterpartyAfm);
      if (!row.counterpartyAfm && hasRealAfmSibling) {
        dedupStatus = "dup_self_classification";
      } else if (row.mydataMark && seenMarksInBatch.has(row.mydataMark)) {
        // Pass 4: the same ΜΑΡΚ appears twice within this one upload
        // (overlapping month exports).
        dedupStatus = "dup_in_batch";
      }
    }

    if (row.mydataMark && dedupStatus === "new") seenMarksInBatch.add(row.mydataMark);

    staged.push({ ...row, dedupStatus, matchedTransactionId });
  }

  return staged;
}

// What the ledger already holds for these rows (passes 1 and 2).
export async function loadAadeLedgerMatches(
  supabase: SupabaseClient,
  orgId: string,
  ownAfm: string,
  parsedRows: AadeParsedRow[],
): Promise<AadeLedgerMatches> {
  const withDerived = deriveAadeRows(parsedRows, ownAfm);
  const marks = withDerived.map((r) => r.mydataMark).filter((m): m is string => !!m);
  const { data: markMatches } = marks.length
    ? await supabase.from("transactions").select("id, mydata_mark").eq("org_id", orgId).in("mydata_mark", marks)
    : { data: [] };
  const fingerprints = withDerived.map((r) => r.fingerprint);
  const { data: fpMatches } = await supabase
    .from("transactions")
    .select("id, fingerprint")
    .eq("org_id", orgId)
    .in("fingerprint", fingerprints);
  return {
    markToTxId: new Map((markMatches ?? []).map((m: { id: string; mydata_mark: string }) => [m.mydata_mark, m.id])),
    fpToTxId: new Map((fpMatches ?? []).map((m: { id: string; fingerprint: string }) => [m.fingerprint, m.id])),
  };
}

export async function stageBatch(
  supabase: SupabaseClient,
  orgId: string,
  ownAfm: string,
  parsedRows: AadeParsedRow[],
): Promise<StagedRow[]> {
  const ledger = await loadAadeLedgerMatches(supabase, orgId, ownAfm, parsedRows);
  return classifyAadeRows(parsedRows, ownAfm, ledger);
}
