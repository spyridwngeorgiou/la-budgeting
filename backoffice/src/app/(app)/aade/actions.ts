"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { parseAadeWorkbook } from "@/lib/aade/parse";
import { stageBatch } from "@/lib/aade/dedup";

export async function uploadAadeFile(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Επιλέξτε ένα αρχείο .xlsx.");
  }

  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);
  const { data: org } = await supabase.from("orgs").select("own_afm").eq("id", orgId).single();
  if (!org?.own_afm || org.own_afm === "000000000") {
    throw new Error("Ορίστε πρώτα το πραγματικό ΑΦΜ της επιχείρησης στις Ρυθμίσεις.");
  }

  const buffer = await file.arrayBuffer();
  const sha256 = createHash("sha256").update(Buffer.from(buffer)).digest("hex");

  const { data: existingBatch } = await supabase
    .from("aade_import_batches")
    .select("id, filename")
    .eq("org_id", orgId)
    .eq("file_sha256", sha256)
    .maybeSingle();
  if (existingBatch) {
    throw new Error(`Αυτό το αρχείο έχει ήδη εισαχθεί (${existingBatch.filename}).`);
  }

  const nameMatch = file.name.match(/^(\d{4})-(\d{2})_(expenses|income)\.xlsx$/i);
  const period = nameMatch ? `${nameMatch[1]}-${nameMatch[2]}` : null;
  const kind = nameMatch ? (nameMatch[3].toLowerCase() === "income" ? "income" : "expenses") : null;

  const {
    data: { session },
  } = await supabase.auth.getSession();

  const storagePath = `${orgId}/${Date.now()}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from("aade-imports")
    .upload(storagePath, buffer, { contentType: file.type });
  if (uploadError) throw new Error(uploadError.message);

  const parsedRows = await parseAadeWorkbook(buffer);

  const { data: batch, error: batchError } = await supabase
    .from("aade_import_batches")
    .insert({
      org_id: orgId,
      filename: file.name,
      file_sha256: sha256,
      period,
      kind,
      row_count: parsedRows.length,
      status: "draft",
      storage_path: storagePath,
      uploaded_by: session?.user.id,
    })
    .select("id")
    .single();
  if (batchError) throw new Error(batchError.message);

  const staged = await stageBatch(supabase, orgId, org.own_afm, parsedRows);

  const stagingRows = staged.map((row) => ({
    org_id: orgId,
    batch_id: batch.id,
    row_no: row.rowNo,
    // Round-trip through JSON so Date/etc. values from ExcelJS become
    // plain JSON-safe data before going into a jsonb column.
    raw: JSON.parse(JSON.stringify(row.raw)),
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
  }));

  const { error: rowsError } = await supabase.from("aade_staging_rows").insert(stagingRows);
  if (rowsError) throw new Error(rowsError.message);

  const newCount = staged.filter((r) => r.dedupStatus === "new").length;
  await supabase
    .from("aade_import_batches")
    .update({ new_count: newCount, dup_count: staged.length - newCount })
    .eq("id", batch.id);

  revalidatePath("/aade");
  redirect(`/aade/${batch.id}`);
}

// A single-field updater, not a generic FormData patch: each RowSelect
// only knows about its own field, and a generic "update all three from
// whatever's in this FormData" would silently null out the other two
// fields whenever just one of them changes.
export async function updateStagingRowField(
  rowId: string,
  field: "project_id" | "category_id" | "account_id",
  value: string,
) {
  const supabase = await createClient();
  const patch = field === "project_id" ? { project_id: value || null }
    : field === "category_id" ? { category_id: value || null }
    : { account_id: value || null };
  const { error } = await supabase.from("aade_staging_rows").update(patch).eq("id", rowId);
  if (error) throw new Error(error.message);
  revalidatePath("/aade");
}

export async function bulkAssign(
  batchId: string,
  rowIds: string[],
  fields: { project_id?: string; category_id?: string; account_id?: string },
) {
  const supabase = await createClient();
  const { error } = await supabase.from("aade_staging_rows").update(fields).in("id", rowIds);
  if (error) throw new Error(error.message);
  revalidatePath(`/aade/${batchId}`);
}

async function resolveOrCreateContact(
  supabase: SupabaseClient,
  orgId: string,
  afm: string | null,
  name: string | null,
): Promise<string | null> {
  if (!afm) return null;

  const { data: existing } = await supabase
    .from("contacts")
    .select("id")
    .eq("org_id", orgId)
    .eq("afm", afm)
    .maybeSingle();
  if (existing) return existing.id;

  const { data: created, error } = await supabase
    .from("contacts")
    .insert({ org_id: orgId, name: name ?? afm, afm })
    .select("id")
    .single();
  if (error) throw new Error(error.message);
  return created.id;
}

export async function commitBatch(batchId: string) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const { data: rows, error } = await supabase
    .from("aade_staging_rows")
    .select("*")
    .eq("batch_id", batchId)
    .eq("decision", "import");
  if (error) throw new Error(error.message);

  const missingAssignment = (rows ?? []).filter((r) => !r.project_id || !r.account_id);
  if (missingAssignment.length > 0) {
    throw new Error(
      `${missingAssignment.length} γραμμή/ες δεν έχουν έργο ή λογαριασμό. Συμπληρώστε πριν την οριστικοποίηση.`,
    );
  }

  for (const row of rows ?? []) {
    // Every staged row got a direction and an issue_date at parse time
    // (stageBatch always sets one; unparseable dates are excluded before
    // staging). A row missing either here indicates corrupted staging data,
    // not a normal review state -- skip rather than insert a broken row.
    if (!row.direction || !row.issue_date) continue;

    const contactId = await resolveOrCreateContact(supabase, orgId, row.counterparty_afm, row.counterparty_name);

    const netAmount = row.net_amount ?? 0;
    const vatAmount = row.vat_amount ?? 0;
    const withholdingAmount = row.withholding_amount ?? 0;
    const grossAmount = row.gross_amount ?? netAmount + vatAmount - withholdingAmount;

    const { data: tx, error: txError } = await supabase
      .from("transactions")
      .insert({
        org_id: orgId,
        tx_date: row.issue_date, // narrowed non-null by the guard above
        contact_id: contactId,
        counterparty_afm: row.counterparty_afm,
        counterparty_name: row.counterparty_name,
        project_id: row.project_id,
        category_id: row.category_id,
        account_id: row.account_id,
        direction: row.direction,
        scope: row.scope ?? "business",
        status: row.status ?? "paid",
        origin: "aade",
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
      })
      .select("id")
      .single();

    // A concurrent import or a mark collision within this batch: skip, not
    // fail the whole commit -- the unique index is the final guard.
    if (txError) continue;

    await supabase
      .from("aade_staging_rows")
      .update({ committed_transaction_id: tx.id })
      .eq("id", row.id);
  }

  await supabase
    .from("aade_import_batches")
    .update({ status: "committed", committed_at: new Date().toISOString() })
    .eq("id", batchId);

  revalidatePath("/aade");
  revalidatePath(`/aade/${batchId}`);
  revalidatePath("/transactions");
}
