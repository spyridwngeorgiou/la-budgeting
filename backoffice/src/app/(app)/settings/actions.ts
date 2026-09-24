"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { isValidAfm } from "@/lib/finance/money";

export async function changePassword(formData: FormData) {
  const newPassword = String(formData.get("new_password"));
  const confirm = String(formData.get("confirm_password"));

  if (newPassword.length < 8) {
    throw new Error("Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.");
  }
  if (newPassword !== confirm) {
    throw new Error("Οι κωδικοί δεν ταιριάζουν.");
  }

  const supabase = await createClient();
  // updateUser acts on the currently authenticated session -- no admin
  // rights or anyone else's password involved, just "change my own".
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw new Error(error.message);
}

export async function updateOwnAfm(formData: FormData) {
  const afm = String(formData.get("own_afm"));
  if (!isValidAfm(afm)) {
    throw new Error("Μη έγκυρο ΑΦΜ (δεν περνάει τον έλεγχο ψηφίου ελέγχου).");
  }

  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const { error } = await supabase
    .from("orgs")
    .update({ name: String(formData.get("name")), own_afm: afm })
    .eq("id", orgId);

  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}

// Settings is a jsonb blob (org.settings) that several features already read
// from directly (e.g. cashflow's min_cash_buffer) -- merged, not replaced,
// so unrelated keys other screens rely on are never clobbered by this form.
export async function updateOrgSettings(formData: FormData) {
  const supabase = await createClient();
  const orgId = await getCurrentOrgId(supabase);

  const budgetEuros = Number(formData.get("ai_monthly_budget_euros"));
  if (!Number.isFinite(budgetEuros) || budgetEuros <= 0) {
    throw new Error("Το όριο πρέπει να είναι θετικός αριθμός.");
  }

  const { data: org, error: readError } = await supabase.from("orgs").select("settings").eq("id", orgId).single();
  if (readError) throw new Error(readError.message);

  const nextSettings = { ...(org.settings as Record<string, unknown>), ai_monthly_budget_cents: Math.round(budgetEuros * 100) };
  const { error } = await supabase.from("orgs").update({ settings: nextSettings }).eq("id", orgId);
  if (error) throw new Error(error.message);
  revalidatePath("/settings");
}
