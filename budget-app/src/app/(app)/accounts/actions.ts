"use server";

import { createClient } from "@/lib/supabase/server";
import { getHouseholdId } from "@/lib/household";
import { revalidateAll } from "@/lib/revalidate";

export async function createAccount(formData: FormData) {
  const householdId = await getHouseholdId();
  if (!householdId) return;
  const supabase = await createClient();
  const projectId = String(formData.get("project_id") ?? "").trim();
  await supabase.from("accounts").insert({
    household_id: householdId,
    name: String(formData.get("name") ?? "").trim() || "Νέος λογαριασμός",
    type: String(formData.get("type") ?? "bank"),
    balance: Number(formData.get("balance") ?? 0) || 0,
    is_incoming: formData.get("is_incoming") === "on",
    project_id: projectId === "" ? null : projectId,
  });
  revalidateAll();
}

export async function updateAccount(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const projectId = String(formData.get("project_id") ?? "").trim();
  await supabase
    .from("accounts")
    .update({
      name: String(formData.get("name") ?? "").trim(),
      type: String(formData.get("type") ?? "bank"),
      balance: Number(formData.get("balance") ?? 0) || 0,
      is_incoming: formData.get("is_incoming") === "on",
      project_id: projectId === "" ? null : projectId,
    })
    .eq("id", id);
  revalidateAll();
}

export async function deleteAccount(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("accounts").delete().eq("id", id);
  revalidateAll();
}
