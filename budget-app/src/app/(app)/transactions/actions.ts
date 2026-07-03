"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getHouseholdId } from "@/lib/household";

function parse(formData: FormData) {
  const emptyToNull = (v: FormDataEntryValue | null) => {
    const s = String(v ?? "").trim();
    return s === "" ? null : s;
  };
  return {
    type: String(formData.get("type") ?? "expense"),
    amount: Number(formData.get("amount") ?? 0) || 0,
    status: String(formData.get("status") ?? "upcoming"),
    tx_date: String(formData.get("tx_date") ?? "") || new Date().toISOString().slice(0, 10),
    project_id: emptyToNull(formData.get("project_id")),
    account_id: emptyToNull(formData.get("account_id")),
    category_id: emptyToNull(formData.get("category_id")),
    source: emptyToNull(formData.get("source")),
    notes: emptyToNull(formData.get("notes")),
  };
}

export async function createTransaction(formData: FormData) {
  const householdId = await getHouseholdId();
  if (!householdId) return;
  const supabase = await createClient();
  await supabase.from("transactions").insert({
    household_id: householdId,
    ...parse(formData),
  });
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/projects");
}

export async function updateTransaction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("transactions").update(parse(formData)).eq("id", id);
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/projects");
}

export async function deleteTransaction(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("transactions").delete().eq("id", id);
  revalidatePath("/transactions");
  revalidatePath("/dashboard");
  revalidatePath("/projects");
}
