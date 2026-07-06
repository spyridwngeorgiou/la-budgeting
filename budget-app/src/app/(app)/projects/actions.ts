"use server";

import { createClient } from "@/lib/supabase/server";
import { getHouseholdId } from "@/lib/household";
import { revalidateAll } from "@/lib/revalidate";

export async function createProject(formData: FormData) {
  const householdId = await getHouseholdId();
  if (!householdId) return;
  const supabase = await createClient();
  const budgetRaw = Number(formData.get("budget_target") ?? 0);
  await supabase.from("projects").insert({
    household_id: householdId,
    name: String(formData.get("name") ?? "").trim() || "Νέο έργο",
    description: String(formData.get("description") ?? "").trim() || null,
    status: String(formData.get("status") ?? "active"),
    budget_target: budgetRaw > 0 ? budgetRaw : null,
    risk_level: String(formData.get("risk_level") ?? "medium"),
    owner_contact_id: String(formData.get("owner_contact_id") ?? "") || null,
    start_date: String(formData.get("start_date") ?? "") || null,
    end_date: String(formData.get("end_date") ?? "") || null,
  });
  revalidateAll();
}

export async function updateProject(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  const budgetRaw = Number(formData.get("budget_target") ?? 0);
  await supabase
    .from("projects")
    .update({
      name: String(formData.get("name") ?? "").trim(),
      description: String(formData.get("description") ?? "").trim() || null,
      status: String(formData.get("status") ?? "active"),
      budget_target: budgetRaw > 0 ? budgetRaw : null,
      risk_level: String(formData.get("risk_level") ?? "medium"),
      owner_contact_id: String(formData.get("owner_contact_id") ?? "") || null,
      start_date: String(formData.get("start_date") ?? "") || null,
      end_date: String(formData.get("end_date") ?? "") || null,
    })
    .eq("id", id);
  revalidateAll();
}

export async function deleteProject(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("projects").delete().eq("id", id);
  revalidateAll();
}
