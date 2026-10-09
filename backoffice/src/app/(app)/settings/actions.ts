"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId } from "@/lib/supabase/org";
import { isValidAfm } from "@/lib/finance/money";
import { action, UserError, type ActionResult } from "@/lib/actions";

export async function changePassword(formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const newPassword = String(formData.get("new_password"));
    const confirm = String(formData.get("confirm_password"));

    if (newPassword.length < 8) {
      throw new UserError("Ο κωδικός πρέπει να έχει τουλάχιστον 8 χαρακτήρες.");
    }
    if (newPassword !== confirm) {
      throw new UserError("Οι κωδικοί δεν ταιριάζουν.");
    }

    const supabase = await createClient();
    // updateUser acts on the currently authenticated session -- no admin
    // rights or anyone else's password involved, just "change my own".
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) throw new UserError(`Η αλλαγή κωδικού απέτυχε: ${error.message}`);
  });
}

export async function updateOwnAfm(formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const afm = String(formData.get("own_afm"));
    if (!isValidAfm(afm)) {
      throw new UserError("Μη έγκυρο ΑΦΜ (δεν περνάει τον έλεγχο ψηφίου ελέγχου).");
    }

    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);

    const { error } = await supabase
      .from("orgs")
      .update({ name: String(formData.get("name")), own_afm: afm })
      .eq("id", orgId);

    if (error) throw error;
    revalidatePath("/settings");
  });
}

// Settings is a jsonb blob (org.settings) that several features already read
// from directly (e.g. cashflow's min_cash_buffer) -- merged, not replaced,
// so unrelated keys other screens rely on are never clobbered by this form.
export async function updateOrgSettings(formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);

    const budgetEuros = Number(formData.get("ai_monthly_budget_euros"));
    if (!Number.isFinite(budgetEuros) || budgetEuros <= 0) {
      throw new UserError("Το όριο πρέπει να είναι θετικός αριθμός.");
    }

    const { data: org, error: readError } = await supabase.from("orgs").select("settings").eq("id", orgId).single();
    if (readError) throw readError;

    const nextSettings = { ...(org.settings as Record<string, unknown>), ai_monthly_budget_cents: Math.round(budgetEuros * 100) };
    const { error } = await supabase.from("orgs").update({ settings: nextSettings }).eq("id", orgId);
    if (error) throw error;
    revalidatePath("/settings");
  });
}

// Read by v_qc_uninvoiced_large_expenses (0029) straight from orgs.settings.
export async function updateTaxRiskSettings(formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);

    const threshold = Number(formData.get("uninvoiced_threshold_eur"));
    const taxRatePct = Number(formData.get("corporate_tax_rate_pct"));
    if (!Number.isFinite(threshold) || threshold < 0 || !Number.isFinite(taxRatePct) || taxRatePct < 0 || taxRatePct > 100) {
      throw new UserError("Μη έγκυρο όριο ή συντελεστής.");
    }

    const { data: org, error: readError } = await supabase.from("orgs").select("settings").eq("id", orgId).single();
    if (readError) throw readError;

    const nextSettings = {
      ...(org.settings as Record<string, unknown>),
      uninvoiced_threshold_eur: threshold,
      corporate_tax_rate: Math.round(taxRatePct * 10) / 1000,
    };
    const { error } = await supabase.from("orgs").update({ settings: nextSettings }).eq("id", orgId);
    if (error) throw error;
    revalidatePath("/settings");
    revalidatePath("/reports/quality");
  });
}
