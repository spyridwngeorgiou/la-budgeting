"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import type { Json } from "@/lib/db/types";
import { parseBankFile, readBankGrid, UnsupportedFileError } from "@/lib/ingest/adapters/bankFile";
import { applyProfile, ProfileMismatchError } from "@/lib/ingest/profiles/apply";
import { normalizedRow } from "@/lib/ingest/profiles/detect";
import { PROFILE_FIELDS, type BankProfile, type ColumnMap, type SignMode } from "@/lib/ingest/profiles/types";
import type { DateFormat } from "@/lib/ingest/text";
import { INGEST_DECISION, type IngestDecision, type StatementSummary } from "@/lib/ingest/types";
import { loadProfiles, stageMovements } from "./stage";
import { athensMinuteLabel, isIsoDate } from "@/lib/dates";
import type { ActionResult } from "@/lib/actions";
import { el } from "@/lib/i18n/el";
import { cashOnly, deriveFromNet, isIdentityConsistent } from "@/lib/finance/money";
import { findPossibleDuplicates, type WriteResult } from "@/lib/ingest/duplicates";
import { aiCorrections, cleanMark, type AiRowMeta } from "@/lib/ingest/adapters/aiShared";
import { AI_SOURCES } from "@/lib/ingest/pendingCaptures";

// Bank statement upload -> stage -> review -> commit/undo. Every step
// returns { error } instead of throwing where the user must read the
// message (thrown Server Action messages are hidden in production).

