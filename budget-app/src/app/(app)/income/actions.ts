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
    label: String(formData.get("label") ?? "").trim() || "Έσοδο",
    amount: Number(formData.get("amount") ?? 0) || 0,
    recurrence: String(formData.get("recurrence") ?? "monthly"),
    project_id: emptyToNull(formData.get("project_id")),
    start_date:
      String(formData.get("start_date") ?? "") ||
      new Date().toISOString().slice(0, 10),
    end_date: emptyToNull(formData.get("end_date")),
  };
}

export async function createIncome(formData: FormData) {
  const householdId = await getHouseholdId();
  if (!householdId) return;
  const supabase = await createClient();
  await supabase
    .from("expected_income")
    .insert({ household_id: householdId, ...parse(formData) });
  revalidatePath("/income");
  revalidatePath("/dashboard");
}

export async function updateIncome(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("expected_income").update(parse(formData)).eq("id", id);
  revalidatePath("/income");
  revalidatePath("/dashboard");
}

export async function deleteIncome(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const supabase = await createClient();
  await supabase.from("expected_income").delete().eq("id", id);
  revalidatePath("/income");
  revalidatePath("/dashboard");
}
