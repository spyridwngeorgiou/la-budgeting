"use server";

import { createClient } from "@/lib/supabase/server";
import { getHouseholdId } from "@/lib/household";
import { revalidateAll } from "@/lib/revalidate";

function parse(formData: FormData) {
  const emptyToNull = (v: FormDataEntryValue | null) => {
    const s = String(v ?? "").trim();
    return s === "" ? null : s;
  };
  const numOf = (v: FormDataEntryValue | null) => Number(v ?? 0) || 0;

  const net = numOf(formData.get("net_amount"));
  const vat = numOf(formData.get("vat_amount"));
  const withholding = numOf(formData.get("withholding_amount"));
  // Final cash amount = net + VAT - withholding
  const amount = Math.round((net + vat - withholding) * 100) / 100;

  return {
    type: String(formData.get("type") ?? "expense"),
    amount,
    net_amount: net,
    vat_amount: vat,
    withholding_amount: withholding,
    vat_status: String(formData.get("vat_status") ?? "none"),
    status: String(formData.get("status") ?? "upcoming"),
    tx_date:
      String(formData.get("tx_date") ?? "") ||
      new Date().toISOString().slice(0, 10),
    project_id: emptyToNull(formData.get("project_id")),
    account_id: emptyToNull(formData.get("account_id")),
    category_id: emptyToNull(formData.get("category_id")),
    contact_id: emptyToNull(formData.get("contact_id")),
    source: emptyToNull(formData.get("source")),
    notes: emptyToNull(formData.get("notes")),
  };
}

export async function createTransaction(formData: FormData) {
  const householdId = await getHouseholdId();
  if (!householdId) return;
  const supabase = await createClient();
  await supabase
    .from("transactions")
    .insert({ household_id: householdId, ...parse(formData) });
  revalidateAll();
}

export async function updateTransaction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("transactions").update(parse(formData)).eq("id", id);
  revalidateAll();
}

export async function deleteTransaction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("transactions").delete().eq("id", id);
  revalidateAll();
}