export type InboxResult = ActionResult;

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Web Crypto rather than node:crypto: available in Workers as-is.
  const digest = await crypto.subtle.digest("SHA-256", bytes as unknown as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function statementColumns(statement: StatementSummary | null) {
  return {
    period_start: statement?.periodStart ?? null,
    period_end: statement?.periodEnd ?? null,
    opening_balance: statement?.openingBalance ?? null,
    closing_balance: statement?.closingBalance ?? null,
  };
}

export async function uploadBankStatement(formData: FormData): Promise<InboxResult> {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "Επιλέξτε ένα αρχείο CSV ή XLSX." };
  const accountId = formString(formData, "account_id");
  if (!accountId) return { error: "Επιλέξτε τον λογαριασμό στον οποίο ανήκει το αντίγραφο." };

  const supabase = await createClient();
  const [orgId, { data: { session } }] = await Promise.all([getCurrentOrgId(supabase), supabase.auth.getSession()]);
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sha = await sha256Hex(bytes);

  const { data: existing } = await supabase
    .from("ingest_batches")
    .select("id, filename")
    .eq("org_id", orgId)
    .eq("file_sha256", sha)
    .in("status", ["staged", "committed"])
    .maybeSingle();
  if (existing) return { error: `Αυτό το αρχείο έχει ήδη ανέβει (${existing.filename}).` };

  const profiles = await loadProfiles(supabase, orgId);
  let parsed;
  try {
    parsed = await parseBankFile({ name: file.name, mimeType: file.type, bytes }, profiles, { orgId, accountId });
  } catch (e) {
    if (e instanceof UnsupportedFileError || e instanceof ProfileMismatchError) return { error: e.message };
    throw e;
  }

  const storagePath = `${orgId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("bank-statements")
    .upload(storagePath, bytes, { contentType: file.type || "application/octet-stream" });
  if (uploadError) return { error: uploadError.message };

  const { data: batch, error: batchError } = await supabase
    .from("ingest_batches")
    .insert({
      org_id: orgId,
      source: "bank_file",
      account_id: accountId,
      profile_id: parsed.profile?.id ?? null,
      filename: file.name,
      file_sha256: sha,
      storage_path: storagePath,
      mime_type: file.type || null,
      row_count: parsed.batch.rows.length,
      ...statementColumns(parsed.batch.statement),
      meta: {
        file_kind: parsed.fileKind,
        encoding: parsed.encoding,
        header_row: parsed.headerRow,
        needs_mapping: parsed.needsMapping,
        warnings: parsed.batch.warnings,
        statement: parsed.batch.statement,
      } as unknown as Json,
      created_by: session?.user.id,
    })
    .select("id")
    .single();
  if (batchError) return { error: batchError.message };

  if (parsed.needsMapping) redirect(`/inbox/mapping/${batch.id}`);

  await stageMovements(supabase, orgId, batch.id, accountId, parsed.batch.rows);
  revalidatePath("/inbox");
  redirect(`/inbox/${batch.id}`);
}

// One row's decision. `targets` must be what the matcher proposed or empty;
// commit_ingest_batch re-validates them against the ledger anyway.
export async function setRowDecision(batchId: string, rowId: string, decision: string, targets: string[]): Promise<InboxResult> {
  if (!INGEST_DECISION.includes(decision as IngestDecision)) return { error: "Άγνωστη απόφαση." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("ingest_rows")
    .update({ decision: decision as IngestDecision, decision_targets: targets })
    .eq("id", rowId)
    .eq("batch_id", batchId)
    .is("committed_at", null);
  if (error) return { error: error.message };
  revalidatePath(`/inbox/${batchId}`);
  return { ok: true };
}

export async function commitIngest(batchId: string, version: number): Promise<InboxResult> {
  const supabase = await createClient();
  const { data: batch } = await supabase.from("ingest_batches").select("org_id, source, legacy_ref").eq("id", batchId).maybeSingle();
  const { error } = await supabase.rpc("commit_ingest_batch", { p_batch: batchId, p_expected_version: version });
  if (error) return { error: error.message };
  if (batch && isAiSource(batch.source)) await afterAiCommit(supabase, batchId, batch.org_id, batch.legacy_ref);
  if (batch?.legacy_ref?.startsWith("aade:")) await afterLegacyAadeCommit(supabase, batchId, batch.legacy_ref);
  revalidatePath(`/inbox/${batchId}`);
  revalidatePath("/inbox");
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  return { ok: true };
}

const isAiSource = (source: string) => (AI_SOURCES as readonly string[]).includes(source);

// What approveDraft did after writing the transaction, now per committed
// row: the corrections diff for the learning loop (CaptureAnalytics reads
// it by ingest_row_id) and, for a draft backfilled by 0072, the draft marked
// done so the old tables stay truthful until Phase 8 drops them.
async function afterAiCommit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  batchId: string,
  orgId: string,
  legacyRef: string | null,
) {
  const { data: rows } = await supabase
    .from("ingest_rows")
    .select("id, raw, meta, net_amount, vat_amount, tx_date, mydata_mark, counterparty_afm, document_id, decision, committed_transaction_id")
    .eq("batch_id", batchId);
  const created = (rows ?? []).filter((r) => r.decision === "create" && r.committed_transaction_id);
  if (created.length > 0) {
    // Undo + re-commit replaces the earlier diff instead of doubling it.
    await supabase.from("ai_corrections").delete().in("ingest_row_id", created.map((r) => r.id));
    const corrections = created.flatMap((r) => {
      const ai = ((r.meta ?? {}) as { ai?: AiRowMeta }).ai;
      return aiCorrections(r).map((c) => ({
        org_id: orgId,
        document_id: r.document_id,
        ingest_row_id: r.id,
        draft_id: ai?.draft_id ?? null,
        field: c.field,
        ai_value: c.ai_value,
        human_value: c.human_value,
        model: ai?.model ?? null,
      }));
    });
    if (corrections.length > 0) {
      const { error } = await supabase.from("ai_corrections").insert(corrections);
      if (error) console.error("[inbox] ai_corrections", error.message);
    }
  }
  if (legacyRef?.startsWith("draft:")) {
    const row = (rows ?? [])[0];
    const draftId = legacyRef.slice("draft:".length);
    await supabase
      .from("transaction_drafts")
      .update(
        row?.committed_transaction_id
          ? { status: "approved", approved_transaction_id: row.committed_transaction_id }
          : { status: "discarded" },
      )
      .eq("id", draftId)
      .eq("status", "pending");
  }
}

// A draft AADE import backfilled by 0073 and finished here: mark the old
// rows and batch done too, so the old tables stay truthful (and a re-run of
// ingest_backfill_aade() leaves the committed copy alone) until Phase 8
// drops them.
async function afterLegacyAadeCommit(
  supabase: Awaited<ReturnType<typeof createClient>>,
  batchId: string,
  legacyRef: string,
) {
  const aadeBatchId = legacyRef.slice("aade:".length);
  const { data: rows } = await supabase
    .from("ingest_rows")
    .select("meta, committed_transaction_id")
    .eq("batch_id", batchId)
    .not("committed_transaction_id", "is", null);
  for (const row of rows ?? []) {
    const stagingId = ((row.meta ?? {}) as { aade_staging_row_id?: string }).aade_staging_row_id;
    if (!stagingId) continue;
    await supabase
      .from("aade_staging_rows")
      .update({ committed_transaction_id: row.committed_transaction_id, commit_error: null })
      .eq("id", stagingId)
      .is("committed_transaction_id", null);
  }
  const { error } = await supabase
    .from("aade_import_batches")
    .update({ status: "committed", committed_at: new Date().toISOString() })
    .eq("id", aadeBatchId)
    .eq("status", "draft");
  if (error) console.error("[inbox] legacy aade batch", error.message);
}

// ---------------------------------------------------------------- documents
// AADE and AI-captured rows carry their own project/category/account (and,
// for AI rows, every field of the old draft review form).

const ASSIGNABLE = ["project_id", "category_id", "account_id", "contact_id"] as const;
type AssignableField = (typeof ASSIGNABLE)[number];

export async function setRowAssignment(batchId: string, rowId: string, field: string, value: string): Promise<InboxResult> {
  if (!ASSIGNABLE.includes(field as AssignableField)) return { error: el.ingest.review.notEditable };
  const supabase = await createClient();
  const patch: Partial<Record<AssignableField, string | null>> = { [field as AssignableField]: value || null };
  const { data, error } = await supabase
    .from("ingest_rows")
    .update(patch)
    .eq("id", rowId)
    .eq("batch_id", batchId)
    .is("committed_at", null)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: el.ingest.review.notEditable };
  revalidatePath(`/inbox/${batchId}`);
  return { ok: true };
}

export async function bulkAssignRows(batchId: string, formData: FormData): Promise<InboxResult> {
  const rowIds = formData.getAll("row_ids").map(String).filter(Boolean);
  const patch: Partial<Record<AssignableField, string>> = {};
  for (const field of ["project_id", "category_id", "account_id"] as const) {
    const value = formString(formData, field);
    if (value) patch[field] = value;
  }
  if (rowIds.length === 0 || Object.keys(patch).length === 0) return { ok: true };
  const supabase = await createClient();
  const { error } = await supabase
    .from("ingest_rows")
    .update(patch)
    .in("id", rowIds)
    .eq("batch_id", batchId)
    .is("committed_at", null);
  if (error) return { error: error.message };
  revalidatePath(`/inbox/${batchId}`);
  return { ok: true };
}

// The old approveDraft's validation, applied to the staged row instead of
// writing a transaction: the row becomes «Νέα κίνηση» and the batch commit
// writes it. Possible duplicates come back for confirmation first.
export async function saveCaptureRow(batchId: string, rowId: string, formData: FormData): Promise<WriteResult> {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const txDate = String(formData.get("tx_date") ?? "");
  if (!isIsoDate(txDate)) return { error: el.ingest.review.invalidDate };
  const hasInvoice = formData.get("has_invoice") === "on";
  const netAmount = Number(formData.get("net_amount"));
  const vatRate = Number(formData.get("vat_rate") ?? 0);
  const withholding = Number(formData.get("withholding_amount") ?? 0);
  const breakdown = hasInvoice ? deriveFromNet(netAmount, vatRate, withholding) : cashOnly(netAmount);
  if (!Number.isFinite(breakdown.gross) || breakdown.gross <= 0 || !isIdentityConsistent(breakdown)) {
    return { error: el.ingest.review.identityMismatch };
  }

  const status = (formString(formData, "status") as "paid" | "pending" | "scheduled" | null) ?? "pending";
  const paidOn = status === "paid" ? formString(formData, "paid_on") : null;
  if (status === "paid" && !isIsoDate(paidOn)) return { error: el.ingest.paidOnRequired };
  const dueDate = formString(formData, "due_date");
  const direction = formString(formData, "direction") === "income" ? "income" : "expense";
  const contactId = formString(formData, "contact_id");
  const counterpartyAfm = formString(formData, "counterparty_afm")?.replace(/\D/g, "") || null;
  const invoiceNumber = formString(formData, "invoice_number");

  if (formData.get("confirm_duplicate") !== "1") {
    const duplicates = await findPossibleDuplicates(supabase, {
      orgId,
      direction,
      gross: breakdown.gross,
      txDate,
      contactId,
      counterpartyAfm,
      invoiceNumber,
    });
    if (duplicates.length > 0) return { duplicates };
  }

  const { data, error } = await supabase
    .from("ingest_rows")
    .update({
      direction,
      tx_date: txDate,
      due_date: isIsoDate(dueDate) ? dueDate : null,
      status,
      paid_on: paidOn,
      contact_id: contactId,
      counterparty_afm: counterpartyAfm,
      counterparty_name: formString(formData, "counterparty_name"),
      project_id: formString(formData, "project_id"),
      category_id: formString(formData, "category_id"),
      account_id: formString(formData, "account_id"),
      scope: formString(formData, "scope") === "personal" ? "personal" : "business",
      has_invoice: hasInvoice,
      amount: breakdown.gross,
      net_amount: breakdown.net,
      vat_amount: breakdown.vat,
      vat_rate: hasInvoice ? vatRate : null,
      withholding_amount: breakdown.withholding,
      invoice_number: invoiceNumber,
      mydata_mark: cleanMark(formString(formData, "mydata_mark")),
      description: formString(formData, "description"),
      parse_errors: [],
      decision: "create",
      decision_targets: [],
    })
    .eq("id", rowId)
    .eq("batch_id", batchId)
    .is("committed_at", null)
    .select("id");
  if (error) return { error: error.message };
  if (!data?.length) return { error: el.ingest.review.notEditable };
  revalidatePath(`/inbox/${batchId}`);
  return { ok: true };
}

export type UndoResult = InboxResult | { touched: string[] };

export async function undoIngest(batchId: string, version: number, force: boolean): Promise<UndoResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("undo_ingest_batch", {
    p_batch: batchId,
    p_expected_version: version,
    p_force: force,
  });
  if (error) return { error: error.message };
  const result = data as { status: string; transaction_ids?: string[] } | null;
  if (result?.status === "touched") return { touched: result.transaction_ids ?? [] };
  revalidatePath(`/inbox/${batchId}`);
  revalidatePath("/inbox");
  revalidatePath("/transactions");
  return { ok: true };
}

export async function discardBatch(batchId: string): Promise<InboxResult> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("ingest_batches")
    .update({ status: "discarded" })
    .eq("id", batchId)
    .in("status", ["staged", "undone"]);
  if (error) return { error: error.message };
  revalidatePath("/inbox");
  redirect("/inbox");
}

// Column-mapping wizard: build a profile from the user's choices, prove it
// parses the uploaded file, save it for the org (so the next statement from
// this bank is recognised automatically) and stage the rows.
export async function saveMappingAndStage(batchId: string, formData: FormData): Promise<InboxResult> {
  const supabase = await createClient();
  const [orgId, { data: { session } }] = await Promise.all([getCurrentOrgId(supabase), supabase.auth.getSession()]);
  const { data: batch } = await supabase
    .from("ingest_batches")
    .select("id, account_id, storage_path, filename, status, row_count")
    .eq("id", batchId)
    .maybeSingle();
  if (!batch?.storage_path) return { error: "Η παρτίδα δεν βρέθηκε." };
  if (batch.status !== "staged" || batch.row_count > 0) return { error: "Η παρτίδα έχει ήδη γραμμές." };

  const { data: blob, error: downloadError } = await supabase.storage.from("bank-statements").download(batch.storage_path);
  if (downloadError || !blob) return { error: downloadError?.message ?? "Το αρχείο δεν βρέθηκε." };
  const bytes = new Uint8Array(await blob.arrayBuffer());

  const headerRow = Number(formData.get("header_row")) - 1;
  const columnMap: ColumnMap = {};
  for (const field of PROFILE_FIELDS) {
    const value = formString(formData, `col_${field}`);
    if (value !== null) columnMap[field] = Number(value);
  }
  const signMode = (formString(formData, "sign_mode") ?? "signed") as SignMode;
  const name = formString(formData, "profile_name") ?? batch.filename ?? "Η τράπεζά μου";

  const { grid, fileKind, encoding } = await readBankGrid({ name: batch.filename ?? "", mimeType: "", bytes });
  const header = normalizedRow(grid[headerRow]);
  const profile: BankProfile = {
    id: null,
    orgId,
    bankCode: "custom",
    name,
    fileKind,
    encoding: encoding ?? "utf-8",
    delimiter: null,
    // The mapped columns' header texts identify this layout next time.
    headerSignature: Object.values(columnMap)
      .map((i) => header[i as number])
      .filter((h): h is string => !!h),
    columnMap,
    dateFormat: (formString(formData, "date_format") ?? "dd/MM/yyyy") as DateFormat,
    decimalSeparator: formString(formData, "decimal_separator") === "." ? "." : ",",
    signMode,
    debitMarkers: (formString(formData, "debit_markers") ?? "")
      .split(",")
      .map((m) => m.trim())
      .filter(Boolean),
    footerPattern: "^(ΣΥΝΟΛ|ΥΠΟΛΟΙΠΟ|TOTAL)",
    verified: true,
  };

  let applied;
  try {
    applied = applyProfile(grid, profile, headerRow, { accountId: batch.account_id });
  } catch (e) {
    if (e instanceof ProfileMismatchError) return { error: e.message };
    throw e;
  }
  if (applied.rows.length === 0) return { error: "Με αυτή την αντιστοίχιση δεν διαβάστηκε καμία κίνηση." };

  const profileRow = (label: string) => ({
    org_id: orgId,
    bank_code: profile.bankCode,
    name: label,
    file_kind: profile.fileKind,
    encoding: profile.encoding,
    header_signature: profile.headerSignature,
    column_map: profile.columnMap as Json,
    date_format: profile.dateFormat,
    decimal_separator: profile.decimalSeparator,
    sign_mode: profile.signMode,
    debit_markers: profile.debitMarkers,
    footer_pattern: profile.footerPattern,
    verified: true,
    created_by: session?.user.id,
  });
  let { data: saved, error: profileError } = await supabase
    .from("bank_import_profiles")
    .insert(profileRow(profile.name))
    .select("id")
    .single();
  // Name already taken by an earlier mapping: keep both, dated.
  if (profileError?.code === "23505") {
    ({ data: saved, error: profileError } = await supabase
      .from("bank_import_profiles")
      .insert(profileRow(`${profile.name} (${athensMinuteLabel()})`))
      .select("id")
      .single());
  }
  if (profileError) return { error: profileError.message };
  const profileId = saved?.id ?? null;

  await supabase
    .from("ingest_batches")
    .update({
      profile_id: profileId,
      row_count: applied.rows.length,
      ...statementColumns(applied.statement),
      meta: { file_kind: fileKind, encoding, header_row: headerRow, needs_mapping: false, warnings: applied.warnings, statement: applied.statement } as unknown as Json,
    })
    .eq("id", batchId);

  await stageMovements(supabase, orgId, batchId, batch.account_id, applied.rows);
  revalidatePath("/inbox");
  redirect(`/inbox/${batchId}`);
}
