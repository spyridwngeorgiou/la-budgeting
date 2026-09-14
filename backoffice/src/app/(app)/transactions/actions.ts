"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import { deriveFromNet, cashOnly, isIdentityConsistent } from "@/lib/finance/money";
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

  return {
    tx_date: String(formData.get("tx_date")),
    due_date: formString(formData, "due_date"),
    paid_on: formString(formData, "paid_on"),
    contact_id: formString(formData, "contact_id"),
    project_id: formString(formData, "project_id"),
    category_id: formString(formData, "category_id"),
    account_id: formString(formData, "account_id"),
    direction: String(formData.get("direction")) as TxDirection,
    scope: String(formData.get("scope") ?? "business") as TxScope,
    status: String(formData.get("status")) as TxStatus,
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

export async function deleteTransaction(id: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("transactions").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/transactions");
}
