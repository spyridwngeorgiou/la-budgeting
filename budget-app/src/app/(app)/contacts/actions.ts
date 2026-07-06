"use server";

import { createClient } from "@/lib/supabase/server";
import { getHouseholdId } from "@/lib/household";
import { revalidateAll } from "@/lib/revalidate";

export async function createContact(formData: FormData) {
  const householdId = await getHouseholdId();
  if (!householdId) return;
  const supabase = await createClient();
  await supabase.from("contacts").insert({
    household_id: householdId,
    name: String(formData.get("name") ?? "").trim() || "Νέα επαφή",
    kind: String(formData.get("kind") ?? "vendor"),
    notes: String(formData.get("notes") ?? "").trim() || null,
  });
  revalidateAll();
}

export async function updateContact(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase
    .from("contacts")
    .update({
      name: String(formData.get("name") ?? "").trim(),
      kind: String(formData.get("kind") ?? "vendor"),
      notes: String(formData.get("notes") ?? "").trim() || null,
    })
    .eq("id", id);
  revalidateAll();
}

export async function deleteContact(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("contacts").delete().eq("id", id);
  revalidateAll();
}
