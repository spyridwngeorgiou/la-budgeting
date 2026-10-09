"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentOrgId, formString } from "@/lib/supabase/org";
import { action, UserError, type ActionResult } from "@/lib/actions";
import { firstOfMonth, isMonthKey } from "@/lib/dates";
import { el } from "@/lib/i18n/el";

// Expected income (0008 + 0065): the small hand-kept list of money that is
// likely but not invoiced yet. Rows written by a project scenario
// («Στείλε στο ταμείο», scenario_id set) are managed from the scenario.

function fieldsFromForm(formData: FormData) {
  const amount = Number(formData.get("amount"));
  if (!Number.isFinite(amount) || amount <= 0) throw new UserError(el.netWorth.invalidAmount);
  const month = String(formData.get("expected_month") ?? "");
  if (!isMonthKey(month)) throw new UserError("Επιλέξτε αναμενόμενο μήνα.");
  const pct = Number(formData.get("probability_pct") ?? 100);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) throw new UserError("Η πιθανότητα πρέπει να είναι από 0 έως 100%.");
  const source = (formString(formData, "source") ?? "").trim();
  if (!source) throw new UserError("Συμπληρώστε περιγραφή.");
  const scope = formString(formData, "owner_scope");
  return {
    source,
    amount,
    expected_month: firstOfMonth(month),
    probability: pct / 100,
    certainty: pct >= 100 ? ("certain" as const) : ("probable" as const),
    project_id: formString(formData, "project_id"),
    contact_id: formString(formData, "contact_id"),
    owner_scope: scope === "personal" ? ("personal" as const) : ("corporate" as const),
    notes: formString(formData, "notes"),
  };
}

export async function saveExpectedIncome(id: string | null, formData: FormData): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const fields = fieldsFromForm(formData);
    const { error } = id
      ? await supabase.from("expected_income").update(fields).eq("id", id).eq("org_id", orgId)
      : await supabase.from("expected_income").insert({ ...fields, org_id: orgId });
    if (error) throw error;
    revalidatePath("/reports/cash");
    revalidatePath("/dashboard");
  });
}

export async function setExpectedIncomeStatus(id: string, status: "received" | "cancelled"): Promise<ActionResult> {
  return action(async () => {
    const supabase = await createClient();
    const orgId = await getCurrentOrgId(supabase);
    const { error } = await supabase.from("expected_income").update({ status }).eq("id", id).eq("org_id", orgId);
    if (error) throw error;
    revalidatePath("/reports/cash");
    revalidatePath("/dashboard");
  });
}
