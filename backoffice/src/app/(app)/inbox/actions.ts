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

// Bank statement upload -> stage -> review -> commit/undo. Every step
// returns { error } instead of throwing where the user must read the
// message (thrown Server Action messages are hidden in production).

export type InboxResult = { ok: true } | { error: string };

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
  const { error } = await supabase.rpc("commit_ingest_batch", { p_batch: batchId, p_expected_version: version });
  if (error) return { error: error.message };
  revalidatePath(`/inbox/${batchId}`);
  revalidatePath("/inbox");
  revalidatePath("/transactions");
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
      .insert(profileRow(`${profile.name} (${new Date().toISOString().slice(0, 16).replace("T", " ")})`))
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
