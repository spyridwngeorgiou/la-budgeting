"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import { deriveFromNet, cashOnly, isIdentityConsistent, splitProportionally, toCents } from "@/lib/finance/money";
import type { TxDirection, TxScope, TxStatus } from "@/lib/domain/enums";

// The one place transaction money fields get computed for the manual-entry
// path -- gross_amount is a plain stored column (not a DB-generated one), so
// the server must derive it itself. Never trust a client-submitted gross.
function deriveMoney(formData: FormData) {
  const netAmount = Number(formData.get("net_amount"));
  const vatRate = Number(formData.get("vat_rate") ?? 0);
  const withholding = Number(formData.get("withholding_amount") ?? 0);
  const hasInvoice = formData.get("has_invoice") === "on";

  const breakdown = hasInvoice
    ? deriveFromNet(netAmount, vatRate, withholding)
    : cashOnly(netAmount);

  if (!isIdentityConsistent(breakdown)) {
    throw new Error("Ασυνέπεια στο ποσό: net + ΦΠΑ - παρακράτηση δεν ισούται με το σύνολο.");
  }

  return { ...breakdown, hasInvoice };
}

function fieldsFromForm(formData: FormData) {
  const money = deriveMoney(formData);
  const status = String(formData.get("status")) as TxStatus;
  const scope = String(formData.get("scope") ?? "business") as TxScope;

  return {
    tx_date: String(formData.get("tx_date")),
    due_date: formString(formData, "due_date"),
    // Only a paid row has a payment date; clearing it on the others keeps a
    // re-opened row from claiming it was paid.
    paid_on: status === "paid" ? formString(formData, "paid_on") : null,
    contact_id: formString(formData, "contact_id"),
    project_id: formString(formData, "project_id"),
    property_project_id: scope === "personal" ? formString(formData, "property_project_id") : null,
    category_id: formString(formData, "category_id"),
    account_id: formString(formData, "account_id"),
    direction: String(formData.get("direction")) as TxDirection,
    scope,
    status,
    net_amount: money.net,
    vat_amount: money.vat,
    vat_rate: money.hasInvoice ? money.vatRate : null,
    withholding_amount: money.withholding,
    gross_amount: money.gross,
    has_invoice: money.hasInvoice,
    description: formString(formData, "description"),
    invoice_number: formString(formData, "invoice_number"),
  };
}

export async function createTransaction(formData: FormData) {
  const supabase = await createClient();
  const [orgId, {
    data: { session },
  }] = await Promise.all([getCurrentOrgId(supabase), supabase.auth.getSession()]);

  const { error } = await supabase.from("transactions").insert({
    ...fieldsFromForm(formData),
    org_id: orgId,
    created_by: session?.user.id,
  });

  if (error) throw new Error(error.message);
  revalidatePath("/transactions");
}

export async function updateTransaction(id: string, formData: FormData) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("transactions")
    .update(fieldsFromForm(formData))
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/transactions");
}

export async function markPaid(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("transactions")
    .update({ status: "paid", paid_on: new Date().toISOString().slice(0, 10) })
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/transactions");
}

// Pay part of a pending one-off commitment: the paid slice becomes its own
// paid row and the commitment shrinks by exactly that much, atomically, in
// record_partial_payment (0030). Paying the whole remaining amount is just
// markPaid -- no child row needed.
export async function recordPartialPayment(parentId: string, formData: FormData) {
  const supabase = await createClient();
  const { data: parent, error: loadError } = await supabase
    .from("transactions")
    .select("net_amount, vat_amount, withholding_amount, gross_amount, account_id")
    .eq("id", parentId)
    .single();
  if (loadError) throw new Error(loadError.message);

  const amount = Number(formData.get("amount"));
  const paidOn = String(formData.get("paid_on") || new Date().toISOString().slice(0, 10));
  const accountId = formString(formData, "account_id") ?? parent.account_id;

  if (toCents(amount) === toCents(parent.gross_amount)) {
    const { error } = await supabase
      .from("transactions")
      .update({ status: "paid", paid_on: paidOn, account_id: accountId })
      .eq("id", parentId);
    if (error) throw new Error(error.message);
    revalidatePath("/transactions");
    return;
  }

  const { paid } = splitProportionally(
    {
      net: Number(parent.net_amount ?? parent.gross_amount),
      vat: Number(parent.vat_amount),
      withholding: Number(parent.withholding_amount),
      gross: Number(parent.gross_amount),
    },
    amount,
  );
  const { error } = await supabase.rpc("record_partial_payment", {
    p_parent: parentId,
    p_expected_parent_gross: Number(parent.gross_amount),
    p_paid_on: paidOn,
    p_account: accountId,
    p_child_net: paid.net,
    p_child_vat: paid.vat,
    p_child_wh: paid.withholding,
    p_child_gross: paid.gross,
  });
  if (error) throw new Error(error.message);
  revalidatePath("/transactions");
}

// Deterministic "learn from history" suggestion for the manual entry form --
// no model call needed, since the answer is just "what did we do last time
// for this contact". Same idea as lib/ai/resolve.ts's contact-history prior,
// reused here for the human-typed path instead of the AI-extracted one.
export async function suggestForContact(contactId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("transactions")
    .select("project_id, category_id, vat_rate, has_invoice")
    .eq("contact_id", contactId)
    .order("tx_date", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
}

export async function deleteTransaction(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/transactions");
}

// Signed URLs expire fast (5 min, same window used on the draft review
// screen) and the bucket is private -- fetched on demand when someone
// actually clicks "δείτε το πρωτότυπο", not pre-signed for every row on
// page load.
export async function getSourceDocumentUrl(transactionId: string) {
  const supabase = await createClient();
  const { data: tx } = await supabase
    .from("transactions")
    .select("source_document_id")
    .eq("id", transactionId)
    .maybeSingle();
  if (!tx?.source_document_id) return null;

  const { data: document } = await supabase
    .from("documents")
    .select("storage_path")
    .eq("id", tx.source_document_id)
    .maybeSingle();
  if (!document?.storage_path) return null;

  const { data } = await supabase.storage.from("documents").createSignedUrl(document.storage_path, 300);
  return data?.signedUrl ?? null;
}
